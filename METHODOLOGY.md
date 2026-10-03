# Methodology

This document derives, from first principles, every formula used in
`model/model.js`. It is written to be checked independently: `verify/recompute.py`
is a from-scratch reimplementation written by reading *this document*, not the
JS source, and the two are then compared point-by-point (see `VERIFICATION.md`,
check C.11).

**What this is not.** This is not a forecast. It is a scenario-analysis tool:
given a set of assumptions (some measured, most explicitly labeled as
guesses), it computes what total AI-inference energy use *would* be. Change
the assumptions, get a different number. No single number here is a
prediction of what will actually happen to AI energy consumption.

## 1. Scope and notation

All energy quantities are annual, in TWh/yr, and refer to a single, explicitly
stated scope (see `data/sources.json`, field `notes`, and `model/units.js`).
Mixing scopes (e.g. GPU-only power draw vs. whole-datacenter power including
cooling) without an explicit, documented conversion factor is treated as a bug
(check B.7).

| Symbol | Meaning | Units | Kind |
|---|---|---|---|
| `E0` | Baseline annual AI inference energy, in the chosen scope | TWh/yr | derived from IEA figures |
| `s` | Share of `E0` spent on "decision" tasks (classification, routing, scoring, yes/no) that are technically substitutable by a System-One model like JEV | dimensionless, 0–1 | scenario parameter (no measured value exists) |
| `r` | Energy ratio per decision, JEV / LLM | dimensionless, ≥0 | derived, with explicit uncertainty (three proxy estimators, see §5) |
| `q` | Price ratio per decision, JEV / LLM | dimensionless, >0 | derived from TypeSafe's own workflow-eval cost table (Jev vs. 8 LLM configurations) |
| `eps` | Elasticity of decision-task demand with respect to price (own-price elasticity of quantity demanded, expressed as a positive magnitude so that `(q + c)^(-eps)` is the volume multiplier for a price cut) | dimensionless, ≥0 | scenario parameter, informed by rebound-effect literature |
| `c` | Complementarity share: the fraction of the *new* JEV decision volume `V1` for which an LLM call still happens alongside JEV (JEV augments rather than fully replaces the LLM call). Those decisions pay for the LLM call too, so `c` enters both the cost and the energy per decision | dimensionless, 0–1 | scenario parameter |
| `V0`, `V1` | Baseline and post-substitution volume of decision tasks per year | decisions/yr | intermediate quantity, cancels out of the energy formulas below |

## 2. Demand response to a price change (constant-elasticity demand)

After JEV is introduced, every decision goes through JEV, and a fraction `c`
of them *also* still needs a full LLM call (see §3). Measured in units of
the old LLM-only cost and energy per decision, the average decision
therefore costs and consumes:

```
relative cost per decision   = q + c        (q = price_JEV / price_LLM)
relative energy per decision = r + c        (r = energy_JEV / energy_LLM)
```

The decision is only as cheap as *everything* it still pays for: a decision
that needs JEV plus an LLM call has not become `1/q` times cheaper, so its
demand cannot respond as if it had.

We model the volume of decision tasks as responding to this cost change with
constant elasticity `eps`. A standard constant-elasticity demand curve gives
the new quantity as:

```
V1 = V0 · (q + c)^(-eps)
```

`q + c < 1` means the average decision got cheaper, so volume grows for any
`eps > 0`. This is the same functional form used throughout the
price-elasticity and rebound-effect literature (see Sorrell 2007, UKERC,
discussed in §6) to relate a price/cost change to a quantity change.
`eps = 0` means demand is completely inelastic (volume doesn't respond to
price at all — pure efficiency gain, no rebound). Larger `eps` means volume
responds more strongly to the cost cut.

**Important limitation, stated explicitly**: this assumes the *only* thing
that changes is the cost per decision, and that the elasticity is constant
across the whole range of the change (a single-parameter simplification of
a generally non-linear demand curve). Real elasticities likely vary with the
size of the price change and with saturation effects (there is a finite
number of plausible decisions a system will ever want to make). `eps` is
treated here as an average/effective elasticity over the relevant range,
which is a modeling choice, not a measured fact.

