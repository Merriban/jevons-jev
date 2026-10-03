#!/usr/bin/env python3
"""Differential test: verify/recompute.py (Python, written from
METHODOLOGY.md) vs. model/model.js (JS, the shipped implementation) must
agree on at least 1000 random scenario points within 1e-9 relative error,
and their Monte Carlo runs (same seed) must agree closely too.

This is check C.11 (METHODOLOGY.md §10). Run with: python3 verify/differential_test.py
Exits non-zero (and prints a summary of every failing point) if any
comparison exceeds tolerance, so it can be wired into CI directly.
"""
from __future__ import annotations

import json
import math
import random
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BRIDGE = HERE / "js_bridge.mjs"

sys.path.insert(0, str(HERE))
import recompute  # noqa: E402

N_POINTS = 1500
REL_TOL = 1e-9
SEED = 20260922  # fixed seed for reproducibility of the random point generation itself


def call_js(payload: dict):
    proc = subprocess.run(
        ["node", str(BRIDGE)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"js_bridge.mjs failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def rel_err(a: float, b: float) -> float:
    if a == b:
        return 0.0
    denom = max(abs(a), abs(b), 1e-300)
    return abs(a - b) / denom


def random_point(rng: random.Random) -> dict:
    return {
        "E0": rng.uniform(0.001, 2000),
        "s": rng.uniform(0, 1),
        "q": rng.uniform(1e-6, 1),
        "eps": rng.uniform(0, 3),
        "r": rng.uniform(0, 5),
        "c": rng.uniform(0, 1),
    }


def test_scenario_agreement() -> list[str]:
    rng = random.Random(SEED)
    points = [random_point(rng) for _ in range(N_POINTS)]

    js_results = call_js({"mode": "scenarios", "points": points})

    failures = []
    numeric_fields = ["E1", "deltaE", "deltaPct", "deltaPotential", "volumeRatio"]
    for i, (point, js_r) in enumerate(zip(points, js_results)):
        py_r = recompute.compute_scenario(**point)
        for field in numeric_fields:
            a = getattr(py_r, field)
            b = js_r[field]
            err = rel_err(a, b)
            if err > REL_TOL:
                failures.append(
                    f"point {i} field {field}: py={a!r} js={b!r} rel_err={err:.3e} params={point}"
                )
        if py_r.classification != js_r["classification"]:
            failures.append(
                f"point {i} classification mismatch: py={py_r.classification} js={js_r['classification']} params={point}"
            )
        py_re = py_r.reboundFraction
        js_re = js_r["reboundFraction"]
        if py_re is None or js_re is None:
            if py_re != js_re:
                failures.append(f"point {i} reboundFraction None-mismatch: py={py_re} js={js_re}")
        else:
            err = rel_err(py_re, js_re)
            if err > REL_TOL:
                failures.append(f"point {i} reboundFraction: py={py_re} js={js_re} rel_err={err:.3e}")
    return failures


def test_breakeven_agreement() -> list[str]:
    rng = random.Random(SEED + 1)
    points = [{"q": rng.uniform(1e-6, 1), "r": rng.uniform(0, 1.2), "c": rng.uniform(0, 1)} for _ in range(N_POINTS)]
    js_results = call_js({"mode": "breakeven", "points": points})
    failures = []
    for i, (p, js_v) in enumerate(zip(points, js_results)):
        py_v = recompute.breakeven_epsilon(**p)
        if (py_v is None) != (js_v is None):
            failures.append(f"breakeven point {i} None-mismatch: py={py_v} js={js_v} params={p}")
        elif py_v is not None and rel_err(py_v, js_v) > REL_TOL:
            failures.append(f"breakeven point {i}: py={py_v!r} js={js_v!r} params={p}")
    return failures


def test_monte_carlo_agreement() -> list[str]:
    # Same ranges and fixed values the page's Monte Carlo panel uses.
    registry = json.loads((HERE.parent / "data" / "sources.json").read_text())
    by_id = {e["id"]: e for e in registry["entries"]}
    ranges = {
        "s": by_id["s_decision_task_share"]["range"],
        "r": by_id["r_energy_ratio"]["range"],
        "eps": by_id["eps_demand_elasticity"]["range"],
        "c": by_id["c_complementarity_share"]["range"],
    }
    fixed = {"E0": by_id["E0_default_twh"]["value"], "q": by_id["q_price_ratio"]["value"]}
    n = 10000
    seed = 0x5EED1234

    js_result = call_js({"mode": "montecarlo", "ranges": ranges, "fixed": fixed, "n": n, "seed": seed})
    py_result = recompute.run_monte_carlo(ranges, fixed, n, seed)

    failures = []
    # Exact PRNG replication means the raw sample arrays should match to
    # floating-point precision, not just their summary statistics.
    max_ratio_err = 0.0
    for i, (a, b) in enumerate(zip(py_result["ratios"], js_result["ratios"])):
        err = rel_err(a, b)
        max_ratio_err = max(max_ratio_err, err)
        if err > 1e-9:
            failures.append(f"MC sample {i}: py={a!r} js={b!r} rel_err={err:.3e}")
            if len(failures) > 20:
                failures.append("... (truncated, more mismatches follow)")
                break
    print(f"  Monte Carlo: max per-sample relative error = {max_ratio_err:.3e} (n={n})")

    for stat in ["mean", "min", "max", "p05", "p10", "p25", "median", "p75", "p90", "p95", "backfireProbability", "meanBreakeven"]:
        a = py_result[stat]
        b = js_result[stat]
        err = rel_err(a, b)
        print(f"  {stat}: py={a:.6f} js={b:.6f} rel_err={err:.3e}")
        if err > 1e-6:
            failures.append(f"MC statistic {stat}: py={a!r} js={b!r} rel_err={err:.3e}")

    return failures


def main() -> int:
    print(f"Differential test: {N_POINTS} random scenario points, tolerance {REL_TOL:.0e} relative...")
    scenario_failures = test_scenario_agreement()
    if scenario_failures:
        print(f"FAIL: {len(scenario_failures)} scenario mismatches found:")
        for f in scenario_failures[:30]:
            print(f"  - {f}")
    else:
        print(f"OK: all {N_POINTS} scenario points agree within {REL_TOL:.0e} relative error.")

    print(f"\nDifferential test: breakeven eps on {N_POINTS} random (q, r, c) points...")
    breakeven_failures = test_breakeven_agreement()
    if breakeven_failures:
        print(f"FAIL: {len(breakeven_failures)} breakeven mismatches found:")
        for f in breakeven_failures[:30]:
            print(f"  - {f}")
    else:
        print(f"OK: all {N_POINTS} breakeven values agree (including where none exists).")

    print("\nDifferential test: Monte Carlo (n=10000, fixed seed, same PRNG algorithm)...")
    mc_failures = test_monte_carlo_agreement()
    if mc_failures:
        print(f"FAIL: {len(mc_failures)} Monte Carlo mismatches found:")
        for f in mc_failures[:30]:
            print(f"  - {f}")
    else:
        print("OK: Monte Carlo raw samples and summary statistics agree with the JS implementation.")

    all_failures = scenario_failures + breakeven_failures + mc_failures
    if all_failures:
        print(f"\nTOTAL: {len(all_failures)} failures.")
        return 1
    print("\nTOTAL: 0 failures. JS and Python implementations agree.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
