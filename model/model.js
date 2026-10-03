// Pure computation core for "The Jevons Question".
//
// Every formula here is derived and explained in METHODOLOGY.md. This module
// has no DOM/browser dependency so it can be unit-tested directly, inlined
// into the static page by scripts/build.mjs, and mirrored independently in
// verify/recompute.py for differential testing (see tests/model.test.js and
// verify/differential_test.py).
//
// No numeric constants describing the real world live in this file: every
// default parameter value comes from data/sources.json. The only literals
// here are either pure mathematics (0, 1, 0.5) or Monte Carlo *implementation*
// choices (sample count, PRNG constants) explicitly called out as such.

/**
 * Compute a single scenario.
 *
 * @param {object} p
 * @param {number} p.E0 - baseline annual AI inference energy in the chosen scope (TWh/yr)
 * @param {number} p.s - share of E0 spent on decision tasks (0..1)
 * @param {number} p.q - price ratio per decision, JEV/LLM (>0)
 * @param {number} p.eps - demand elasticity magnitude (>=0)
 * @param {number} p.r - energy ratio per decision, JEV/LLM (>=0)
 * @param {number} p.c - complementarity share (0..1)
 * @param {number} [p.globalElectricityDemandTwh] - optional denominator for share-of-global-demand output
 * @returns {object} scenario result, see inline fields below
 */
export function computeScenario(p) {
  const { E0, s, q, eps, r, c, globalElectricityDemandTwh } = p;

  for (const [name, v] of Object.entries({ E0, s, q, eps, r, c })) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new TypeError(`computeScenario: parameter '${name}' must be a finite number, got ${v}`);
    }
  }
  if (q <= 0) throw new RangeError("computeScenario: q must be > 0");
  if (E0 < 0) throw new RangeError("computeScenario: E0 must be >= 0");

  // Relative cost of a decision: JEV's price plus the LLM calls a fraction c
  // of decisions still make (METHODOLOGY.md §2). Demand responds to this
  // combined cost, not to JEV's price alone.
  const relativeCost = q + c;

  // Volume multiplier from the constant-elasticity demand curve (METHODOLOGY.md §2).
  const volumeRatio = Math.pow(relativeCost, -eps);

  // Decision-task-share energy after substitution (METHODOLOGY.md §3, eq. ★).
  const E_dec1 = s * E0 * (r + c) * volumeRatio;

  // Total energy (METHODOLOGY.md §4).
  const E1 = (1 - s) * E0 + E_dec1;

  const deltaE = E1 - E0;
  const deltaPct = E0 === 0 ? 0 : deltaE / E0;

  // Engineering (no-volume-response) change: every decision moves to the new
  // path, JEV plus the LLM calls the share c still makes (METHODOLOGY.md §7).
  // The complementary LLM energy is part of that path, not a rebound.
  const deltaPotential = s * E0 * (r + c - 1);

  const { classification, reboundFraction } = classifyOutcome(deltaE, deltaPotential);

  const result = {
    E0,
    E1,
    deltaE,
    deltaPct,
    deltaPotential,
    reboundFraction,
    classification,
    volumeRatio,
  };

  if (typeof globalElectricityDemandTwh === "number" && Number.isFinite(globalElectricityDemandTwh) && globalElectricityDemandTwh > 0) {
    result.shareOfGlobalDemandE0 = E0 / globalElectricityDemandTwh;
    result.shareOfGlobalDemandE1 = E1 / globalElectricityDemandTwh;
  }

  return result;
}

/**
 * Classify a scenario outcome from its actual and "potential" (no-rebound)
 * energy deltas. See METHODOLOGY.md §7 for the full derivation, including why
 * the RE >= 1 (backfire) boundary is an objective fact of the formula while
 * the "savings" vs "partial_rebound" split at RE = 0.5 is this project's own
 * documented narrative convention.
 *
 * @param {number} deltaE - actual E1 - E0
 * @param {number} deltaPotential - engineering s*E0*(r+c-1) counterfactual
 */
export function classifyOutcome(deltaE, deltaPotential) {
  if (deltaE >= 0) {
    // Total energy did not fall: this is backfire regardless of how we got
    // here (whether or not a genuine per-unit efficiency gain existed).
    return { classification: "backfire", reboundFraction: deltaPotential < 0 ? 1 - deltaE / deltaPotential : null };
  }
  if (deltaPotential >= 0) {
    // No genuine per-unit efficiency gain (r + c >= 1) yet total energy still
    // fell: only reachable when q + c > 1 (decisions got dearer, so volume
    // shrank), outside every range this project uses (METHODOLOGY.md §7).
    // Kept only as a safe fallback.
    return { classification: "savings", reboundFraction: null };
  }
  const reboundFraction = 1 - deltaE / deltaPotential;
  const classification = reboundFraction < 0.5 ? "savings" : "partial_rebound";
  return { classification, reboundFraction };
}