## 3. Energy consumed by the decision-task share after substitution

Before substitution, the decision-task share of baseline energy is `s · E0`,
spent on `V0` decisions, so the average energy per decision on the LLM path is:

```
e0 = (s · E0) / V0        [Wh per decision, LLM path]
```

After JEV is introduced:
- A volume `V1 = V0 · (q + c)^(-eps)` of decisions is made (§2).
- Each decision costs `r · e0` in energy on the JEV path (by definition of
  `r` as the JEV/LLM energy ratio per decision).
- A fraction `c` of `V1` *also* triggers a residual LLM call (the
  complementarity term: the LLM is still needed upstream to build the typed
  state JEV consumes, or downstream to turn JEV's decision into an
  explanation/response), costing a further `e0` each.

So the new energy spent on the decision-task share is:

```
E_dec1 = V1 · (r + c) · e0
```

Substituting `V1 = V0 · (q + c)^(-eps)` and `V0 · e0 = s·E0` (by definition
of `e0`):

```
E_dec1 = (q + c)^(-eps) · (r + c) · (V0 · e0) = s·E0 · (r + c) · (q + c)^(-eps)      (★)
```

`V0` and `e0` cancel completely — the model's outputs never depend on the
absolute number of decisions per year, only on the *share* `s` of baseline
energy they represent. This is why `V0`/`V1` do not appear as inputs to
`model.js`: they are bookkeeping devices used only in this derivation.

## 4. Total energy and the key backfire identity

The `(1 − s)` share of `E0` that was never decision-work (chat, coding
assistance, creative writing, anything not a bounded classification/scoring
task) is assumed unaffected by JEV's existence — a modeling simplification
stated explicitly, not a measured fact:

```
E1 = (1 − s)·E0 + E_dec1
```

Because the untouched share is literally unchanged, the *entire* change in
total energy equals the change in the decision-task share:

```
E1 − E0 = E_dec1 − s·E0 = s·E0 · [ (r + c)·(q + c)^(-eps) − 1 ]         (†)
```

**Key result, proven.** Assume energy scales with price 1:1, `r = q` (the
proportionality assumption discussed in §5). Write `p = q + c` for the
relative cost of a decision. Then from (★):

```
E_dec1 / (s·E0) = p · p^(-eps) = p^(1 - eps) = (q + c)^(1 - eps)
```

Examine this as a function of `eps` for a fixed `p` with `0 < p < 1` (the
average decision got cheaper, the case of interest):

```
f(eps) = p^(1-eps) = exp[(1-eps)·ln(p)]
f'(eps) = -ln(p) · f(eps)
```

Since `p < 1` implies `ln(p) < 0`, we get `-ln(p) > 0`, and `f(eps) > 0`
always, so `f'(eps) > 0`: **`f` is strictly increasing in `eps`.** At
`eps = 1`, `f(1) = p^0 = 1` exactly — the decision-task energy returns
exactly to its pre-substitution level `s·E0`, however large the cost cut.
This is the breakeven point.

- For `eps < 1`: `f(eps) < 1`, so `E_dec1 < s·E0` — **energy falls**. Some of
  the efficiency gain survives as a net saving.
- For `eps = 1`: `E_dec1 = s·E0` exactly — **no change**, the efficiency gain
  is fully offset by higher volume (100% rebound).
- For `eps > 1`: `f(eps) > 1`, so `E_dec1 > s·E0` — **energy rises above the
  pre-substitution level**, i.e. Jevons-paradox "backfire".

So, when `r = q`: **total energy rises if and only if `eps > 1`, for every
value of `c` with `q + c < 1`** (by (†), the untouched `(1-s)·E0` term cancels,
so the threshold for the decision share is also the threshold for `E1`).
Complementarity changes *how much* energy moves, not *where* the threshold
is. The condition `q + c < 1` holds everywhere in this project's parameter
ranges (`q ≤ 0.1212121`, `c ≤ 0.7`, so `q + c ≤ 0.83`). If `q + c = 1` the
decision is no cheaper than before and nothing changes; if `q + c > 1` it is
dearer, volume falls, and the direction reverses.

