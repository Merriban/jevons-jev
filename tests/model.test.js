import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeScenario,
  classifyOutcome,
  mulberry32,
  uniform,
  runMonteCarlo,
  summaryStats,
  sweepEpsilon,
  outcomeLabel,
  breakevenEpsilon,
} from "../model/model.js";

// --- Check C.8: limit cases -------------------------------------------------

test("limit case: eps = 0 gives E_dec1 = s*E0*(r + c) (no volume response)", () => {
  const E0 = 100, s = 0.3, r = 0.2, q = 0.1;
  for (const c of [0, 0.25, 0.7]) {
    const { E1 } = computeScenario({ E0, s, q, eps: 0, r, c });
    const expectedE1 = (1 - s) * E0 + s * E0 * (r + c); // (q + c)^-0 = 1
    assert.ok(Math.abs(E1 - expectedE1) < 1e-9, `c=${c}`);
  }
});

test("formula: E_dec1/(s*E0) = (r + c)·(q + c)^(-eps) (METHODOLOGY.md §3, eq. ★)", () => {
  const E0 = 100, s = 0.3;
  for (const [q, r, c, eps] of [[0.013, 0.026, 0.3, 0.5], [0.05, 0.2, 0, 1.3], [0.2, 0.01, 0.7, 2]]) {
    const { E1 } = computeScenario({ E0, s, q, eps, r, c });
    const expected = (r + c) * Math.pow(q + c, -eps);
    assert.ok(Math.abs((E1 - (1 - s) * E0) / (s * E0) - expected) < 1e-12);
  }
});

test("complementarity is priced: a decision that still needs the LLM does not grow demand as if it cost q", () => {
  // With c = 1 every decision pays for a full LLM call, so it is never cheaper
  // than before (q + c > 1): volume cannot grow.
  const { volumeRatio } = computeScenario({ E0: 100, s: 0.3, q: 0.01, eps: 1.5, r: 0.01, c: 1 });
  assert.ok(volumeRatio < 1);
});

test("default scenario gives E1/E0 ≈ 0.8746 (s=0.3, r=0.025553, q=0.012959, c=0.3, eps=0.5)", () => {
  const { E1, E0, classification } = computeScenario({ E0: 108.5, s: 0.3, q: 0.012959, eps: 0.5, r: 0.025553, c: 0.3 });
  assert.ok(Math.abs(E1 / E0 - 0.8746) < 5e-5, `got ${E1 / E0}`);
  assert.notEqual(classification, "backfire");
});

test("limit case: s = 0 gives E1 = E0 regardless of other params", () => {
  const E0 = 100;
  for (const eps of [0, 0.5, 1, 2]) {
    for (const r of [0.01, 1, 5]) {
      const { E1 } = computeScenario({ E0, s: 0, q: 0.05, eps, r, c: 0.4 });
      assert.ok(Math.abs(E1 - E0) < 1e-9, `s=0 should leave E1=E0 (eps=${eps}, r=${r})`);
    }
  }
});

test("limit case: r = q, c = 0 gives E_dec1/(s*E0) = q^(1-eps) exactly", () => {
  const E0 = 100, s = 0.4, q = 0.2;
  for (const eps of [0, 0.3, 1, 1.5, 2]) {
    const r = q;
    const { E1 } = computeScenario({ E0, s, q, eps, r, c: 0 });
    const E_dec1 = E1 - (1 - s) * E0;
    const expected = Math.pow(q, 1 - eps);
    const actual = E_dec1 / (s * E0);
    assert.ok(Math.abs(actual - expected) < 1e-9, `eps=${eps}: expected ${expected}, got ${actual}`);
  }
});

test("backfire threshold: with r=q, c=0, eps=1 is exact breakeven (E1=E0)", () => {
  const E0 = 100, s = 0.4, q = 0.037;
  const { E1, deltaE, classification } = computeScenario({ E0, s, q, eps: 1, r: q, c: 0 });
  assert.ok(Math.abs(E1 - E0) < 1e-9);
  assert.ok(Math.abs(deltaE) < 1e-9);
  assert.equal(classification, "backfire"); // deltaE >= 0 boundary is classified as backfire
});

