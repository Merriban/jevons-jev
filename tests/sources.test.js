// Checks A.1, A.2, A.3 (METHODOLOGY.md §10): schema validation, evidence
// containment for verified entries, and derived-value recomputation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcesPath = path.join(__dirname, "..", "data", "sources.json");
const raw = readFileSync(sourcesPath, "utf8");
const registry = JSON.parse(raw);
const entries = registry.entries;

const VALID_KINDS = ["measured", "vendor_claim", "estimate", "self_report", "derived", "scenario_parameter"];
const VALID_STATUSES = ["verified", "unverified", "derived"];
const REQUIRED_FIELDS = [
  "id", "value", "unit", "description", "kind", "status",
  "source_url", "source_title", "publisher", "published_date",
  "accessed_date", "evidence", "derivation", "range", "notes",
];

test("sources.json parses and has at least one entry", () => {
  assert.ok(Array.isArray(entries));
  assert.ok(entries.length > 0);
});

test("check A.1: every entry has all required fields with correct types", () => {
  for (const e of entries) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(field in e, `entry ${e.id ?? "?"} missing field '${field}'`);
    }
    assert.equal(typeof e.id, "string");
    assert.equal(typeof e.value, "number", `${e.id}: value must be a number`);
    assert.ok(Number.isFinite(e.value), `${e.id}: value must be finite`);
    assert.equal(typeof e.unit, "string");
    assert.equal(typeof e.description, "string");
    assert.ok(VALID_KINDS.includes(e.kind), `${e.id}: invalid kind '${e.kind}'`);
    assert.ok(VALID_STATUSES.includes(e.status), `${e.id}: invalid status '${e.status}'`);
    assert.ok(typeof e.accessed_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.accessed_date), `${e.id}: accessed_date must be YYYY-MM-DD`);
    if (e.published_date !== null) {
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(e.published_date), `${e.id}: published_date must be YYYY-MM-DD or null`);
    }
    if (e.range !== null) {
      assert.ok(Array.isArray(e.range) && e.range.length === 2, `${e.id}: range must be [min, max] or null`);
      assert.ok(e.range[0] <= e.range[1], `${e.id}: range min must be <= max`);
    }
  }
});

test("check A.1: ids are unique", () => {
  const ids = entries.map((e) => e.id);
  const seen = new Set();
  for (const id of ids) {
    assert.ok(!seen.has(id), `duplicate id: ${id}`);
    seen.add(id);
  }
});

test("check A.1: status is coherent with kind", () => {
  for (const e of entries) {
    if (e.kind === "derived") {
      assert.equal(e.status, "derived", `${e.id}: kind=derived must have status=derived`);
      assert.ok(e.derivation, `${e.id}: derived entry must state its derivation`);
    } else {
      assert.notEqual(e.status, "derived", `${e.id}: only kind=derived may have status=derived`);
    }
    if (e.status === "verified") {
      // "verified" means a primary source was actually opened: must have a real URL and evidence.
      assert.ok(e.source_url, `${e.id}: verified entry must have a source_url`);
      assert.ok(e.evidence, `${e.id}: verified entry must have evidence`);
    }
  }
});

test("check A.2: every verified entry's evidence contains its numeric value", () => {
  for (const e of entries) {
    if (e.status !== "verified") continue;
    // Strip thousands separators: commas, and spaces between digit groups
    // (e.g. IEA's "28 200 TWh").
    const normalizedEvidence = e.evidence.replace(/,/g, "").replace(/(\d)[\s\u00a0\u202f](?=\d{3}(?!\d))/g, "$1");
    // Accept the value formatted with or without trailing zeros (e.g. 0.10 vs 0.1).
    const asWritten = String(e.value);
    const trimmedTrailingZero = asWritten.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    const candidates = new Set([asWritten, trimmedTrailingZero]);
    // Also accept the value printed with exactly the decimal precision seen in evidence,
    // e.g. value 0.1 printed as "0.10" in the source's own prose.
    for (let decimals = 0; decimals <= 4; decimals++) {
      candidates.add(e.value.toFixed(decimals));
    }
    // A multiplier the source states in words ("tripling") counts as its number.
    const MULTIPLIER_WORDS = { 2: /\bdoubl(e|es|ed|ing)\b/i, 3: /\btripl(e|es|ed|ing)\b/i };
    const found =
      [...candidates].some((c) => normalizedEvidence.includes(c)) ||
      (/multiplier/.test(e.unit) && MULTIPLIER_WORDS[e.value]?.test(normalizedEvidence) === true);
    assert.ok(found, `${e.id}: evidence "${e.evidence}" does not appear to contain value ${e.value}`);
  }
});