This is not a new economic discovery — it is the standard elasticity/backfire
result from price-elasticity theory (a price cut increases total expenditure
if and only if demand is elastic, i.e. `|elasticity| > 1`; here "expenditure"
is replaced by "energy" under the `r = q` proportionality assumption), and it
is structurally identical to the Khazzoom–Brookes postulate discussed in §6.

**General breakeven.** Without assuming `r = q`, (†) is zero when
`(r + c)·(q + c)^(-eps) = 1`, i.e. at

```
eps* = ln(r + c) / ln(q + c)          (for 0 < q + c < 1 and 0 < r + c < 1)
```

Total energy rises above `E0` if and only if `eps > eps*`. When `r < q`
(energy falls faster than price), `eps* > 1`; when `r > q`, `eps* < 1`. With
the defaults (`q = 0.012959`, `r = 0.025553`), `eps*` is ≈0.844 at `c = 0`,
≈0.966 at `c = 0.3` and ≈0.948 at `c = 0.7`. If `r + c ≥ 1`, each decision
uses at least as much energy as before and `E1 ≥ E0` for every `eps ≥ 0`.

**Why the cost term includes `c`** (an earlier version of this model used
`V1 = V0 · q^(-eps)`, growing volume as if every decision cost only JEV's
price, while charging a full LLM call to a fraction `c` of it). That is
internally inconsistent: a decision that still needs the LLM has not become
`1/q` times cheaper. With the defaults (`s = 0.3`, `c = 0.3`, `eps = 0.5`) the
inconsistent version gave `E1/E0 ≈ 1.558`, a backfire with `eps < 1`; the
consistent version above gives `E1/E0 ≈ 0.875`. See `VERIFICATION.md` §3.

## 5. The `r = q` proportionality assumption, and three estimators for `r`

**No figure for `r` (the energy ratio per decision) has been published by
TypeSafe AI or measured by any independent lab, as far as this project could
find (see `DECISIONS.md`, "Searched for and not found").** Section 4's clean identity requires assuming `r = q`, i.e.
that *energy per decision scales with price per decision*. This is a common
and defensible first-pass assumption in energy/cost studies (cost is, in
competitive markets, correlated with underlying resource use — compute,
electricity, hardware amortization), **but it is an assumption, not a
measurement**, and it can be wrong in either direction: a vendor could price
below marginal cost to gain market share (r > q, actual energy savings smaller
than the price cut suggests), or amortize large fixed R&D/training costs into
the price such that marginal energy cost is far below price (r < q, actual
energy savings larger than the price cut suggests).

To avoid relying on a single unverifiable number, the model computes three
point-estimates for `r` from different public signals, each with its own
stated bias. They are not fully independent: (a) and (b) come from the same
TypeSafe eval, so a bias in that eval (for example, in how the workflows
were chosen) would move both in the same direction; (c) comes from a
separate third-party test.

**Source table for (a) and (b).** TypeSafe publishes a workflow-eval table
(https://evals.typesafe.ai/, `data/sources.json` ids `typesafe_cost_per_case_usd`,
`typesafe_latency_per_case_s` and `typesafe_eval_<config>_cost_usd` /
`_latency_s`) giving, for Jev and for 8 LLM configurations, the average
accuracy, cost per decision and latency per decision over 4 workflows:

| Configuration | Accuracy | Cost per decision (USD) | Latency (s) |
|---|---|---|---|
| Jev | 67.8% | 0.0004 | 0.4 |
| haiku 4.5 | 53.6% | 0.0195 | 12.5 |
| opus 5 | 73.1% | 0.1761 | 37.8 |
| sonnet 5 | 67.8% | 0.1174 | 78.1 |
| DS v4 flash | 64.4% | 0.0059 | 51.9 |
| DS v4 pro | 65.5% | 0.0413 | 86.5 |
| luna | 66.8% | 0.0033 | 12.9 |
| sol | 74.1% | 0.0836 | 23.3 |
| terra | 67.9% | 0.0304 | 10.1 |

