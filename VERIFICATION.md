# Verification report

Every result below was produced by running the referenced command on
2026-09-29 from a clean install (`node_modules/` and `dist/` deleted first),
not assumed or estimated. The check ids refer to the requirements in
`METHODOLOGY.md` §10.

## 1. Check results

| # | Check | Command | Result |
|---|---|---|---|
| A.1 | `sources.json` schema: required fields, types, unique ids, status coherent with kind | `node --test tests/sources.test.js` | **PASS** |
| A.2 | Every `verified` entry's `evidence` contains its value | same file | **PASS** — 41 of 52 entries are `verified`. The check accepts space-separated thousands (IEA writes "28 200 TWh") and a multiplier stated in words ("tripling" = 3) |
| A.3 | Every `derived` entry recomputes from its stated inputs within 0.5% | same file (7 entries, point values and range bounds) | **PASS** — max observed error ≈0.002% |
| A.4 | Every `source_url` resolves (warning only) | `node scripts/check-links.mjs` | **WARNING** — run by CI on GitHub Actions with full network access on 2026-09-29: 9 of 11 distinct URLs resolve; the 2 failures are the iea.org pages, which return HTTP 403 to automated requests (bot protection) and were both opened manually on 2026-09-29. The checker reports 403 as "Blocked (HTTP 403, likely bot protection)", separately from dead links (404/410). Run from this project's build environment, most URLs return 403 because that environment cannot reach external sites |
| A.5 | Second, independent verification pass on sourced numbers | manual fetch of every cited primary source by the maintainer (§2); per-entry record in `data/sources.json` `notes` | **PASS, with corrections** — see §4 |
| B.6 | Unit conversions, `1 TWh = 1e12 Wh` | `node --test tests/units.test.js` | **PASS** (17 tests) |
| B.7 | No un-converted cross-scope addition or comparison | `EnergyQty` tests in `tests/units.test.js`; "scope/perimeter check B.7" in `tests/sources.test.js` | **PASS** — satisfied by construction in the model (§3, item 6). Epoch AI's figure includes server and data-center overhead and the IEA per-request figures are GPU-only; none is a model input or combined with another scope |
| C.8 | Model limit cases | `node --test tests/model.test.js` | **PASS** — `eps = 0`; `s = 0`; with `r = q`, `(q+c)^(1-eps)` and backfire iff `eps > 1` for several `c`; breakeven `ln(r+c)/ln(q+c)` (0.844 / 0.966 / 0.948 at `c` = 0 / 0.3 / 0.7); default `E1/E0 ≈ 0.8746`; rebound 0.380 / 0.617 / 1.884 for the default and the partial/backfire presets, 0 at `eps = 0`, undefined when `r+c ≥ 1`, above 100% exactly when `E1 > E0` |
| C.9 | Monotonicity | same | **PASS** — `E1` increasing in `eps` when `q+c < 1` and decreasing when `q+c > 1`; increasing in `r`; sign of `dE1/ds` = sign of `(r+c)(q+c)^-eps − 1` |
| C.10 | Property-based tests (no NaN, negative or infinite output) | same, 5000+ random points | **PASS** |
| C.11 | Differential test, JS vs. independent Python | `python3 verify/differential_test.py` | **PASS** — 1500 random scenario points (all outputs, including rebound and classification) and 1500 breakeven values agree within 1e-9 relative; the 10,000-sample Monte Carlo, run with the registry's ranges, gives bit-identical samples, summary statistics and mean breakeven |
| D.12 | `E0` never exceeds total data-center consumption; the plausibility warning fires | `tests/sources.test.js`; Playwright warning test | **PASS** — `E0` range `[50, 225]` TWh stays under 485 TWh; the page shows a visible warning whenever a scenario exceeds 10% of 2025 global electricity demand |
| D.13 | Derived 2030 data-center share vs. IEA's ~3% | `tests/sources.test.js` | **PASS** — `950 / 33,600 = 2.83%` |
| E.14 | Adversarial conceptual review | manual, §3 | **PASS** — 7 findings fixed, 1 investigated and documented, 4 checked and found correct (§3) |
| E.15 | Every visible number traces to a source or a live model output | `node scripts/check-text-numbers.mjs` | **PASS** — 251 number-like tokens across the default state and the 3 presets, 0 orphans |
| F.16 | Headless page tests | `npx playwright test` | **PASS** (24/24), including: each preset produces the outcome it is named after; WCAG contrast of header title, h1, subtitle, threshold box, disclaimer, links, table headers, badges and outcome tag is at least 4.5:1 (3:1 for large text) in all four combinations of system theme × theme chosen with the toggle; the chosen theme survives a reload; the threshold box is centered (gap difference < 2 px) at 1280 and 375 px and full-width on mobile; with an it-IT browser locale every number still uses the decimal point |
| F.17 | System fonts in charts; screenshots | `node scripts/screenshot.mjs`; font assertion in `tests/page.spec.js` | **PASS** — `docs/screenshots/` (light theme, en-US, pinned in the script) |
| F.18 | Self-contained page | Playwright network assertion; `tests/build.test.js` | **PASS** — 0 network requests from `file://`; size ≈102 KB (104,693 bytes) |