const OUTCOME_LABELS = {
  savings: "Efficiency wins",
  partial_rebound: "Partial rebound",
  backfire: "Jevons backfire",
};

export function outcomeLabel(classification) {
  return OUTCOME_LABELS[classification] ?? classification;
}

/**
 * mulberry32: a small, fast, deterministic 32-bit PRNG. Chosen specifically
 * because its integer operations are trivial to replicate bit-for-bit in
 * Python (see verify/recompute.py), which is required for the differential
 * test's Monte Carlo comparison (METHODOLOGY.md §9, check C.11).
 *
 * @param {number} seed - 32-bit unsigned integer seed
 * @returns {() => number} a function returning a float in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ ((t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw a Uniform(min, max) sample from a [0,1) generator.
 */
export function uniform(rng, min, max) {
  return min + rng() * (max - min);
}

/**
 * Monte Carlo analysis (METHODOLOGY.md §9). Samples s, r, eps, c uniformly
 * over their stated ranges; E0 and q are held fixed at their point estimates.
 * Draw order per iteration is fixed (s, r, eps, c) so the JS and Python
 * implementations consume the PRNG identically given the same seed.
 *
 * @param {object} ranges - { s: [min,max], r: [min,max], eps: [min,max], c: [min,max] }
 * @param {object} fixed - { E0, q, globalElectricityDemandTwh }
 * @param {number} n - sample count (implementation detail, not empirical data; METHODOLOGY.md §10, R4: >= 10000)
 * @param {number} seed - PRNG seed (implementation detail; METHODOLOGY.md §10, R4: fixed seed)
 */
export function runMonteCarlo(ranges, fixed, n = 10000, seed = 0x5eed1234) {
  const rng = mulberry32(seed);
  const ratios = new Array(n);
  let backfireCount = 0;
  let breakevenSum = 0;
  let breakevenCount = 0;

  for (let i = 0; i < n; i++) {
    const s = uniform(rng, ranges.s[0], ranges.s[1]);
    const r = uniform(rng, ranges.r[0], ranges.r[1]);
    const eps = uniform(rng, ranges.eps[0], ranges.eps[1]);
    const c = uniform(rng, ranges.c[0], ranges.c[1]);

    const scenario = computeScenario({ E0: fixed.E0, s, q: fixed.q, eps, r, c });
    ratios[i] = scenario.E1 / fixed.E0;
    if (scenario.classification === "backfire") backfireCount++;

    const breakeven = breakevenEpsilon({ q: fixed.q, r, c });
    if (breakeven !== null) {
      breakevenSum += breakeven;
      breakevenCount++;
    }
  }

  return {
    n,
    seed,
    ratios,
    backfireProbability: backfireCount / n,
    // Mean breakeven elasticity over samples that have one (METHODOLOGY.md §9):
    // with eps uniform on its range, P(backfire) ≈ (eps_max - this) / (eps_max - eps_min).
    meanBreakeven: breakevenCount > 0 ? breakevenSum / breakevenCount : null,
    ...summaryStats(ratios),
  };
}

/**
 * Basic summary statistics for a numeric sample array (mean + quantiles).
 * Quantiles use linear interpolation between closest ranks.
 */
export function summaryStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((acc, v) => acc + v, 0) / n;
  const quantile = (q) => {
    const pos = q * (n - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  return {
    mean,
    min: sorted[0],
    max: sorted[n - 1],
    p05: quantile(0.05),
    p10: quantile(0.1),
    p25: quantile(0.25),
    median: quantile(0.5),
    p75: quantile(0.75),
    p90: quantile(0.9),
    p95: quantile(0.95),
  };
}

/**
 * Breakeven elasticity (METHODOLOGY.md §4, "General breakeven"): the eps at
 * which E1 = E0, i.e. (r + c)·(q + c)^(-eps) = 1. Total energy rises above E0
 * iff eps > this value. Returns null outside 0 < q + c < 1 and 0 < r + c < 1,
 * where no positive breakeven exists (see METHODOLOGY.md §4).
 *
 * @returns {number|null}
 */
export function breakevenEpsilon({ q, r, c }) {
  const cost = q + c;
  const energy = r + c;
  if (!(cost > 0 && cost < 1 && energy > 0 && energy < 1)) return null;
  return Math.log(energy) / Math.log(cost);
}

/**
 * Sweep E1/E0 as a function of eps for a fixed q, r, c, s — used for the
 * "threshold" chart that highlights eps = 1 (METHODOLOGY.md §4).
 *
 * @returns {Array<{eps: number, ratio: number}>}
 */
export function sweepEpsilon({ E0, s, q, r, c }, epsMin, epsMax, steps = 100) {
  const out = new Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    const eps = epsMin + ((epsMax - epsMin) * i) / steps;
    const { E1 } = computeScenario({ E0, s, q, eps, r, c });
    out[i] = { eps, ratio: E1 / E0 };
  }
  return out;
}