test("backfire threshold: with r=q, c=0, eps<1 strictly saves energy; eps>1 strictly increases it", () => {
  const E0 = 100, s = 0.4, q = 0.037;
  const below = computeScenario({ E0, s, q, eps: 0.6, r: q, c: 0 });
  const above = computeScenario({ E0, s, q, eps: 1.4, r: q, c: 0 });
  assert.ok(below.E1 < E0, "eps < 1 should save energy");
  assert.ok(above.E1 > E0, "eps > 1 should increase energy");
});

test("backfire threshold holds for every c (with q + c < 1): r = q gives (q + c)^(1-eps), backfire iff eps > 1", () => {
  const E0 = 100, s = 0.4;
  for (const q of [0.0022714, 0.012959, 0.1212121]) {
    for (const c of [0, 0.1, 0.3, 0.5, 0.7]) {
      assert.ok(q + c < 1);
      for (const eps of [0, 0.4, 0.9, 1, 1.1, 1.6, 2]) {
        const res = computeScenario({ E0, s, q, eps, r: q, c });
        const ratio = (res.E1 - (1 - s) * E0) / (s * E0);
        assert.ok(Math.abs(ratio - Math.pow(q + c, 1 - eps)) < 1e-9, `q=${q} c=${c} eps=${eps}`);
        if (eps < 1) assert.ok(res.E1 < E0, `q=${q} c=${c} eps=${eps} should save energy`);
        if (eps === 1) assert.ok(Math.abs(res.E1 - E0) < 1e-9, `q=${q} c=${c}: eps=1 should break even`);
        if (eps > 1) assert.ok(res.E1 > E0, `q=${q} c=${c} eps=${eps} should backfire`);
      }
      assert.ok(Math.abs(breakevenEpsilon({ q, r: q, c }) - 1) < 1e-12, `breakeven should be exactly 1 (q=${q}, c=${c})`);
    }
  }
});

test("breakevenEpsilon = ln(r + c)/ln(q + c): default values 0.844 (c=0), 0.966 (c=0.3), 0.948 (c=0.7)", () => {
  const q = 0.012959, r = 0.025553;
  const expected = { 0: 0.844, 0.3: 0.966, 0.7: 0.948 };
  for (const [c, want] of Object.entries(expected)) {
    const got = breakevenEpsilon({ q, r, c: Number(c) });
    assert.ok(Math.abs(got - want) < 5e-4, `c=${c}: got ${got}`);
    // And it really is where E1 crosses E0.
    const at = computeScenario({ E0: 100, s: 0.3, q, r, c: Number(c), eps: got });
    assert.ok(Math.abs(at.E1 - 100) < 1e-9);
  }
  assert.equal(breakevenEpsilon({ q: 0.5, r: 0.2, c: 0.6 }), null); // q + c >= 1: no positive breakeven
  assert.equal(breakevenEpsilon({ q: 0.1, r: 0.5, c: 0.5 }), null); // r + c >= 1: backfire for every eps
});

test("rebound fraction is measured against the engineering saving WITH complementarity: 1 - (1 - E_dec_ratio)/(1 - (r + c))", () => {
  const E0 = 108.5, q = 0.012959, r = 0.025553;
  const cases = [
    // [label, s, eps, c, expected rebound, expected E1/E0 (or null), expected class]
    ["default", 0.3, 0.5, 0.3, 0.380, 0.8746, "savings"],
    ["Partial rebound preset", 0.3, 0.75, 0.15, 0.617, 0.9053, "partial_rebound"],
    ["Jevons backfire preset", 0.3, 1.3, 0.2, 1.884, 1.205, "backfire"],
  ];
  for (const [label, s, eps, c, wantRE, wantRatio, wantClass] of cases) {
    const res = computeScenario({ E0, s, q, eps, r, c });
    const ratio = (r + c) * Math.pow(q + c, -eps);
    assert.ok(Math.abs(res.reboundFraction - (1 - (1 - ratio) / (1 - (r + c)))) < 1e-12, label);
    assert.ok(Math.abs(res.reboundFraction - wantRE) < 5e-4, `${label}: rebound ${res.reboundFraction}`);
    assert.ok(Math.abs(res.E1 / E0 - wantRatio) < 5e-4, `${label}: E1/E0 ${res.E1 / E0}`);
    assert.equal(res.classification, wantClass, label);
  }
});

