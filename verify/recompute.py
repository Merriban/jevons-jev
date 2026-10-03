"""Independent Python reimplementation of the scenario model.

This module is written directly from METHODOLOGY.md's equations, not by
reading model/model.js, so that differential_test.py's comparison against
the JS implementation is a genuine check on the *specification*, not just a
transcription check between two copies of the same code.

See METHODOLOGY.md for every derivation referenced by section number below.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
import math


@dataclass
class ScenarioResult:
    E0: float
    E1: float
    deltaE: float
    deltaPct: float
    deltaPotential: float
    reboundFraction: Optional[float]
    classification: str
    volumeRatio: float
    shareOfGlobalDemandE0: Optional[float] = None
    shareOfGlobalDemandE1: Optional[float] = None


def compute_scenario(
    E0: float,
    s: float,
    q: float,
    eps: float,
    r: float,
    c: float,
    global_electricity_demand_twh: Optional[float] = None,
) -> ScenarioResult:
    """METHODOLOGY.md §2-4, §7: the core scenario equations."""
    for name, v in {"E0": E0, "s": s, "q": q, "eps": eps, "r": r, "c": c}.items():
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            raise TypeError(f"compute_scenario: parameter '{name}' must be a number, got {v!r}")
        if not math.isfinite(v):
            raise TypeError(f"compute_scenario: parameter '{name}' must be finite, got {v!r}")
    if q <= 0:
        raise ValueError("compute_scenario: q must be > 0")
    if E0 < 0:
        raise ValueError("compute_scenario: E0 must be >= 0")

    # §2: a decision now costs q + c and consumes r + c, in units of the old
    # LLM-only decision; demand responds to the cost with elasticity eps.
    relative_cost = q + c
    relative_energy = r + c
    volume_ratio = relative_cost ** (-eps)

    # §3 eq. (★): E_dec1 = s·E0 · (r + c) · (q + c)^(-eps).
    e_dec1 = s * E0 * relative_energy * volume_ratio

    # §4: total energy.
    e1 = (1 - s) * E0 + e_dec1

    delta_e = e1 - E0
    delta_pct = 0.0 if E0 == 0 else delta_e / E0

    # §7: engineering change with no volume response; the baseline includes
    # the complementary LLM calls (share c), which are not a rebound.
    delta_potential = s * E0 * (relative_energy - 1)

    classification, rebound_fraction = classify_outcome(delta_e, delta_potential)

    result = ScenarioResult(
        E0=E0,
        E1=e1,
        deltaE=delta_e,
        deltaPct=delta_pct,
        deltaPotential=delta_potential,
        reboundFraction=rebound_fraction,
        classification=classification,
        volumeRatio=volume_ratio,
    )

    if global_electricity_demand_twh is not None and math.isfinite(global_electricity_demand_twh) and global_electricity_demand_twh > 0:
        result.shareOfGlobalDemandE0 = E0 / global_electricity_demand_twh
        result.shareOfGlobalDemandE1 = e1 / global_electricity_demand_twh

    return result


def classify_outcome(delta_e: float, delta_potential: float):
    """METHODOLOGY.md §7: rebound-fraction classification.

    RE >= 1 (equivalently delta_e >= 0) is "backfire" -- an objective fact of
    the formula. The "savings" vs "partial_rebound" split at RE = 0.5 is this
    project's own documented narrative convention (see METHODOLOGY.md §7 and
    DECISIONS.md), not a value from the literature.
    """
    if delta_e >= 0:
        rebound_fraction = 1 - delta_e / delta_potential if delta_potential < 0 else None
        return "backfire", rebound_fraction
    if delta_potential >= 0:
        # Degenerate fallback: r + c >= 1 yet energy fell. Per METHODOLOGY.md §7
        # this needs q + c > 1, outside the project's ranges; kept so the
        # function is total.
        return "savings", None
    rebound_fraction = 1 - delta_e / delta_potential
    classification = "savings" if rebound_fraction < 0.5 else "partial_rebound"
    return classification, rebound_fraction


def breakeven_epsilon(q: float, r: float, c: float) -> Optional[float]:
    """METHODOLOGY.md §4, "General breakeven": eps* = ln(r + c) / ln(q + c),
    defined only for 0 < q + c < 1 and 0 < r + c < 1; None otherwise."""
    cost = q + c
    energy = r + c
    if not (0 < cost < 1 and 0 < energy < 1):
        return None
    return math.log(energy) / math.log(cost)


OUTCOME_LABELS = {
    "savings": "Efficiency wins",
    "partial_rebound": "Partial rebound",
    "backfire": "Jevons backfire",
}


def outcome_label(classification: str) -> str:
    return OUTCOME_LABELS.get(classification, classification)


MASK32 = 0xFFFFFFFF


def mulberry32(seed: int):
    """Bit-for-bit port of model.js's mulberry32 PRNG.

    Every intermediate value is masked to 32 bits unsigned after each
    operation, replicating what JavaScript's bitwise operators (which
    implicitly perform ToUint32/ToInt32 conversions) do to a plain double.
    Because XOR/OR/AND/shift/imul are bit-pattern operations invariant to
    signed-vs-unsigned reinterpretation given consistent masking, tracking
    everything as an unsigned 32-bit Python int here reproduces the JS
    engine's internal signed-int32 arithmetic exactly. See model/model.js's
    docstring for the JS side of this.
    """
    state = {"a": seed & MASK32}

    def imul32(x: int, y: int) -> int:
        return (x * y) & MASK32

    def next_value() -> float:
        state["a"] = (state["a"] + 0x6D2B79F5) & MASK32
        t = state["a"]
        t = imul32(t ^ (t >> 15), t | 1)
        t = (t ^ ((t + imul32(t ^ (t >> 7), t | 61)) & MASK32)) & MASK32
        return ((t ^ (t >> 14)) & MASK32) / 4294967296.0

    return next_value


def uniform(rng, lo: float, hi: float) -> float:
    return lo + rng() * (hi - lo)


def summary_stats(values):
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    mean = sum(sorted_vals) / n

    def quantile(q: float) -> float:
        pos = q * (n - 1)
        lo = math.floor(pos)
        hi = math.ceil(pos)
        if lo == hi:
            return sorted_vals[lo]
        return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)

    return {
        "mean": mean,
        "min": sorted_vals[0],
        "max": sorted_vals[-1],
        "p05": quantile(0.05),
        "p10": quantile(0.10),
        "p25": quantile(0.25),
        "median": quantile(0.5),
        "p75": quantile(0.75),
        "p90": quantile(0.90),
        "p95": quantile(0.95),
    }


def run_monte_carlo(ranges: dict, fixed: dict, n: int = 10000, seed: int = 0x5EED1234):
    """METHODOLOGY.md §9. Draw order per iteration is fixed (s, r, eps, c) to
    match model.js exactly, which is required for the differential test to
    reproduce identical PRNG draws given the same seed."""
    rng = mulberry32(seed)
    ratios = [0.0] * n
    backfire_count = 0
    breakevens = []

    for i in range(n):
        s = uniform(rng, ranges["s"][0], ranges["s"][1])
        r = uniform(rng, ranges["r"][0], ranges["r"][1])
        eps = uniform(rng, ranges["eps"][0], ranges["eps"][1])
        c = uniform(rng, ranges["c"][0], ranges["c"][1])

        scenario = compute_scenario(fixed["E0"], s, fixed["q"], eps, r, c)
        ratios[i] = scenario.E1 / fixed["E0"]
        if scenario.classification == "backfire":
            backfire_count += 1
        # §9: each sample's own breakeven elasticity.
        b = breakeven_epsilon(fixed["q"], r, c)
        if b is not None:
            breakevens.append(b)

    stats = summary_stats(ratios)
    return {
        "n": n,
        "seed": seed,
        "ratios": ratios,
        "backfireProbability": backfire_count / n,
        "meanBreakeven": sum(breakevens) / len(breakevens) if breakevens else None,
        **stats,
    }


def sweep_epsilon(E0: float, s: float, q: float, r: float, c: float, eps_min: float, eps_max: float, steps: int = 100):
    out = []
    for i in range(steps + 1):
        eps = eps_min + (eps_max - eps_min) * i / steps
        result = compute_scenario(E0, s, q, eps, r, c)
        out.append({"eps": eps, "ratio": result.E1 / E0})
    return out
