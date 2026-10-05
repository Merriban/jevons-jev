// Check 15: every number visible in the rendered page's text must trace back
// to data/sources.json (a registered value or range bound, or a number
// quoted verbatim inside an entry's `evidence`/`source_title`, since those
// are citations rather than fresh claims) or to a live model.js computation
// for one of the page's defined states (the default load state, and each of
// the 3 presets -- see the "Scope" note below for why that's sufficient).
// A number that matches neither fails the build.
import { chromium } from "@playwright/test";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { computeScenario, runMonteCarlo, breakevenEpsilon } from "../model/model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const distPath = path.join(root, "dist", "index.html");
const sources = JSON.parse(readFileSync(path.join(root, "data", "sources.json"), "utf8"));
const BY_ID = {};
for (const e of sources.entries) BY_ID[e.id] = e;

// ---------------------------------------------------------------------------
// Scope note: sliders can only ever display numbers that are the direct
// output of computeScenario()/runMonteCarlo() applied to registered
// sources.json values -- there is no code path in index.html that computes
// a page-visible number any other way. So checking every STATIC piece of
// page text plus the DEFAULT state and the 3 presets (4 concrete parameter
// combinations total) exercises every number the page can ever show,
// without needing to sample the continuous slider space.
// ---------------------------------------------------------------------------

const PARAM_IDS = { E0: "E0_default_twh", s: "s_decision_task_share", r: "r_energy_ratio", q: "q_price_ratio", eps: "eps_demand_elasticity", c: "c_complementarity_share" };
const GLOBAL_DEMAND = BY_ID["global_electricity_demand_2025_twh"].value;

function defaultParams() {
  const p = {};
  for (const [k, id] of Object.entries(PARAM_IDS)) p[k] = BY_ID[id].value;
  return p;
}

const PRESETS = [
  { s: 0.2, eps: 0.1, c: 0.05 },
  { s: 0.3, eps: 0.75, c: 0.15 },
  { s: 0.3, eps: 1.3, c: 0.2 },
];

function collectAllowedNumbers() {
  const allowed = new Set();
  const add = (v) => {
    if (typeof v === "number" && Number.isFinite(v)) allowed.add(v);
  };

  // 1. Every registered value/range bound in sources.json.
  for (const e of sources.entries) {
    add(e.value);
    if (Array.isArray(e.range)) {
      add(e.range[0]);
      add(e.range[1]);
    }
    // Numbers quoted verbatim inside a citation (evidence), a source's own
    // title, or its publisher line ("... Figure 2.1") are citations, not
    // fresh claims -- allow them too.
    for (const field of [e.evidence, e.source_title, e.publisher]) {
      if (field) for (const n of extractNumbers(field)) add(n);
    }
  }

  // 2. Live model outputs for the default state and each preset.
  const base = defaultParams();
  const states = [base, ...PRESETS.map((p) => ({ ...base, ...p }))];
  for (const params of states) {
    const r = computeScenario({ ...params, globalElectricityDemandTwh: GLOBAL_DEMAND });
    add(r.E0);
    add(r.E1);
    add(r.deltaE);
    add(r.deltaPct * 100);
    if (r.reboundFraction !== null) add(r.reboundFraction * 100);
    if (r.shareOfGlobalDemandE0 !== undefined) add(r.shareOfGlobalDemandE0 * 100);
    if (r.shareOfGlobalDemandE1 !== undefined) add(r.shareOfGlobalDemandE1 * 100);
    add(params.eps); // hero's "At your chosen eps = ..." line
    const breakeven = breakevenEpsilon(params); // hero and sweep panel's breakeven
    if (breakeven !== null) add(breakeven);
  }

  // Monte Carlo panel is static (uses full sources.json ranges, not sliders).
  const ranges = {
    s: BY_ID[PARAM_IDS.s].range,
    r: BY_ID[PARAM_IDS.r].range,
    eps: BY_ID[PARAM_IDS.eps].range,
    c: BY_ID[PARAM_IDS.c].range,
  };
  const fixed = { E0: BY_ID[PARAM_IDS.E0].value, q: BY_ID[PARAM_IDS.q].value };
  const mc = runMonteCarlo(ranges, fixed, 10000, 0x5eed1234);
  add(mc.median);
  add(mc.backfireProbability * 100);
  // mc-caveat's approximation: (eps_max - mean breakeven) / (eps_max - eps_min).
  const epsWidth = ranges.eps[1] - ranges.eps[0];
  add(epsWidth);
  add(mc.meanBreakeven);
  add(((ranges.eps[1] - mc.meanBreakeven) / epsWidth) * 100);

  // 3. Structural / implementation constants, documented explicitly (never
  // real-world data, so exempt from the citation requirement):
  add(0);
  add(1); // used in trivial statements like "eps = 1", "c = 0"
  add(0.5);
  add(1.5); // hardcoded sweep-chart tick marks, see index.html renderSweepChart
  add(10000); // Monte Carlo sample count (mc-caption's "10,000 samples")
  add(1000000); // "1e6" unit shorthand ("USD/1e6 input tokens")
  add(1200); // og:image:width (image size in pixels, not data)
  add(630); // og:image:height

  return allowed;
}