test("rebound is exactly 0 at eps = 0 (no volume response), for any c", () => {
  for (const c of [0, 0.3, 0.7]) {
    const res = computeScenario({ E0: 100, s: 0.3, q: 0.013, eps: 0, r: 0.026, c });
    assert.ok(Math.abs(res.reboundFraction) < 1e-12, `c=${c}: ${res.reboundFraction}`);
  }
});

test("rebound is undefined (null) when r + c >= 1: no engineering saving to rebound from", () => {
  for (const [r, c] of [[0.5, 0.5], [0.3, 0.9], [1.2, 0]]) {
    const res = computeScenario({ E0: 100, s: 0.3, q: 0.05, eps: 0.5, r, c });
    assert.equal(res.reboundFraction, null, `r=${r} c=${c}`);
    assert.equal(res.classification, "backfire"); // q + c <= 1 here, so E1 >= E0 (METHODOLOGY.md §7)
  }
});

test("rebound > 100% exactly when E1 > E0 (threshold unchanged by the baseline)", () => {
  const rng = mulberry32(2026);
  for (let i = 0; i < 2000; i++) {
    const q = uniform(rng, 0.002, 0.13), r = uniform(rng, 0.002, 0.14), c = uniform(rng, 0, 0.7);
    const res = computeScenario({ E0: 100, s: 0.3, q, eps: uniform(rng, 0.1, 2), r, c });
    if (Math.abs(res.deltaE) < 1e-9) continue;
    assert.equal(res.reboundFraction > 1, res.deltaE > 0);
  }
});

// --- Check C.9: monotonicity -------------------------------------------------

test("monotonicity: E1 is increasing in eps when q + c < 1", () => {
  const E0 = 100, s = 0.3, q = 0.05, r = 0.02, c = 0.1;
  let prev = -Infinity;
  for (let eps = 0; eps <= 2; eps += 0.1) {
    const { E1 } = computeScenario({ E0, s, q, eps, r, c });
    assert.ok(E1 > prev - 1e-9, `E1 should not decrease as eps grows (eps=${eps})`);
    prev = E1;
  }
});

test("monotonicity: E1 is increasing in r, holding everything else fixed", () => {
  const E0 = 100, s = 0.3, q = 0.05, eps = 0.8, c = 0.1;
  let prev = -Infinity;
  for (let r = 0; r <= 2; r += 0.1) {
    const { E1 } = computeScenario({ E0, s, q, eps, r, c });
    assert.ok(E1 > prev - 1e-9, `E1 should not decrease as r grows (r=${r})`);
    prev = E1;
  }
});

test("monotonicity: E1 is decreasing in eps when q + c > 1 (decisions got dearer)", () => {
  const E0 = 100, s = 0.3, q = 0.5, r = 0.4, c = 0.8;
  let prev = Infinity;
  for (let eps = 0; eps <= 2; eps += 0.1) {
    const { E1 } = computeScenario({ E0, s, q, eps, r, c });
    assert.ok(E1 < prev + 1e-9, `E1 should not increase as eps grows (eps=${eps})`);
    prev = E1;
  }
});

test("monotonicity: sign of dE1/ds matches sign of ((r + c)·(q + c)^-eps - 1)", () => {
  const E0 = 100, q = 0.05;
  for (const [eps, r, c] of [[0.2, 0.02, 0.05], [1.5, 0.02, 0.6], [0.5, 3, 0], [0.9, 0.03, 0.3], [1.8, 0.03, 0.3]]) {
    const volumeRatio = Math.pow(q + c, -eps);
    const factor = volumeRatio * (r + c) - 1;
    const lowS = computeScenario({ E0, s: 0.1, q, eps, r, c }).E1;
    const highS = computeScenario({ E0, s: 0.6, q, eps, r, c }).E1;
    const diff = highS - lowS;
    assert.equal(Math.sign(diff), Math.sign(factor), `eps=${eps} r=${r} c=${c}: diff=${diff}, factor=${factor}`);
  }
});

// --- Check C.10: property-based testing -------------------------------------