The workflows were built by TypeSafe's own team and scored against reference
labels (the average of GPT-6 Astra and Fable 5.1 at a high thinking level);
TypeSafe itself flags the possible bias. Every figure is therefore a vendor
claim, clearly labeled as such, not an independent measurement.

**Rounding.** Jev's published $0.0004 and 0.4 s are rounded to one
significant digit, so their true values lie within ±12.5% ($0.00035–$0.00045,
0.35–0.45 s). Every ratio below inherits that uncertainty. The point
estimates use the published values; the range of `r` that the Monte Carlo
samples (§9) is widened by the same ±12.5% so that it covers every ratio the
unrounded values could produce (`r_min × 0.875`, `r_max × 1.125`).

**(a) Cost proxy**: `r_cost = q`, where `q` is the geometric mean, over the 8
configurations, of `cost_Jev / cost_i`:

```
q = geometric_mean(0.0004 / cost_i) = 0.012959     range [0.0022714, 0.1212121]
```

The range is the spread across configurations (cheapest: luna; most
expensive: opus 5). *Sensitivity*: the configurations are not equally
accurate, so comparing Jev only with those whose accuracy is within about 1
point of Jev's (sonnet 5, terra, luna) gives `q = 0.017581`
(`q_price_ratio_accuracy_matched`); the model keeps the all-configuration
value as its default. *Likely bias*: prices reflect margins, subsidies, and
go-to-market strategy as much as marginal energy cost, so this can over- or
under-state the true energy ratio. In particular, TypeSafe states that it
cannot prove its price is not subsidized: if it is, this proxy **understates**
`r` (makes Jev look more energy-efficient than it is).

**(b) Latency proxy**: `r_latency` = geometric mean, over the same 8
configurations, of `latency_Jev / latency_i`:

```
r_latency = geometric_mean(0.4 / latency_i) = 0.013784     range [0.0046243, 0.0396040]
```

Using the same eval for both sides keeps the comparison like-for-like (same
tasks, same measurement setup); the generic 70–500 ms headline range
(`typesafe_latency_ms_min`/`_max`) is kept only as context and is no longer
an input. TypeSafe states it ran the evals from its own laptops on the US
West Coast, so the latencies include network time.
*Assumption stated explicitly*: energy per request is roughly proportional to
compute-time-on-accelerator, which requires comparable hardware and batching
between the two systems — an assumption TypeSafe has not confirmed either way.
*Likely bias*: if JEV is latency-optimized (e.g. smaller batch sizes, warmer
caches, a smaller model architecture) more aggressively than it is
energy-optimized, this proxy will *understate* `r` (make JEV look more
energy-efficient than it really is) relative to the true ratio, because
inference systems can trade batch size / parallelism for latency without a
proportional change in energy-per-request.

**(c) Token proxy**: `r_tokens` = ratio of tokens processed per decision (JEV:
~85 output tokens; Gemini Flash-Lite: ~910 output reasoning tokens per
decision, in a small listing-moderation test reported by Arize AI —
`data/sources.json` ids
`arize_jev_tokens_per_decision`/`arize_llm_tokens_per_decision`).
*Assumption stated explicitly*: energy scales linearly with output token
count, holding model size/architecture and hardware constant — reasonable
for autoregressive decoding on a *fixed* model, but JEV is architecturally
not an autoregressive text generator, so this comparison mixes token count
with a difference in *architecture*, not just verbosity. *Likely bias*: this
proxy ignores prompt/input-side compute (which can dominate for short
outputs) and ignores that a "System One" architecture may spend energy
differently per token than a transformer decoder — it could over- or
understate the ratio depending on how JEV's forward pass compares to one
autoregressive decoding step.

The model's default `r` is the geometric mean of the three proxies, and its
range is their envelope (`min`/`max` across the three), widened for Jev's
rounding as described above, rather than a single number presented as if it
were measured:

```
r = geometric_mean(0.012959, 0.013784, 0.0934066) = 0.025553
range = [0.0022714 × 0.875, 0.1212121 × 1.125] = [0.0019875, 0.1363636]
```

The Monte Carlo analysis (§9) samples `r` uniformly over this range.

## 6. `eps`: rebound-effect elasticity as a scenario parameter

