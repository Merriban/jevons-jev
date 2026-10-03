// Visual checks on the BUILT page (dist/index.html): theme contrast in every
// system/chosen theme combination, centering of the threshold box, and
// locale-independent number formatting. Run `npm run build` first.
import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fileUrl = `file://${path.join(__dirname, "..", "dist", "index.html")}`;

// Elements whose text must stay readable in every theme combination.
const CONTRAST_TARGETS = {
  "header title": ".site-title",
  h1: ".hero h1",
  subtitle: ".hero p.muted",
  "threshold box": "#hero-answer-text",
  "threshold box (outcome line)": "#hero-answer-text .hero-sub",
  disclaimer: ".disclaimer p:not(.disclaimer-title)",
  "link (naming note)": "#naming-note a",
  "link (source)": "a.source-link",
  "sources table header": "table.sources-table th",
  "badge (vendor claim)": ".badge.vendor_claim",
  "badge (estimate)": ".badge.estimate",
  "badge (derived)": ".badge.derived",
  "badge (scenario)": ".badge.scenario_parameter",
  "outcome tag": "#outcome-tag",
};

// Click the theme toggle until the chosen theme is active (at most twice).
async function chooseTheme(page, theme) {
  for (let i = 0; i < 2; i++) {
    if ((await page.getAttribute("html", "data-theme")) === theme) return;
    await page.click("#theme-toggle");
  }
  expect(await page.getAttribute("html", "data-theme")).toBe(theme);
}

// Contrast ratio between an element's text color and the first opaque
// background found walking up from it (WCAG 2.x relative luminance).
async function measureContrast(page, selector) {
  return page.$eval(selector, (el) => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      const [r, g, b, a = 1] = m[1].split(",").map((x) => parseFloat(x));
      return { r, g, b, a };
    };
    const lum = ({ r, g, b }) => {
      const ch = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    let bgNode = el;
    let bg = null;
    while (bgNode) {
      const c = parse(getComputedStyle(bgNode).backgroundColor);
      if (c.a > 0.99) {
        bg = c;
        break;
      }
      bgNode = bgNode.parentElement;
    }
    if (!bg) bg = parse(getComputedStyle(document.documentElement).backgroundColor);
    const style = getComputedStyle(el);
    const fg = parse(style.color);
    const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    const sizePx = parseFloat(style.fontSize);
    const bold = parseInt(style.fontWeight, 10) >= 700;
    // WCAG "large text": >= 18pt (24px), or >= 14pt (18.66px) bold.
    const large = sizePx >= 24 || (bold && sizePx >= 18.66);
    return { ratio: (hi + 0.05) / (lo + 0.05), large, fg: style.color, bg: `rgb(${bg.r}, ${bg.g}, ${bg.b})` };
  });
}

for (const system of ["light", "dark"]) {
  for (const chosen of ["light", "dark"]) {
    test(`contrast: system ${system}, theme toggled to ${chosen}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: system });
      await page.goto(fileUrl);
      await page.waitForTimeout(300);
      await chooseTheme(page, chosen);

      // The page background must actually follow the chosen theme.
      const pageBg = await measureContrast(page, "main");
      const bodyLum = await page.evaluate(() => {
        const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number);
        return (r + g + b) / 3;
      });
      if (chosen === "light") expect(bodyLum, `body background ${pageBg.bg}`).toBeGreaterThan(200);
      else expect(bodyLum, `body background ${pageBg.bg}`).toBeLessThan(60);

      for (const [label, selector] of Object.entries(CONTRAST_TARGETS)) {
        const { ratio, large, fg, bg } = await measureContrast(page, selector);
        const min = large ? 3 : 4.5;
        expect(ratio, `${label} (${selector}): ${fg} on ${bg} = ${ratio.toFixed(2)}:1, needs ${min}:1`).toBeGreaterThanOrEqual(min);
      }
    });
  }
}

test("the chosen theme is remembered across reloads", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(fileUrl);
  await chooseTheme(page, "light");
  await page.reload();
  expect(await page.getAttribute("html", "data-theme")).toBe("light");
});

for (const width of [1280, 375]) {
  test(`threshold box is centered in its container at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(fileUrl);
    await page.waitForTimeout(300);
    const { box, container } = await page.evaluate(() => {
      const el = document.getElementById("hero-answer");
      const r = el.getBoundingClientRect();
      const c = el.parentElement.getBoundingClientRect();
      return { box: { left: r.left, right: r.right, width: r.width }, container: { left: c.left, right: c.right, width: c.width } };
    });
    const leftGap = box.left - container.left;
    const rightGap = container.right - box.right;
    expect(Math.abs(leftGap - rightGap), `left gap ${leftGap}, right gap ${rightGap}`).toBeLessThan(2);
    if (width < 700) {
      // On narrow screens the box uses all the width available.
      expect(container.width - box.width).toBeLessThan(2);
    }
  });
}

test.describe("with an Italian browser locale", () => {
  test.use({ locale: "it-IT" });

  test("numbers still use the decimal point", async ({ page }) => {
    await page.goto(fileUrl);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => navigator.language)).toBe("it-IT");

    const hero = await page.textContent("#hero-answer-text");
    expect(hero).toContain("0.966");
    expect(hero).toContain("eps = 0.5");
    expect(hero).toContain("12.5%");
    expect(await page.textContent("#value-E0")).toContain("108.5");
    expect(await page.textContent("#stat-delta")).toContain("-12.5%");
    expect(await page.textContent("#mc-caption")).toMatch(/\d\.\d+%/);

    // No decimal comma anywhere: a "0," followed by a digit can never be an
    // en-US thousands separator.
    const body = await page.evaluate(() => document.body.innerText);
    expect(body).not.toMatch(/(?<![\d.,])0,\d/);
    // Thousands separators stay en-US commas.
    expect(body).toContain("28,200 TWh/yr");
  });
});