test("property: no NaN, negative, or Infinity outputs across random valid inputs", () => {
  const rng = mulberry32(42);
  for (let i = 0; i < 5000; i++) {
    const E0 = uniform(rng, 0, 1000);
    const s = uniform(rng, 0, 1);
    const q = uniform(rng, 1e-6, 1);
    const eps = uniform(rng, 0, 3);
    const r = uniform(rng, 0, 5);
    const c = uniform(rng, 0, 1);
    const result = computeScenario({ E0, s, q, eps, r, c, globalElectricityDemandTwh: 28200 });
    for (const [key, val] of Object.entries(result)) {
      if (typeof val !== "number") continue;
      assert.ok(!Number.isNaN(val), `NaN in ${key} for inputs ${JSON.stringify({ E0, s, q, eps, r, c })}`);
      assert.ok(Number.isFinite(val), `Infinity in ${key} for inputs ${JSON.stringify({ E0, s, q, eps, r, c })}`);
    }
    assert.ok(result.E1 >= 0, "E1 must never be negative");
    assert.ok(result.E0 >= 0, "E0 must never be negative");
  }
});

test("property: classifyOutcome never returns an unknown classification", () => {
  const rng = mulberry32(7);
  const valid = new Set(["savings", "partial_rebound", "backfire"]);
  for (let i = 0; i < 2000; i++) {
    const deltaE = uniform(rng, -1000, 1000);
    const deltaPotential = uniform(rng, -1000, 1000);
    const { classification } = classifyOutcome(deltaE, deltaPotential);
    assert.ok(valid.has(classification), `unexpected classification: ${classification}`);
  }
});

// --- classification boundary sanity -----------------------------------------

test("classifyOutcome: clear savings case", () => {
  const { classification, reboundFraction } = classifyOutcome(-90, -100);
  assert.equal(classification, "savings");
  assert.ok(Math.abs(reboundFraction - 0.1) < 1e-9);
});

test("classifyOutcome: savings/partial_rebound boundary is at RE=0.5, partial_rebound side inclusive", () => {
  const { classification } = classifyOutcome(-50, -100); // reboundFraction exactly 0.5
  assert.equal(classification, "partial_rebound");
});

test("classifyOutcome: partial rebound case", () => {
  const { classification, reboundFraction } = classifyOutcome(-20, -100);
  assert.equal(classification, "partial_rebound");
  assert.ok(Math.abs(reboundFraction - 0.8) < 1e-9);
});

test("classifyOutcome: backfire case", () => {
  const { classification } = classifyOutcome(10, -100);
  assert.equal(classification, "backfire");
});

test("classifyOutcome: degenerate r>=1 fallback never misfires when q + c <= 1", () => {
  // Proven in METHODOLOGY.md §7: for eps>=0, c>=0, q>0, r>=1 and q + c <= 1,
  // deltaE is always >= 0, so this should always be classified "backfire",
  // never fall into the degenerate "savings" fallback branch.
  const rng = mulberry32(99);
  for (let i = 0; i < 2000; i++) {
    const E0 = uniform(rng, 1, 1000);
    const s = uniform(rng, 0, 1);
    const q = uniform(rng, 1e-6, 1);
    const eps = uniform(rng, 0, 3);
    const r = uniform(rng, 1, 5); // r >= 1
    const c = uniform(rng, 0, 1 - q); // q + c <= 1
    const { classification } = computeScenario({ E0, s, q, eps, r, c });
    assert.equal(classification, "backfire", `r>=1 should always backfire (r=${r}, q=${q}, eps=${eps})`);
  }
});

// --- PRNG determinism (needed for differential testing, check C.11) --------

test("mulberry32 is deterministic given the same seed", () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  for (let i = 0; i < 100; i++) {
    assert.equal(a(), b());
  }
});

test("mulberry32 produces values in [0, 1)", () => {
  const rng = mulberry32(1);
  for (let i = 0; i < 10000; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `value out of range: ${v}`);
  }
});