**Totals**: 80 Node tests (`npm test`), 24 Playwright tests, the
differential test and the text-numbers checker all pass; the link checker
reports the warning explained under A.4.

## 2. Verification method

Every cited primary source was opened by the maintainer on 2026-09-29 by
manual fetch (this project's build environment cannot reach most external
sites) and the stored value checked against it. Result: 41 of 52 entries
are `verified`, 7 are `derived` (recomputed by A.3), 4 are `unverified`
(§5). The two Google Cloud figures were opened directly on 2026-09-25 and
not re-fetched.

## 3. Adversarial conceptual review (check E.14)

`METHODOLOGY.md`, the page's visible text and `data/sources.json` were
reviewed in the role of a skeptical energy economist and a skeptical ML
engineer. Findings and resolutions:

1. **[Fixed] Wrong PRNG name in the methodology.** It said `xorshift128+`;
   `model.js` implements `mulberry32`, chosen because it is trivial to
   replicate bit-for-bit in Python. Corrected.
2. **[Fixed] Stale registry ids in `METHODOLOGY.md`.** Four ids referenced in
   §5 and §8 did not exist in `sources.json`. Found by grepping every
   underscore-containing token in the methodology against the registry;
   corrected.
3. **[Fixed] `E0`'s slider label said "decision-energy".** `E0` is the total
   baseline AI inference energy; `s·E0` is the decision share. Relabeled
   "Baseline AI inference energy (E0)". The same error in the hero and the
   warning banner ("AI decision-energy") was fixed later the same way.
4. **[Fixed] The "what we know vs. what we assume" panel rendered `notes`.**
   Notes contain provenance numbers that are not registered values, which
   made check E.15 impossible to pass honestly. The panel now shows only
   description, value, unit and badges; notes stay in the repository.
5. **[Fixed] An evidence quote contained a number its entry was not about.**
   The peak-cost entry quoted "193.6x faster and 444.6x cheaper"; the quote
   was trimmed to "444.6x cheaper", and 193.6x is now its own entry
   (`typesafe_peak_speedup_claim`).
6. **[Investigated, documented] `model/units.js`'s scope guard is not used by
   `model.js`.** The model never adds or compares absolute energy figures of
   different scopes: `E0` comes from one source and all three `r` proxies are
   dimensionless ratios. The GPU-only vs. whole-system distinction applies to
   context figures that are never computed with, which the B.7 test checks
   at the registry level. Forcing `EnergyQty` into the model would add
   complexity without reducing risk.
7. **[Checked, correct] Jevons paradox, rebound and Khazzoom–Brookes** are
   described correctly in `METHODOLOGY.md` §6 and used consistently.
8. **[Checked, correct] `r = q` is always labeled an assumption**, never a
   measurement, everywhere `r` and `q` are related.