`eps` has no measured value specific to AI decision workloads — none exists
in the literature as of this writing, because JEV-like decision models are
new. Instead, `eps`'s scenario range is informed by the general
economics-of-energy-efficiency literature on **rebound effects**:

- **Jevons paradox** (W. S. Jevons, *The Coal Question*, 1865; discussed
  academically in Alcott, "Jevons' Paradox," *Ecological Economics* 54(1):9–21,
  2005): Jevons observed that improvements in the efficiency of coal-burning
  technology (e.g. Watt's steam engine) did not reduce total coal
  consumption — they increased it, because efficiency lowered the effective
  cost of using coal-powered technology, expanding its use faster than
  efficiency reduced use-per-unit. UK coal consumption grew substantially
  through the 19th century alongside efficiency gains, not despite them.
- **Direct rebound effect**: an efficiency gain lowers the effective price of
  *that specific* good or service, increasing consumption of that same good
  or service (classic example: a more fuel-efficient car gets driven more).
- **Indirect rebound effect**: money/resources saved by the efficiency gain
  get spent on *other* goods and services, which have their own embedded
  energy footprint elsewhere in the economy.
- **Economy-wide rebound** = direct + indirect + any general-equilibrium
  price effects, is the sum total fraction of the theoretical ("engineering")
  energy saving that fails to materialize because of these responses.
  Rebound = 0% means the full engineering saving is realized; rebound = 100%
  means the saving is fully offset (breakeven); rebound > 100% is "backfire".
- **Khazzoom–Brookes postulate** (D. Khazzoom; L. Brookes; formalized by
  H. Saunders, "The Khazzoom-Brookes Postulate and Neoclassical Growth,"
  *The Energy Journal* 13(4):131–148, 1992): energy-efficiency improvements
  can, under plausible neoclassical-growth assumptions about substitutability
  between energy and other inputs, *increase* rather than decrease long-run
  economy-wide energy consumption. This is the macro-scale, growth-theoretic
  version of the same mechanism modeled here at task-level.
- **Empirical magnitudes**: S. Sorrell, "The Rebound Effect: An Assessment of
  the Evidence for Economy-wide Energy Savings from Improved Energy
  Efficiency," UK Energy Research Centre (UKERC), October 2007, reviews the
  empirical literature and reports **direct rebound effects typically in the
  10–30% range** for household end-uses like space heating and personal
  transport, while noting that **economy-wide rebound estimates in some
  studies range from ~37% to over 100%**, and states that the evidence is
  **not conclusive enough to say whether backfire is a common outcome** — a
  contested, not settled, possibility. (The review's bibliographic details
  are verified; these percentages have not yet been re-checked in the full
  report — see `VERIFICATION.md` §5.)

This model's own translation into elasticity: since `E_dec1/(s·E0) = (q + c)^(1-eps)`
in the `r = q` case, a rebound fraction `RE` (in the standard "share of
potential saving eaten back" sense — see §7) corresponds to a specific `eps`
value for a given `q` and `c`. `eps = 1` is exactly Sorrell's "100% rebound"
(backfire) threshold in this model, so the empirical range above (roughly
10–37%+ rebound in typical studies, contested backfire beyond that) is used
to justify treating `eps` between 0.1 and 2.0 (`data/sources.json` id
`eps_demand_elasticity`) as the scenario range, deliberately spanning across
the `eps = 1` threshold. **This translation (mapping a general cross-sector
rebound percentage onto an AI-decision-specific price elasticity) is itself
a judgment call, stated here explicitly, not a citation-backed number** — no
study has measured price elasticity of demand for AI decision-inference
calls specifically.

**What this range implies, stated plainly.** Backfire happens exactly when
`eps` exceeds the breakeven `eps* = ln(r + c) / ln(q + c)` (§4). Over the
ranges of `r` (0.0019875–0.1363636) and `c` (0–0.7) with `q` at its point
estimate, `eps*` runs from about 0.46 to 1.43; across the Monte Carlo
samples its median is about 0.83, and 95% of samples have `eps* ≤ 1.02`.
The `eps` range of 0.1–2.0 straddles that breakeven, so the Monte Carlo run
in §9 finds backfire in some samples and savings in others (61.6% backfire
with the current registry). That share is a mechanical consequence of where
this project put the ends of the `eps` range, not an independently
corroborated forecast in either direction: moving the upper end of the
range would move it. This project has not tuned the range to reach any
particular share, because there is no evidence to justify a different range
over this one.

**Context, not a model input.** TypeSafe says it named Jev after William
Stanley Jevons, expecting intelligence to follow coal's path: as the cost of
using it falls, demand grows (TypeSafe launch blog, FAQ). The vendor thus
expects the demand response this model parameterizes with `eps`, but says
nothing about its size. Separately, the IEA (Key Questions on Energy and AI,
executive summary) reports that the energy needed per AI task has fallen by
at least an order of magnitude per year, while electricity use by
AI-focused data centers grew by 50% in 2025 (`data/sources.json` id
`iea_ai_dc_growth_2025_pct`). That combination is *consistent
with* a rebound effect at the level of AI as a whole; it is not evidence of
one, and it says nothing specific about decision tasks or about Jev.

## 7. Rebound fraction and outcome classification

Define the "potential" (engineering, no-behavioral-response) energy change
as what would happen if every decision switched to the new path — JEV, plus
the LLM call that a fraction `c` of decisions still makes — with the volume
held at `V0` (`eps = 0`):

```
ΔE_potential = s·E0 · (r + c - 1)
```

`ΔE_potential < 0` whenever `r + c < 1` (the new path genuinely uses less
energy per decision) — this is the "engineering" saving before any rebound.

**Why the baseline includes `c`.** The decisions in the share `c` use the LLM
anyway; the energy they spend on it is part of what the new path *is*, not a
behavioral response to a lower price. Measuring the saving against `1 - r`
(as if every decision dropped the LLM entirely) would count that
complementary energy as "rebound", overstating the rebound for any `c > 0`.
With `c` in the baseline, the rebound measures only what the *volume*
response eats back: at `eps = 0`, `ΔE_actual = ΔE_potential` exactly, so
`RE = 0`.

The actual change, from (★) and (†), is:

```
ΔE_actual = E1 - E0 = s·E0 · [ (r + c)·(q + c)^(-eps) - 1 ]
```

Following Sorrell (2007)'s standard definition, the rebound fraction is:

```
RE = 1 - ΔE_actual / ΔE_potential = 1 - (1 - E_dec_ratio) / (1 - (r + c))
        where E_dec_ratio = (r + c)·(q + c)^(-eps)
                                           (only defined when r + c < 1)
```

When `r + c ≥ 1` there is no engineering saving to rebound from, so `RE` is
undefined and the page shows "n/a". The 100% threshold is unchanged by the
choice of baseline: `RE > 1` if and only if `E_dec_ratio > 1`, i.e. exactly
when `ΔE_actual > 0`.

- `RE ≈ 0`: the full engineering saving is realized (little/no behavioral
  offset).
- `0 < RE < 1`: **partial rebound** — some of the saving is eaten back by
  higher volume, but a net saving remains (`ΔE_actual < 0`).
- `RE = 1`: exact breakeven, `ΔE_actual = 0`.
- `RE > 1`: **backfire** — `ΔE_actual > 0`, total energy is higher than
  before the efficiency gain existed, exactly the Jevons/Khazzoom-Brookes
  case.

`model.js` classifies each scenario into one of three labels:
- **`"savings"`** ("Efficiency wins"): `ΔE_actual < 0` and `RE < 0.5`.
- **`"partial_rebound"`** ("Partial rebound"): `ΔE_actual < 0` and `RE ≥ 0.5`.
- **`"backfire"`** ("Jevons backfire"): `ΔE_actual ≥ 0`.

**The `RE = 0.5` split between "savings" and "partial rebound" is our own
narrative convention, not a value from the literature** — Sorrell's review
gives no universal threshold for when a partial rebound stops being called
"efficiency winning" and starts being called "substantial rebound"; 50% (half
of the potential saving lost to rebound) is a simple, symmetric, defensible
choice, and it is stated here explicitly as a modeling decision (see
`DECISIONS.md`) so it is never mistaken for an empirical finding. The
`RE ≥ 1` (backfire) boundary, by contrast, is not a convention — it is the
literal sign change in `ΔE_actual`, i.e. an objective fact about the formula.

When `ΔE_potential ≥ 0` (i.e. `r + c ≥ 1`: the new path does not even save
energy per decision before any rebound is considered), `RE` is undefined;
`model.js` falls back to classifying directly on the sign of `ΔE_actual`
(`≥0 → "backfire"`, `<0 → "savings"`). For `eps ≥ 0`, `q > 0`,
`r + c ≥ 1` and `q + c ≤ 1`, the fallback always gives "backfire": then
`(q + c)^(-eps) ≥ 1`, so `E_dec_ratio ≥ r + c ≥ 1` and `ΔE_actual ≥ 0` —
proven directly. The "savings" fallback is reachable only when `q + c > 1`
(the average decision costs *more* than before, so volume shrinks) and
`r + c ≥ 1`; that combination is outside every parameter range this project
uses (`r + c ≤ 0.84`, `q + c ≤ 0.83`), and the fallback is kept only so the
function is total.

## 8. Share of global electricity demand

`E1` (and `E0`) are expressed as a fraction of total global electricity
demand using a separately sourced denominator
(`data/sources.json` id `global_electricity_demand_2025_twh`), **not**
derived by inverting IEA's "~3% by 2030" statement, because that statement
refers to a different year (2030) than this model's baseline year (2025) —
inverting it would silently mix two different reference years into one
ratio. Keeping the denominator as its own directly sourced figure avoids
that error (see `DECISIONS.md` for the discarded alternative).

## 9. Monte Carlo analysis

To communicate the *combined* uncertainty across all scenario parameters
(rather than just varying one at a time), the model runs a Monte Carlo
simulation:

- **`s`**: Uniform(`s_min`, `s_max`) — no data exists on the true
  distribution shape, so the maximum-entropy (least-assumption) choice for a
  bounded, unknown quantity is used: uniform over its stated plausible range.
- **`r`**: Uniform(`r_min`, `r_max`) across the envelope of the three
  estimators in §5, widened for the ±12.5% rounding of Jev's published cost
  and latency, for the same reason.
- **`eps`**: Uniform(`eps_min`, `eps_max`) over the range motivated in §6.
- **`c`**: Uniform(`c_min`, `c_max`).
- **`q`**: held fixed at its point estimate (it is the one parameter backed
  by published numbers on both sides of the same eval — Jev's and each
  comparison configuration's cost per decision — so it is not treated as
  uncertain in the same sense; sensitivity to `q` is instead shown via the
  dedicated `eps`-sweep chart, the `q` slider, and the accuracy-matched
  sensitivity value in §5(a)).
- **`E0`**: held fixed at its point estimate (its own uncertainty is
  documented in `data/sources.json` and shown separately in the "what we
  know vs. what we assume" panel, rather than folded into the Monte Carlo,
  to keep the simulation legible).

10,000 samples are drawn per run with a fixed PRNG seed (`mulberry32`, a
small 32-bit generator chosen specifically because its integer operations
are trivial to replicate bit-for-bit in Python — see `model/model.js` and
`verify/recompute.py`), so the simulation is exactly reproducible across the
JS and Python implementations and across runs (required for check C.11's
differential test, which confirms bit-identical output). The output is the
empirical distribution of `E1/E0` and the fraction of samples with
`classification === "backfire"` ("probability of backfire" under the stated
uniform priors — a statement about *this model's assumptions*, not a
real-world probability).

**What drives that probability.** Backfire in a sample happens exactly when
its `eps` exceeds its own breakeven `eps* = ln(r + c)/ln(q + c)` (§4). Since
`eps` is drawn uniformly from `[eps_min, eps_max]` independently of `r` and
`c`, the probability of backfire given `eps*` is
`(eps_max − eps*) / (eps_max − eps_min)` (clamped to [0, 1]), and averaging
over the samples gives

```
P(backfire) ≈ (eps_max − mean(eps*)) / (eps_max − eps_min) = (2 − mean(eps*)) / 1.9
```

The formula is linear in `eps*`, so this is exact in expectation as long as
every sampled `eps*` lies inside the `eps` range (true here: about
0.48–1.31). The run reports `mean(eps*)` alongside the sampled frequency;
any difference between the two is sampling noise. The probability therefore
depends above all on where the `eps` range ends, not on anything measured.

**Explicit caveat**: Uniform distributions are a simplicity/transparency
choice, not a claim that any parameter is actually uniformly distributed in
reality. Because every parameter here is a scenario assumption rather than a
measurement, there is no data to fit a more realistic distribution (e.g. a
triangular or beta distribution peaked at a "best guess") — doing so would
manufacture false precision. The uniform choice is the most honest one
available given the actual state of knowledge.

## 10. Design requirements

These are the requirements the project is built and tested against. Code
comments and `VERIFICATION.md` refer to them by the ids below.

**Content**

- **R1 — Scenario tool, not a forecast.** Every number on the page is either
  a registered, cited value in `data/sources.json`, a value derived from
  registered values by a stated formula, a scenario parameter explicitly
  labeled as an assumption, or a live output of `model/model.js`. Nothing is
  presented as a prediction.
- **R2 — Honest source status.** An entry is `verified` only if its primary
  source was opened and the stored value found in it; otherwise it is
  `unverified`, and its `notes` say why. `derived` entries state their
  formula. `evidence` quotes are at most 15 words.
- **R3 — The key identity.** With `r = q`, total energy rises above `E0` if
  and only if `eps > 1` (§4). The model must satisfy it exactly and the page
  must explain it.
- **R4 — Uncertainty is shown, not hidden.** The most uncertain inputs carry
  ranges, the Monte Carlo (§9) uses at least 10,000 samples with a fixed
  seed, and its caption states what drives the result.
- **R5 — Three presets**, "Efficiency wins", "Partial rebound" and "Jevons
  backfire", each producing the outcome it is named after.

**Page**

- **R6 — Self-contained.** `dist/index.html` is a single file that works
  when opened from `file://`, with no network requests, and stays under
  16 MiB.
- **R7 — Accessible and responsive**: system fonts only, light/dark theme,
  no horizontal overflow at phone widths (320–414 px), shareable URL that
  restores the exact slider state.
- **R8 — Plausibility warning.** Any scenario whose energy exceeds 10% of
  2025 global electricity demand shows a visible warning.

**Checks** (all automated except A.5 and E.14; results in `VERIFICATION.md`)

| Id | Requirement |
|---|---|
| A.1 | `sources.json` schema: required fields, types, unique ids, status coherent with kind |
| A.2 | every `verified` entry's `evidence` contains its value |
| A.3 | every `derived` entry recomputes from its stated inputs within 0.5% |
| A.4 | every `source_url` resolves (warning only, never blocks the build) |
| A.5 | a second, independent verification pass on sourced numbers |
| B.6 | unit conversions, including `1 TWh = 1e12 Wh` |
| B.7 | energy figures of different scopes (GPU-only vs. whole-system) are never added or compared without an explicit conversion |
| C.8 | model limit cases (`eps = 0`, `s = 0`, the R3 identity) |
| C.9 | monotonicity of `E1` in `eps`, `r` and `s` |
| C.10 | property-based tests: no NaN, negative or infinite outputs over random valid inputs |
| C.11 | differential test: an independent Python implementation written from this document agrees with `model.js` on at least 1000 random points within 1e-9 relative error, and on the Monte Carlo |
| D.12 | plausibility: `E0` never exceeds total data-center consumption; R8's warning fires |
| D.13 | reconciliation: derived 2030 data-center share vs. IEA's stated ~3% |
| E.14 | adversarial conceptual review of the model and the page text |
| E.15 | every number visible on the rendered page traces to R1's sources |
| F.16 | headless page tests: loads cleanly, sliders and presets drive `model.js` |
| F.17 | system fonts in charts; desktop and mobile screenshots |
| F.18 | self-contained file, per R6 |
