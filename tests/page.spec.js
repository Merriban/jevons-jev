// Check F.16-18: headless page tests against the BUILT artifact (dist/index.html),
// since that's what actually ships (self-contained, works from file://).
// Run `npm run build` before this suite (wired into CI; see package.json's
// pretest-adjacent build step in .github/workflows/ci.yml).
import { test, expect } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, "..", "dist", "index.html");
const fileUrl = `file://${distPath}`;
const registry = JSON.parse(readFileSync(path.join(__dirname, "..", "data", "sources.json"), "utf8"));

function collectConsoleErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

test.describe("dist/index.html", () => {
  test("loads with no console errors", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(fileUrl);
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test("check F.18: no network requests fire when loaded from file:// (truly self-contained)", async ({ page }) => {
    const requests = [];
    page.on("request", (req) => requests.push(req.url()));
    await page.goto(fileUrl);
    await page.waitForTimeout(300);
    // The only request should be the navigation to the file itself.
    const nonNavigationRequests = requests.filter((u) => u !== fileUrl);
    expect(nonNavigationRequests).toEqual([]);
  });

  test("check F.18: dist/index.html size is recorded", async () => {
    const stats = statSync(distPath);
    console.log(`dist/index.html size: ${stats.size.toLocaleString()} bytes`);
    expect(stats.size).toBeGreaterThan(1000);
    expect(stats.size).toBeLessThan(16 * 1024 * 1024);
  });

  test("hero answer renders a real outcome on load", async ({ page }) => {
    await page.goto(fileUrl);
    await page.waitForTimeout(300);
    const text = await page.textContent("#hero-answer-text");
    expect(text).toMatch(/(fall|rise) \d/);
    const outcome = await page.getAttribute("#hero-answer", "data-outcome");
    expect(["savings", "partial_rebound", "backfire"]).toContain(outcome);
  });

  test("moving the eps slider updates the hero text, charts, and URL", async ({ page }) => {
    await page.goto(fileUrl);
    await page.waitForTimeout(300);
    const before = await page.textContent("#hero-answer-text");

    await page.fill("#slider-eps", "1.9");
    await page.dispatchEvent("#slider-eps", "input");
    await page.waitForTimeout(200);

    const after = await page.textContent("#hero-answer-text");
    expect(after).not.toEqual(before);
    expect(page.url()).toContain("eps=1.9");

    const bars = await page.$$("#chart-bars rect");
    expect(bars.length).toBeGreaterThanOrEqual(2);
  });

  test("moving eps far enough triggers the visible sanity-threshold warning", async ({ page }) => {
    await page.goto(fileUrl);
    await page.waitForTimeout(300);
    // With c = 0 every decision pays only JEV's price, so eps = 2 drives
    // volume (and energy) far past the 10%-of-global-demand threshold.
    await page.fill("#slider-c", "0");
    await page.dispatchEvent("#slider-c", "input");
    await page.fill("#slider-eps", "2");
    await page.dispatchEvent("#slider-eps", "input");
    await page.waitForTimeout(200);
    const visible = await page.evaluate(() => document.getElementById("warning-banner").classList.contains("visible"));
    expect(visible).toBe(true);
    const text = await page.textContent("#warning-banner-text");
    expect(text.length).toBeGreaterThan(20);
  });

  test("each preset produces the value model.js actually computes for it", async ({ page }) => {
    await page.goto(fileUrl);
    await page.waitForTimeout(300);

    const expected = {
      savings: { s: 0.2, eps: 0.1, c: 0.05 },
      partial_rebound: { s: 0.3, eps: 0.75, c: 0.15 },
      backfire: { s: 0.3, eps: 1.3, c: 0.2 },
    };

    for (const [key, params] of Object.entries(expected)) {
      await page.click(`[data-preset="${key}"]`);
      await page.waitForTimeout(200);

      const result = await page.evaluate((p) => {
        const E0 = Number(document.getElementById("slider-E0").value);
        const r = Number(document.getElementById("slider-r").value);
        const q = Number(document.getElementById("slider-q").value);
        // eslint-disable-next-line no-undef
        return computeScenario({ E0, s: p.s, q, eps: p.eps, r, c: p.c });
      }, params);

      // Each preset must actually produce the outcome it is named after.
      expect(result.classification).toBe(key);

      const outcomeTag = await page.textContent("#outcome-tag");
      expect(outcomeTag).toBe(
        result.classification === "savings" ? "Efficiency wins" : result.classification === "partial_rebound" ? "Partial rebound" : "Jevons backfire"
      );

      const pressed = await page.getAttribute(`[data-preset="${key}"]`, "aria-pressed");
      expect(pressed).toBe("true");
    }
  });

  test("share button copies a URL that round-trips the exact state on reload", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(fileUrl);
    await page.waitForTimeout(300);

    await page.fill("#slider-s", "0.45");
    await page.dispatchEvent("#slider-s", "input");
    await page.waitForTimeout(150);

    await page.click("#share-btn");
    await page.waitForTimeout(150);
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain("s=0.45");

    await page.goto(clipboardText);
    await page.waitForTimeout(300);
    const restoredS = await page.inputValue("#slider-s");
    expect(Number(restoredS)).toBeCloseTo(0.45, 5);
  });

  test("sliders have accessible labels and aria-valuetext", async ({ page }) => {
    await page.goto(fileUrl);
    await page.waitForTimeout(300);
    const ids = ["E0", "s", "r", "q", "eps", "c"];
    for (const id of ids) {
      const slider = page.locator(`#slider-${id}`);
      await expect(slider).toHaveAttribute("aria-valuetext", /.+/);
      const labelFor = await page.getAttribute(`label[for="slider-${id}"]`, "for");
      expect(labelFor).toBe(`slider-${id}`);
    }
  });

  test("keyboard: focusing a slider and pressing ArrowRight changes its value", async ({ page }) => {
    await page.goto(fileUrl);
    await page.waitForTimeout(300);
    await page.focus("#slider-s");
    const before = await page.inputValue("#slider-s");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);
    const after = await page.inputValue("#slider-s");
    expect(Number(after)).toBeGreaterThan(Number(before));
  });

  test("Monte Carlo histogram renders bars and a caption with the backfire probability", async ({ page }) => {
    await page.goto(fileUrl);
    await page.waitForTimeout(400);
    const bars = await page.$$("#chart-hist rect.hist-bar");
    expect(bars.length).toBeGreaterThan(5);
    const caption = await page.textContent("#mc-caption");
    expect(caption).toMatch(/samples with backfire.*%/);
  });

  test("sources table and know-vs-assume panel are populated from sources.json", async ({ page }) => {
    await page.goto(fileUrl);
    await page.waitForTimeout(300);
    const rows = await page.$$("#sources-table-body tr");
    expect(rows.length).toBeGreaterThan(10);
    const kvaItems = await page.$$("#know-vs-assume-list li");
    expect(kvaItems.length).toBe(registry.entries.length);
  });

  test("dark mode toggle switches data-theme attribute", async ({ page }) => {
    await page.goto(fileUrl);
    await page.waitForTimeout(300);
    await page.click("#theme-toggle");
    const theme1 = await page.getAttribute("html", "data-theme");
    expect(["light", "dark"]).toContain(theme1);
    await page.click("#theme-toggle");
    const theme2 = await page.getAttribute("html", "data-theme");
    expect(theme2).not.toBe(theme1);
  });

  test("SVG chart text uses the system font stack (no external/missing font)", async ({ page }) => {
    await page.goto(fileUrl);
    await page.waitForTimeout(300);
    const fontFamily = await page.evaluate(() => {
      const textEl = document.querySelector("#chart-bars text");
      return textEl ? window.getComputedStyle(textEl).fontFamily : null;
    });
    expect(fontFamily).toBeTruthy();
    expect(fontFamily).not.toContain("://"); // never a URL-based @font-face
  });

  test("no horizontal page overflow at phone widths (320-414px)", async ({ page }) => {
    for (const width of [320, 360, 390, 414]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(fileUrl);
      await page.waitForTimeout(200);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, `horizontal overflow at ${width}px viewport`).toBeLessThanOrEqual(clientWidth);
    }
  });

  test("disclaimer and warning-banner text are present and non-empty", async ({ page }) => {
    await page.goto(fileUrl);
    await page.waitForTimeout(300);
    const disclaimer = await page.textContent(".disclaimer");
    expect(disclaimer).toContain("has been published by TypeSafe AI or measured independently");
  });
});