9. **[Checked, correct] JEV is never described as text-generating or
   Bayesian.**
10. **[Checked, correct] Vendor claims are attributed and there is no
    forecast language.** No "will rise/fall", "predicts" or "proves" in any
    document or on the page; every `vendor_claim` entry carries its badge.
11. **[Fixed] Complementarity term priced inconsistently.** The model grew
    decision volume as `q^(-eps)`, as if every decision cost only JEV's
    price, yet charged a full LLM call to a fraction `c` of those decisions.
    A decision that still needs the LLM has not become `1/q` times cheaper.
    The effect was large: with the defaults (`s=0.3`, `r=0.025553`,
    `q=0.012959`, `c=0.3`, `eps=0.5`) it gave `E1/E0 = 1.558`, a backfire
    with `eps < 1`, contradicting the model's own threshold result.
    Resolution: a decision's relative cost is `q + c` and its relative
    energy `r + c`, so `V1 = V0·(q+c)^(-eps)` and
    `E_dec1/(s·E0) = (r+c)·(q+c)^(-eps)` (`METHODOLOGY.md` §2–§4). With
    `r = q` this is `(q+c)^(1-eps)`: backfire iff `eps > 1` for every `c` with
    `q + c < 1`, proven in §4 and tested for several `c`. The default
    scenario gives `E1/E0 ≈ 0.8746`. `model.js` and `recompute.py` were each
    updated from the methodology text, and the differential test agrees.
12. **[Fixed] Rebound measured against the wrong baseline.** The rebound
    fraction divided by the saving `1 − r`, as if every decision stopped
    calling the LLM. The decisions in the share `c` call the LLM anyway; that
    energy is part of the new path, not a behavioral response to a lower
    price, so counting it as rebound overstated the rebound whenever `c > 0`
    (the default scenario read as a 57% "partial rebound" when the volume
    response eats back 38%). Resolution:
    `RE = 1 − (1 − E_dec_ratio)/(1 − (r + c))` with
    `E_dec_ratio = (r + c)·(q + c)^(-eps)` (`METHODOLOGY.md` §7): `RE = 0` at
    `eps = 0`, undefined ("n/a") when `r + c ≥ 1`, and `RE > 1` iff `E1 > E0`.
    Presets were retuned so each matches its name (`DECISIONS.md`).

## 4. Discrepancies between secondary reports and primary sources

| Claim as found in secondary coverage | What the primary source says | Resolution |
|---|---|---|
| Sam Altman: "median query" ≈0.34 Wh | "average query" | Stored as "average" |
| TypeSafe: "40x–400x cheaper" | Not in TypeSafe's primary source; its own peak figure is 444.6x, from its workflow evals | Range not registered; 444.6x registered as a vendor claim, consistent with the eval table, not a model input |
| TypeSafe latency 70–500 ms, from the docs "System One" page | That page does not contain it; the launch blog does | Re-cited to the blog |
| TypeSafe price, from typesafe.ai/pricing | Confirmed on docs.typesafe.ai/models | Re-cited |
| Comparison-LLM cost and latency as a min/max pair | The eval table lists 8 LLM configurations | All 8 registered; `q` and the latency proxy use all of them |
| Epoch AI's 0.3 Wh described as GPU-only | Its 1500 W per H100 includes server and data-center overhead | Scope corrected |
| IEA "155 TWh AI-focused data centers, 2025" | Reported by Our World in Data as an IEA 2026 figure (0.49% of global electricity) | Verified at OWID; `[100, 250]` range kept as estimation uncertainty |
| Arize "910 vs. 85 tokens" vs. a "general-purpose model" | A small listing-moderation test (NearHere) against Gemini Flash-Lite | Description corrected |
| Jev named after Jevons (via an interview) | TypeSafe's launch blog (FAQ) states it | Cited to the blog; the "System One"/Kahneman link is not claimed |

## 5. Entries left `unverified`

- `inference_share_of_ai_compute`, `s_decision_task_share`,
  `c_complementarity_share`: scenario parameters with no source to verify
  against; `unverified` here means "not a citable fact", not "unchecked".