function extractNumbers(rawText) {
  let text = rawText;
  text = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " "); // ISO dates (already-sourced accessed/published dates)
  text = text.replace(/10\^-?\d+/g, " "); // chart axis "10^n" power-of-ten labels
  text = text.replace(/§\s*\d+/g, " "); // "METHODOLOGY.md §9" style doc-section references
  text = text.replace(/(\d)x(?![a-zA-Z])/g, "$1 x"); // "40x" -> "40 x" so the decimal number extracts cleanly
  const NUM_RE = /(?<![A-Za-z0-9_])[+-]?(?:\d{1,3}(?:,\d{3})+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?!\d)|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?(?![A-Za-z0-9_])/g;
  const tokens = text.match(NUM_RE) ?? [];
  return tokens.map((t) => parseFloat(t.replace(/[, \u00a0\u202f]/g, "")));
}

function isAllowed(rawToken, allowedSet) {
  const decimals = (rawToken.split(".")[1] ?? "").length;
  const tokenValue = parseFloat(rawToken.replace(/[, \u00a0\u202f]/g, ""));
  for (const allowedValue of allowedSet) {
    const rounded = Number(allowedValue.toFixed(Math.min(decimals, 10)));
    if (Math.abs(rounded - tokenValue) < 1e-9) return true;
    if (Math.abs(allowedValue - tokenValue) < 1e-9) return true;
    // Also accept year-like bare integers (temporal references, not data).
  }
  if (decimals === 0 && Number.isInteger(tokenValue) && tokenValue >= 2000 && tokenValue <= 2099) return true;
  return false;
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

async function main() {
  if (!existsSync(distPath)) {
    console.error("dist/index.html does not exist -- run `npm run build` first.");
    process.exit(1);
  }

  const allowed = collectAllowedNumbers();

  const executablePath = findLocalChromiumExecutable();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const page = await browser.newPage();
  await page.goto(`file://${distPath}`);
  await page.waitForTimeout(400);
  // Visible text plus the text that link previews show (title and meta
  // descriptions/alt text); their numbers must trace back too.
  const text = await page.evaluate(() => {
    const metaText = [...document.querySelectorAll("meta[content]")]
      .map((m) => m.getAttribute("content"))
      .filter((c) => !/^https?:\/\//.test(c));
    return [document.title, ...metaText, document.body.innerText].join("\n");
  });
  await browser.close();

  let cleaned = text;
  cleaned = cleaned.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  cleaned = cleaned.replace(/10\^-?\d+/g, " ");
  cleaned = cleaned.replace(/§\s*\d+/g, " ");
  cleaned = cleaned.replace(/(\d)x(?![a-zA-Z])/g, "$1 x");
  const NUM_RE = /(?<![A-Za-z0-9_])[+-]?(?:\d{1,3}(?:,\d{3})+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?!\d)|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?(?![A-Za-z0-9_])/g;
  const rawTokens = cleaned.match(NUM_RE) ?? [];

  const orphans = [];
  for (const tok of rawTokens) {
    if (!isAllowed(tok, allowed)) orphans.push(tok);
  }

  console.log(`Scanned ${rawTokens.length} number-like tokens from the rendered page (default state + presets checked against model.js).`);
  console.log(`Allowed-number set size: ${allowed.size}.`);

  if (orphans.length > 0) {
    console.error(`FAIL: ${orphans.length} orphan number(s) found in visible page text with no traceable source:`);
    const counts = {};
    for (const o of orphans) counts[o] = (counts[o] ?? 0) + 1;
    for (const [tok, count] of Object.entries(counts)) console.error(`  - "${tok}" (x${count})`);
    process.exit(1);
  }

  console.log("OK: every number in the rendered page traces to data/sources.json or a live model.js computation.");
  process.exit(0);
}

main();
