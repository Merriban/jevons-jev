// Content for the share images (docs/og.png, docs/chart-breakeven.png) and
// the Open Graph / Twitter meta description. Every number here is computed
// from data/sources.json and model/model.js at the default scenario, never
// typed by hand; tests/share.test.js checks that, and that the committed
// images were rendered from the current data and model (inputsHash).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { computeScenario, breakevenEpsilon, sweepEpsilon } from "../model/model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

export const SITE_URL = "https://merriban.github.io/jevons-jev/";
export const SITE_LABEL = "merriban.github.io/jevons-jev";
export const OG_IMAGE_URL = `${SITE_URL}og.png`;
export const OG_SIZE = { width: 1200, height: 630 };
export const CHART_SIZE = { width: 1600, height: 1000 };
export const TITLE = "If AI decisions got radically cheaper, would AI use less energy — or more?";
export const SOURCES_LINE = "Sources: TypeSafe AI workflow evals, Arize AI, IEA 2026, Our World in Data. Model: merriban.github.io/jevons-jev";

const PARAM_IDS = {
  E0: "E0_default_twh",
  s: "s_decision_task_share",
  r: "r_energy_ratio",
  q: "q_price_ratio",
  eps: "eps_demand_elasticity",
  c: "c_complementarity_share",
};

// Same number format as the page (en-US, at most 3 decimals).
export function fmt(v, maxFrac = 3) {
  return v.toLocaleString("en-US", { maximumFractionDigits: maxFrac, minimumFractionDigits: 0 });
}

// Evenly spaced "nice" tick values (axis labels only). With `cover`, the
// first and last ticks enclose [min, max]; otherwise they lie inside it.
export function niceTicks(min, max, target = 5, cover = false) {
  const raw = (max - min) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const first = (cover ? Math.floor(min / step) : Math.ceil(min / step)) * step;
  const last = cover ? Math.ceil(max / step) * step : max;
  const ticks = [];
  for (let v = first; v <= last + 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

export function shareContent() {
  const sourcesText = readFileSync(path.join(root, "data", "sources.json"), "utf8");
  const modelText = readFileSync(path.join(root, "model", "model.js"), "utf8");
  const ownText = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const byId = Object.fromEntries(JSON.parse(sourcesText).entries.map((e) => [e.id, e]));

  const params = Object.fromEntries(Object.entries(PARAM_IDS).map(([k, id]) => [k, byId[id].value]));
  const epsRange = byId[PARAM_IDS.eps].range;
  const breakeven = breakevenEpsilon(params);
  const atDefault = computeScenario(params);
  const points = sweepEpsilon(params, epsRange[0], epsRange[1], 200);
  const ratios = points.map((p) => p.ratio);
  const yTicks = niceTicks(Math.min(...ratios, 1), Math.max(...ratios, 1), 5, true);
  const xTicks = [epsRange[0], ...niceTicks(epsRange[0], epsRange[1]).filter((t) => t > epsRange[0] && t < epsRange[1]), epsRange[1]];

  const breakevenText = fmt(breakeven);
  const headline = `At default settings, total AI inference energy rises only if demand elasticity exceeds ${breakevenText}`;

  return {
    params,
    epsRange,
    breakeven,
    breakevenText,
    defaultEps: params.eps,
    defaultRatio: atDefault.E1 / atDefault.E0,
    points,
    xTicks,
    yTicks,
    headline,
    ogDescription: `${headline}. An interactive scenario study of the Jevons paradox for AI decision models, not a forecast.`,
    // Hash of everything the image content depends on: if the data, the model
    // or this file change, the committed images must be re-rendered.
    inputsHash: createHash("sha256").update(sourcesText).update(modelText).update(ownText).digest("hex"),
  };
}