- `eps_demand_elasticity`: the bibliographic details of the cited UKERC
  review (Steven Sorrell, 1 October 2007) were verified, but the original
  report PDF now returns HTTP 404, so the rebound figures in its `evidence`
  (10–30% direct rebound for household energy services; 37% to over 100%
  across the eight economy-wide studies it summarizes) could not be re-read
  in the primary source. They are corroborated by a secondary source (ACEEE,
  Nadel 2012, "The Rebound Effect: Large or Small?"), which is not enough to
  mark the entry `verified`.

## 6. Final full pass (2026-09-29)

After the last model change, the whole rendered page (`innerText`) and every
document were re-read as a skeptical outside reader looking for errors in
numbers, wording and consistency between the page, `README.md` and
`METHODOLOGY.md`. Findings and fixes are listed in `DECISIONS.md` where they
are decisions, and here:

1. **Registered values were rounded for display** (e.g. $0.0195 shown as
   "0.02", $0.1761 as "0.176"), so they no longer matched their own evidence
   quotes. The Sources table and the "what we know" panel now show every
   registered value exactly as stored; derived values keep 3 significant
   decimals.
2. **"Three independent proxies" overstated independence**: the cost and
   latency proxies come from the same TypeSafe eval. The page, `README.md`,
   `METHODOLOGY.md` §5 and the registry notes now say so.
3. **"Has never been published" overstated what a search can establish.**
   Now "no figure has been published … as far as this project could find"
   (page, `README.md`, `METHODOLOGY.md` §5).
4. **The disclaimer listed only cited figures and assumptions**, omitting
   derived values and live model outputs, which the page also shows. Fixed.
5. **The footer said "no numbers on this page are hardcoded"**, but the
   preset slider positions, the 10% threshold and the sample count are. It
   now names those constants.
6. **`eps` was described as responding to "the price cut JEV represents"**;
   since the complementarity fix it responds to the full cost of a decision.
   The `eps` and `c` descriptions now say so.
7. **The hero compared against "today's level"**; `E0` is the 2025 baseline,
   and the text now says so.
8. **`METHODOLOGY.md` §6 quoted the UKERC rebound percentages without noting
   they are not yet re-verified** (§5 below). Caveat added.
9. **`METHODOLOGY.md` §5(b) said the eval latencies include network time "on
   both sides"**, which TypeSafe does not state. Reduced to what it does
   state.
10. **`README.md` said Jev is "reportedly" cheaper**; it is cheaper by its
    vendor's own evals, which is now what it says.

## 7. Manual spot-checks for the maintainer

1. **Find an archived copy of the UKERC report** (the original PDF returns
   HTTP 404) and confirm the figures in `eps_demand_elasticity`: 10–30%
   direct rebound for household energy services, and 37% to over 100% across
   the eight economy-wide studies summarized. Then promote the entry to
   `verified` (or correct it).
2. **Recompute the default scenario by hand**: with `s=0.3, eps=0.5, c=0.3`,
   `r=0.025553`, `q=0.012959`, `E0=108.5`, compute
   `E1 = (1-s)*E0 + s*E0*(r+c)*(q+c)^(-eps)` and confirm ≈94.9 TWh (−12.5%),
   as the page shows on first load, and `eps* = ln(r+c)/ln(q+c) ≈ 0.966`.
3. **Recompute `q_price_ratio` by hand**: the geometric mean of
   `0.0004 / cost_i` over the eight configurations should be ≈0.01296.
4. **Re-read the hero and the disclaimer** and ask whether any sentence
   implies a prediction rather than a scenario.
5. **Challenge the `eps` range (0.1–2.0).** The Monte Carlo share moves
   directly with it (`METHODOLOGY.md` §9); if you have grounds for a
   different range, change it in `data/sources.json` and rebuild.

## 8. Not run in this environment

- **GitHub Pages deployment**: the workflow's steps are the same commands
  run here, but a live deployment was not observed.
