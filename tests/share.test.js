// Share images (docs/og.png, docs/chart-breakeven.png): size, freshness, and
// that every number they show comes from the model or the registry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { computeScenario, breakevenEpsilon } from "../model/model.js";
import { shareContent, OG_SIZE, CHART_SIZE } from "../scripts/share-content.mjs";
import { ogHtml, chartHtml } from "../scripts/render-share-images.mjs";
import { pngSize, readTextChunks } from "../scripts/png-text.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const registry = JSON.parse(readFileSync(path.join(root, "data", "sources.json"), "utf8"));
const byId = Object.fromEntries(registry.entries.map((e) => [e.id, e]));
const defaults = {
  E0: byId.E0_default_twh.value,
  s: byId.s_decision_task_share.value,
  r: byId.r_energy_ratio.value,
  q: byId.q_price_ratio.value,
  eps: byId.eps_demand_elasticity.value,
  c: byId.c_complementarity_share.value,
};
const content = shareContent();

const images = [
  ["og.png", OG_SIZE, ogHtml],
  ["chart-breakeven.png", CHART_SIZE, chartHtml],
];

test("the headline number is the model's breakeven at the default scenario", () => {
  const expected = breakevenEpsilon(defaults);
  assert.equal(content.breakeven, expected);
  assert.equal(content.breakevenText, expected.toFixed(3));
  assert.ok(content.headline.endsWith(`exceeds ${expected.toFixed(3)}`));
  assert.ok(content.ogDescription.includes(expected.toFixed(3)));
});

for (const [file, size, html] of images) {
  const png = readFileSync(path.join(root, "docs", file));

  test(`docs/${file} is ${size.width}×${size.height}`, () => {
    assert.deepEqual(pngSize(png), size);
  });

  test(`docs/${file} was rendered from the current data and model (else run npm run render:share)`, () => {
    const stamp = readTextChunks(png);
    assert.equal(stamp["jevons-inputs-sha256"], content.inputsHash);
    assert.equal(stamp["jevons-breakeven"], content.breakevenText);
  });

  test(`every number in docs/${file} traces to the model, the registry, or an axis tick`, () => {
    const atDefault = computeScenario(defaults);
    const allowed = [
      breakevenEpsilon(defaults),
      defaults.eps,
      atDefault.E1 / atDefault.E0,
      ...content.xTicks,
      ...content.yTicks,
      ...byId.eps_demand_elasticity.range,
      1, // the baseline line, E1/E0 = 1
    ];
    // Years: the 2025 baseline year and the IEA 2026 report named in the sources line.
    const years = new Set([2025, 2026]);
    const text = html(content).replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ");
    const tokens = text.match(/(?<![A-Za-z0-9_.])\d+(?:\.\d+)?(?![A-Za-z0-9_])/g) ?? [];
    assert.ok(tokens.length > 5, "expected numbers in the image text");
    for (const tok of tokens) {
      const v = Number(tok);
      const decimals = (tok.split(".")[1] ?? "").length;
      const ok = years.has(v) || allowed.some((a) => Math.abs(Number(a.toFixed(decimals)) - v) < 1e-9);
      assert.ok(ok, `untraced number "${tok}" in docs/${file}`);
    }
  });
}

test("README's key result quotes the model's current breakeven", () => {
  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  const head = readme.slice(0, readme.indexOf("---"));
  assert.ok(head.includes(`**${breakevenEpsilon(defaults).toFixed(3)}**`), "README key result must match the model; update it");
  assert.ok(head.includes("https://merriban.github.io/jevons-jev/"));
  assert.ok(head.includes("a scenario, not a forecast"));
});