test("check R2: evidence quotes stay under 15 words", () => {
  for (const e of entries) {
    if (!e.evidence) continue;
    const wordCount = e.evidence.trim().split(/\s+/).length;
    assert.ok(wordCount <= 15, `${e.id}: evidence has ${wordCount} words (max 15): "${e.evidence}"`);
  }
});

function getEntry(id) {
  const e = entries.find((x) => x.id === id);
  assert.ok(e, `expected entry ${id} to exist`);
  return e;
}

// The 8 LLM configurations in TypeSafe's workflow-eval table (evals.typesafe.ai).
const EVAL_CONFIGS = ["haiku_4_5", "opus_5", "sonnet_5", "ds_v4_flash", "ds_v4_pro", "luna", "sol", "terra"];

function geometricMean(values) {
  return Math.exp(values.reduce((acc, v) => acc + Math.log(v), 0) / values.length);
}

function assertClose(actual, expected, label, tol = 0.005) {
  const relErr = Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(relErr < tol, `${label}: ${actual} vs expected ${expected} (off by ${(relErr * 100).toFixed(3)}%)`);
}

// Accuracy is quoted inside each workflow-eval row's evidence ("... · 67.8% · ...").
function evalAccuracy(id) {
  const m = getEntry(id).evidence.match(/(\d+(?:\.\d+)?)%/);
  assert.ok(m, `${id}: no accuracy percentage in evidence`);
  return Number(m[1]);
}

test("check A.3: q_price_ratio recomputes from the 8 workflow-eval configurations within 0.5%", () => {
  const cost = getEntry("typesafe_cost_per_case_usd").value;
  const ratios = EVAL_CONFIGS.map((c) => cost / getEntry(`typesafe_eval_${c}_cost_usd`).value);
  const q = getEntry("q_price_ratio");
  assertClose(q.value, geometricMean(ratios), "q_price_ratio");
  assertClose(q.range[0], Math.min(...ratios), "q_price_ratio.range[0]");
  assertClose(q.range[1], Math.max(...ratios), "q_price_ratio.range[1]");
});

test("check A.3: q_price_ratio_accuracy_matched uses exactly the configurations within ~1 accuracy point of Jev", () => {
  const jevAcc = evalAccuracy("typesafe_cost_per_case_usd");
  const matched = EVAL_CONFIGS.filter((c) => Math.abs(evalAccuracy(`typesafe_eval_${c}_cost_usd`) - jevAcc) <= 1.05);
  assert.deepEqual(matched.sort(), ["luna", "sonnet_5", "terra"]);
  const cost = getEntry("typesafe_cost_per_case_usd").value;
  const expected = geometricMean(matched.map((c) => cost / getEntry(`typesafe_eval_${c}_cost_usd`).value));
  assertClose(getEntry("q_price_ratio_accuracy_matched").value, expected, "q_price_ratio_accuracy_matched");
});

test("check A.3: r_cost_proxy equals q_price_ratio exactly", () => {
  assert.equal(getEntry("r_cost_proxy").value, getEntry("q_price_ratio").value);
  assert.deepEqual(getEntry("r_cost_proxy").range, getEntry("q_price_ratio").range);
});

test("check A.3: r_latency_proxy recomputes from the same 8 workflow-eval configurations within 0.5%", () => {
  const jevLatency = getEntry("typesafe_latency_per_case_s").value;
  const ratios = EVAL_CONFIGS.map((c) => jevLatency / getEntry(`typesafe_eval_${c}_latency_s`).value);
  const r = getEntry("r_latency_proxy");
  assertClose(r.value, geometricMean(ratios), "r_latency_proxy");
  assertClose(r.range[0], Math.min(...ratios), "r_latency_proxy.range[0]");
  assertClose(r.range[1], Math.max(...ratios), "r_latency_proxy.range[1]");
});

test("check A.3: r_tokens_proxy recomputes from stated inputs within 0.5%", () => {
  const jevTok = getEntry("arize_jev_tokens_per_decision").value;
  const llmTok = getEntry("arize_llm_tokens_per_decision").value;
  const expected = jevTok / llmTok;
  const actual = getEntry("r_tokens_proxy").value;
  const relErr = Math.abs(actual - expected) / expected;
  assert.ok(relErr < 0.005, `r_tokens_proxy off by ${(relErr * 100).toFixed(3)}%`);
});

test("check A.3: r_energy_ratio recomputes from its three proxies within 0.5%", () => {
  const a = getEntry("r_cost_proxy").value;
  const b = getEntry("r_latency_proxy").value;
  const c = getEntry("r_tokens_proxy").value;
  const expected = Math.cbrt(a * b * c);
  const actual = getEntry("r_energy_ratio").value;
  const relErr = Math.abs(actual - expected) / expected;
  assert.ok(relErr < 0.005, `r_energy_ratio off by ${(relErr * 100).toFixed(3)}%`);
});

