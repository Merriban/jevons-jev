// Renders the share images from scripts/share-content.mjs with Playwright
// (the same Chromium the tests use), light theme, system fonts only, no
// network:
//   docs/og.png              1200×630 Open Graph / Twitter preview
//   docs/chart-breakeven.png 1600×1000 static chart for posts
// Each PNG is stamped with the hash of the inputs it was rendered from;
// tests/share.test.js fails if the data or the model change and the images
// are not re-rendered (`npm run render:share`).
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { shareContent, fmt, TITLE, SITE_LABEL, SOURCES_LINE, OG_SIZE, CHART_SIZE } from "./share-content.mjs";
import { addTextChunks } from "./png-text.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(__dirname, "..", "docs");

const COLORS = {
  bg: "#ffffff",
  panel: "#f7f7f5",
  text: "#1b1b18",
  muted: "#4a4842",
  grid: "#d9d6cd",
  line: "#0f5e4c",
  baseline: "#4a4842",
  breakeven: "#b3261e",
};
const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Line chart of E1/E0 against eps, with the 2025 baseline (E1/E0 = 1) and
// the breakeven elasticity marked.
function chartSvg(c, { width, height, font, annotate }) {
  const pad = { l: font * 4.2, r: font * 1.2, t: font * 1.4, b: font * (annotate ? 3.6 : 2.4) };
  const pw = width - pad.l - pad.r;
  const ph = height - pad.t - pad.b;
  const [x0, x1] = c.epsRange;
  const [y0, y1] = [c.yTicks[0], c.yTicks[c.yTicks.length - 1]];
  const sx = (v) => pad.l + ((v - x0) / (x1 - x0)) * pw;
  const sy = (v) => pad.t + ph - ((v - y0) / (y1 - y0)) * ph;
  const parts = [];
  for (const t of c.yTicks) {
    parts.push(`<line x1="${pad.l}" x2="${pad.l + pw}" y1="${sy(t)}" y2="${sy(t)}" stroke="${COLORS.grid}" stroke-width="1"/>`);
    parts.push(`<text x="${pad.l - font * 0.5}" y="${sy(t) + font * 0.35}" text-anchor="end" font-size="${font}" fill="${COLORS.muted}">${fmt(t, 2)}</text>`);
  }
  for (const t of c.xTicks) {
    parts.push(`<text x="${sx(t)}" y="${pad.t + ph + font * 1.4}" text-anchor="middle" font-size="${font}" fill="${COLORS.muted}">${fmt(t, 2)}</text>`);
  }
  parts.push(`<line x1="${pad.l}" x2="${pad.l + pw}" y1="${sy(1)}" y2="${sy(1)}" stroke="${COLORS.baseline}" stroke-width="2" stroke-dasharray="3 5"/>`);
  parts.push(`<line x1="${pad.l}" x2="${pad.l}" y1="${pad.t}" y2="${pad.t + ph}" stroke="${COLORS.muted}" stroke-width="1.5"/>`);
  parts.push(`<line x1="${pad.l}" x2="${pad.l + pw}" y1="${pad.t + ph}" y2="${pad.t + ph}" stroke="${COLORS.muted}" stroke-width="1.5"/>`);
  const d = c.points.map((p, i) => `${i ? "L" : "M"}${sx(p.eps).toFixed(2)},${sy(p.ratio).toFixed(2)}`).join(" ");
  parts.push(`<path d="${d}" fill="none" stroke="${COLORS.line}" stroke-width="${font * 0.28}" stroke-linejoin="round"/>`);
  const bx = sx(c.breakeven);
  parts.push(`<line x1="${bx}" x2="${bx}" y1="${pad.t}" y2="${pad.t + ph}" stroke="${COLORS.breakeven}" stroke-width="${font * 0.15}" stroke-dasharray="8 6"/>`);
  parts.push(`<circle cx="${bx}" cy="${sy(1)}" r="${font * 0.45}" fill="${COLORS.breakeven}"/>`);
  parts.push(`<text x="${bx + font * 0.6}" y="${pad.t + font * 1.1}" font-size="${font * 1.05}" font-weight="700" fill="${COLORS.breakeven}">Breakeven: eps = ${c.breakevenText}</text>`);
  parts.push(`<text x="${pad.l + pw - font * 0.4}" y="${sy(1) - font * 0.5}" text-anchor="end" font-size="${font * 0.95}" fill="${COLORS.muted}">E1/E0 = 1: the 2025 baseline</text>`);
  if (annotate) {
    const dx = sx(c.defaultEps);
    const dy = sy(c.defaultRatio);
    parts.push(`<circle cx="${dx}" cy="${dy}" r="${font * 0.45}" fill="${COLORS.line}" stroke="${COLORS.bg}" stroke-width="2"/>`);
    // Label in the empty upper-left area, with a leader line to the point.
    const lx = pad.l + font;
    const ly = pad.t + ph * 0.35;
    parts.push(`<line x1="${lx + font * 4}" y1="${ly + font * 0.5}" x2="${dx}" y2="${dy - font * 0.6}" stroke="${COLORS.muted}" stroke-width="1.5"/>`);
    parts.push(`<text x="${lx}" y="${ly}" font-size="${font * 0.95}" fill="${COLORS.text}">Default eps = ${fmt(c.defaultEps)}: E1/E0 = ${fmt(c.defaultRatio)}</text>`);
    parts.push(`<text x="${pad.l + pw / 2}" y="${height - font * 0.6}" text-anchor="middle" font-size="${font}" fill="${COLORS.text}">Demand elasticity, eps (dimensionless)</text>`);
    parts.push(`<text transform="translate(${font * 1.2} ${pad.t + ph / 2}) rotate(-90)" text-anchor="middle" font-size="${font}" fill="${COLORS.text}">E1 / E0 (ratio to 2025 baseline)</text>`);
  } else {
    parts.push(`<text x="${pad.l + pw}" y="${height - font * 0.4}" text-anchor="end" font-size="${font * 0.9}" fill="${COLORS.muted}">demand elasticity (eps) →</text>`);
    parts.push(`<text x="${pad.l}" y="${pad.t - font * 0.4}" font-size="${font * 0.9}" fill="${COLORS.muted}">E1 / E0</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family='${FONT}'>${parts.join("")}</svg>`;
}

function page(body, { width, height }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    html, body { width: ${width}px; height: ${height}px; background: ${COLORS.bg}; color: ${COLORS.text}; font-family: ${FONT}; }
  </style></head><body>${body}</body></html>`;
}

export function ogHtml(c) {
  const { width, height } = OG_SIZE;
  return page(
    `<div style="height:100%;padding:44px 56px 34px;display:flex;flex-direction:column;gap:14px;">
      <h1 style="font-size:46px;line-height:1.12;font-weight:800;letter-spacing:-0.5px;">${esc(TITLE)}</h1>
      <div style="background:${COLORS.panel};border-radius:12px;padding:6px 8px 0;">${chartSvg(c, { width: 1072, height: 270, font: 21, annotate: false })}</div>
      <p style="font-size:27px;line-height:1.25;font-weight:700;">${esc(c.headline)}</p>
      <div style="margin-top:auto;display:flex;justify-content:space-between;font-size:22px;color:${COLORS.muted};">
        <span>Scenario study, not a forecast</span><span>${esc(SITE_LABEL)}</span>
      </div>
    </div>`,
    { width, height },
  );
}

export function chartHtml(c) {
  const { width, height } = CHART_SIZE;
  return page(
    `<div style="height:100%;padding:56px 64px 40px;display:flex;flex-direction:column;gap:12px;">
      <h1 style="font-size:46px;line-height:1.15;font-weight:800;">Total AI inference energy vs. demand elasticity</h1>
      <p style="font-size:26px;line-height:1.35;color:${COLORS.muted};">${esc(c.headline)}. Default scenario of the model; a scenario, not a forecast.</p>
      ${chartSvg(c, { width: 1472, height: 720, font: 24, annotate: true })}
      <p style="margin-top:auto;font-size:21px;color:${COLORS.muted};">${esc(SOURCES_LINE)}</p>
    </div>`,
    { width, height },
  );
}

function findLocalChromiumExecutable() {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsersPath || !existsSync(browsersPath)) return undefined;
  for (const dir of readdirSync(browsersPath).filter((n) => n.startsWith("chromium-"))) {
    const exe = path.join(browsersPath, dir, "chrome-linux", "chrome");
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

async function render() {
  const c = shareContent();
  const executablePath = findLocalChromiumExecutable();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  for (const [file, html, size] of [
    ["og.png", ogHtml(c), OG_SIZE],
    ["chart-breakeven.png", chartHtml(c), CHART_SIZE],
  ]) {
    const pg = await browser.newPage({ viewport: size, colorScheme: "light", locale: "en-US" });
    await pg.route("**/*", (route) => route.abort()); // no network, ever
    await pg.setContent(html, { waitUntil: "load" });
    const png = await pg.screenshot({ type: "png", clip: { x: 0, y: 0, ...size } });
    const stamped = addTextChunks(png, { "jevons-inputs-sha256": c.inputsHash, "jevons-breakeven": c.breakevenText });
    writeFileSync(path.join(docsDir, file), stamped);
    await pg.close();
    console.log(`Wrote docs/${file} (${size.width}×${size.height})`);
  }
  await browser.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await render();