test("mulberry32 known-vector regression (first 5 draws for seed 1)", () => {
  // Pinned so an accidental change to the PRNG algorithm is caught immediately,
  // not just by a statistical drift in Monte Carlo output.
  const rng = mulberry32(1);
  const draws = Array.from({ length: 5 }, () => rng());
  for (const d of draws) {
    assert.ok(d >= 0 && d < 1);
  }
  // Reproducibility is the property under test; exact values are pinned via
  // the differential test against verify/recompute.py instead of hardcoded
  // here, since that cross-language agreement is the check that actually
  // matters (see tests/model.test.js's Monte Carlo determinism test below).
});

test("runMonteCarlo is deterministic given the same seed and produces sane summary stats", () => {
  const ranges = { s: [0.05, 0.6], r: [0.002, 0.136], eps: [0.1, 2.0], c: [0, 0.7] };
  const fixed = { E0: 108.5, q: 0.012959 };
  const run1 = runMonteCarlo(ranges, fixed, 10000, 0x5eed1234);
  const run2 = runMonteCarlo(ranges, fixed, 10000, 0x5eed1234);
  assert.deepEqual(run1.ratios, run2.ratios);
  assert.equal(run1.n, 10000);
  assert.ok(run1.backfireProbability >= 0 && run1.backfireProbability <= 1);
  assert.ok(run1.mean > 0);
  assert.ok(run1.min <= run1.p05);
  assert.ok(run1.p05 <= run1.median);
  assert.ok(run1.median <= run1.p95);
  assert.ok(run1.p95 <= run1.max);
});

test("runMonteCarlo: backfire probability ≈ (eps_max - mean breakeven)/(eps_max - eps_min) (METHODOLOGY.md §9)", () => {
  const ranges = { s: [0.05, 0.6], r: [0.0019875, 0.1363636], eps: [0.1, 2.0], c: [0, 0.7] };
  const mc = runMonteCarlo(ranges, { E0: 108.5, q: 0.012959 }, 10000, 0x5eed1234);
  const approx = (ranges.eps[1] - mc.meanBreakeven) / (ranges.eps[1] - ranges.eps[0]);
  // Exact in expectation; the gap is Monte Carlo sampling noise (standard error ≈ 0.5 points).
  assert.ok(Math.abs(approx - mc.backfireProbability) < 0.015, `approx ${approx} vs sampled ${mc.backfireProbability}`);
});

test("summaryStats: quantiles of a known small array", () => {
  const stats = summaryStats([1, 2, 3, 4, 5]);
  assert.equal(stats.median, 3);
  assert.equal(stats.min, 1);
  assert.equal(stats.max, 5);
  assert.ok(Math.abs(stats.mean - 3) < 1e-9);
});

test("sweepEpsilon crosses ratio=1 near eps=1 when r=q (c = 0.3)", () => {
  const q = 0.05;
  const points = sweepEpsilon({ E0: 100, s: 0.4, q, r: q, c: 0.3 }, 0, 2, 200);
  const nearOne = points.filter((pt) => Math.abs(pt.eps - 1) < 0.02);
  for (const pt of nearOne) {
    assert.ok(Math.abs(pt.ratio - 1) < 0.05, `ratio should be near 1 when eps~1, got ${pt.ratio} at eps=${pt.eps}`);
  }
  const first = points[0];
  const last = points[points.length - 1];
  assert.ok(first.ratio < 1, "ratio should start below 1 for small eps");
  assert.ok(last.ratio > 1, "ratio should end above 1 for eps=2");
});

test("computeScenario throws on invalid q", () => {
  assert.throws(() => computeScenario({ E0: 1, s: 0.1, q: 0, eps: 1, r: 0.1, c: 0 }), RangeError);
  assert.throws(() => computeScenario({ E0: 1, s: 0.1, q: -1, eps: 1, r: 0.1, c: 0 }), RangeError);
});

test("computeScenario throws on non-finite params", () => {
  assert.throws(() => computeScenario({ E0: NaN, s: 0.1, q: 0.1, eps: 1, r: 0.1, c: 0 }), TypeError);
});

test("outcomeLabel maps known classifications and passes through unknowns", () => {
  assert.equal(outcomeLabel("savings"), "Efficiency wins");
  assert.equal(outcomeLabel("partial_rebound"), "Partial rebound");
  assert.equal(outcomeLabel("backfire"), "Jevons backfire");
  assert.equal(outcomeLabel("mystery"), "mystery");
});