test("check A.3: r_energy_ratio's range is the proxy envelope widened by Jev's ±12.5% rounding", () => {
  const lo = Math.min(getEntry("r_cost_proxy").range[0], getEntry("r_latency_proxy").range[0], getEntry("r_tokens_proxy").value);
  const hi = Math.max(getEntry("r_cost_proxy").range[1], getEntry("r_latency_proxy").range[1], getEntry("r_tokens_proxy").value);
  const range = getEntry("r_energy_ratio").range;
  assertClose(range[0], lo * 0.875, "r_energy_ratio.range[0]");
  assertClose(range[1], hi * 1.125, "r_energy_ratio.range[1]");
  // The widened range must contain every ratio Jev's unrounded cost/latency could produce.
  const cost = getEntry("typesafe_cost_per_case_usd").value;
  const latency = getEntry("typesafe_latency_per_case_s").value;
  for (const c of EVAL_CONFIGS) {
    for (const k of [0.875, 1.125]) {
      for (const ratio of [(cost * k) / getEntry(`typesafe_eval_${c}_cost_usd`).value, (latency * k) / getEntry(`typesafe_eval_${c}_latency_s`).value]) {
        assert.ok(ratio >= range[0] * (1 - 1e-6) && ratio <= range[1] * (1 + 1e-6), `${c}: ratio ${ratio} outside r range`);
      }
    }
  }
});

test("TypeSafe's peak claims are consistent with its own workflow-eval table, within Jev's ±12.5% rounding", () => {
  const jevCost = getEntry("typesafe_cost_per_case_usd").value;
  const jevLatency = getEntry("typesafe_latency_per_case_s").value;
  const cheaper = getEntry("typesafe_peak_cost_reduction_claim").value;
  const faster = getEntry("typesafe_peak_speedup_claim").value;
  const opusCost = getEntry("typesafe_eval_opus_5_cost_usd").value;
  const sonnetLatency = getEntry("typesafe_eval_sonnet_5_latency_s").value;
  // Jev's true value lies in [0.875, 1.125] × its rounded value, so the true ratio
  // lies in [ratio / 1.125, ratio / 0.875].
  const costRatio = opusCost / jevCost;
  assert.ok(cheaper >= costRatio / 1.125 && cheaper <= costRatio / 0.875, `${cheaper}x vs ${costRatio.toFixed(1)}x`);
  const speedRatio = sonnetLatency / jevLatency;
  assert.ok(faster >= speedRatio / 1.125 && faster <= speedRatio / 0.875, `${faster}x vs ${speedRatio.toFixed(1)}x`);
});

test("check A.3: E0_default_twh recomputes from stated inputs within 0.5%", () => {
  const dc = getEntry("iea_ai_focused_dc_2025_twh").value;
  const share = getEntry("inference_share_of_ai_compute").value;
  const expected = dc * share;
  const actual = getEntry("E0_default_twh").value;
  const relErr = Math.abs(actual - expected) / expected;
  assert.ok(relErr < 0.005, `E0_default_twh off by ${(relErr * 100).toFixed(3)}%`);
  const dcRange = getEntry("iea_ai_focused_dc_2025_twh").range;
  const shareRange = getEntry("inference_share_of_ai_compute").range;
  const range = getEntry("E0_default_twh").range;
  assertClose(range[0], dcRange[0] * shareRange[0], "E0_default_twh.range[0]");
  assertClose(range[1], dcRange[1] * shareRange[1], "E0_default_twh.range[1]");
});

test("check D.13: 2030 datacenter share reconciles with IEA's stated ~3%", () => {
  const dc2030 = getEntry("iea_dc_total_2030_twh").value;
  const global2030 = getEntry("global_electricity_demand_2030_twh").value;
  const computedPct = (dc2030 / global2030) * 100;
  const statedPct = getEntry("iea_dc_share_2030_pct").value;
  // Generous tolerance: these come from independently-sourced figures in the
  // same report family, rounding in the underlying report is expected.
  assert.ok(Math.abs(computedPct - statedPct) < 1, `computed ${computedPct.toFixed(2)}% vs stated ${statedPct}%`);
});

test("check D.12: E0 range never exceeds total datacenter electricity consumption", () => {
  const e0 = getEntry("E0_default_twh");
  const dcTotal = getEntry("iea_dc_total_2025_twh").value;
  assert.ok(e0.value < dcTotal);
  assert.ok(e0.range[1] < dcTotal, "E0's upper range bound must stay below total datacenter consumption");
});

test("scope/perimeter check B.7: GPU-only and whole-system Gemini figures are distinct entries, never summed", () => {
  const chipOnly = getEntry("google_gemini_chip_only_wh");
  const total = getEntry("google_gemini_median_wh");
  assert.ok(chipOnly.value < total.value, "chip-only figure should be smaller than the whole-system figure");
  assert.notEqual(chipOnly.id, total.id);
});
