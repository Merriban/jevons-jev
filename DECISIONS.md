# Decisions

This file records the non-obvious decisions behind this project and the
reasoning for each. The formulas themselves are derived in `METHODOLOGY.md`;
the checks that enforce them are listed in `METHODOLOGY.md` §10 and their
results in `VERIFICATION.md`.

## Tooling and deployment

- **Tests run on Node's built-in `node:test`**, with no test framework, to keep
  the core model and data code dependency-free. Playwright is the only
  dependency, used for page-level tests, because there is no pure-JS way to
  drive a real browser.
- **Energy units are canonicalised with a scope tag.** `model/units.js`
  converts every energy quantity to Wh internally and tags it with a scope
  (`gpu_only` / `datacenter_it` / `datacenter_total` / `unknown`).
  `EnergyQty.add` throws if two differently-scoped quantities are added
  without an explicit `allowMixedScope: true` (check B.7). The model itself
  never crosses scopes: `E0` comes from one source and every `r` proxy is a
  dimensionless ratio (see `VERIFICATION.md` §3, item 6).
- **The page is one self-contained file.** `scripts/build.mjs` inlines
  `model/model.js` and `data/sources.json` into `dist/index.html` as plain
  scripts, because browsers block ES-module imports from `file://` (R6).
- **Deployment.** CI runs the full suite on every push. On a push to the
  repository's default branch, whatever it is named, it also deploys
  `dist/` to GitHub Pages; the branch is read from the push event rather
  than hardcoded.

## Sources

- **Verification method.** Every cited primary source was opened by the
  maintainer on 2026-09-29 and checked against the stored value; this
  project's build environment cannot reach most external sites, so this was
  done by hand. 41 entries are `verified`, 7 `derived`, 4 `unverified`
  (`VERIFICATION.md` §5 lists the four and why).
- **Notes are not rendered on the page.** `sources.json` `notes` carry
  provenance detail full of numbers that are not registered values in their
  own right. Showing them would break check E.15 (every visible number
  traces to a source), so the page shows each entry's description, value,
  unit, badges and evidence quote only; the notes stay one click away in the
  repository.
- **Jev's cost and latency come from TypeSafe's own workflow evals**
  (evals.typesafe.ai): Jev and 8 LLM configurations, averaged over 4
  workflows, each value registered separately with its own evidence. `q`
  and the latency proxy are geometric means over all 8 configurations, so
  no single comparison model is privileged; the accuracy-matched value
  (`q_price_ratio_accuracy_matched`, configurations within about 1 accuracy
  point of Jev) is shown as a sensitivity check, not used as the default.
  The workflows were built by TypeSafe's team, which TypeSafe itself flags as
  a possible bias.
- **Jev's published $0.0004 and 0.4 s are rounded (±12.5%).** The point
  estimates use the published values; the `r` range that the Monte Carlo
  samples is widened by that margin (`0.875 × min`, `1.125 × max`) so it
  covers every ratio the unrounded values could produce. This widening was
  the maintainer's choice.
- **The generic 70–500 ms latency range is context only.** The latency proxy
  uses the like-for-like workflow-eval latencies instead, so that Jev and
  the LLMs are measured on the same tasks with the same setup.
- **No "40x–400x cheaper" range.** It appears in secondary coverage but not
  in TypeSafe's primary source, so it is not registered. TypeSafe's own peak
  figures (444.6x cheaper, 193.6x faster) are registered as vendor claims
  and tested for consistency with its eval table (0.1761 / 0.0004 ≈ 440;
  78.1 / 0.4 ≈ 195, both within the ±12.5% rounding). They are not model
  inputs.
- **Epoch AI's 0.3 Wh is not GPU-only**: its 1500 W per H100 includes server
  and data-center overhead. The IEA per-request figures (1.1 Wh, 50 Wh) are
  GPU-only, as Our World in Data describes them. None of these is a model
  input; they are shown as context and never combined across scopes.
- **155 TWh (AI-focused data centers, 2025)** is taken from Our World in
  Data, which reports it as an IEA 2026 figure. It carries a `[100, 250]`
  range chosen by this project, because it is a modeled estimate and
  "AI-focused" is a definitional boundary; that range propagates into `E0`.
- **The 2025 global-demand denominator is its own sourced figure**
  (28,200 TWh, IEA Electricity 2026, consumption not generation), not
  derived by inverting IEA's "~3% by 2030" statement, which would mix two
  reference years. The 2030 figures are used only for the D.13
  reconciliation check.
- **Sam Altman's figure is quoted as "average"**, which is the source's own
  wording (secondary coverage sometimes says "median"). It is a bare
  self-report with no disclosed method and is labeled as such.
- **No GPT-4o prices.** Using them to cross-check `q` would require an
  invented input-token count per decision, and OpenAI's current pricing page
  no longer lists GPT-4o as a text model.
- **`s`, `c` and `eps` have no measured values** and are scenario
  parameters. `inference_share_of_ai_compute` is too; its default is 0.7
  (range 0.5–0.9) because Our World in Data states that AI energy demand is
  probably dominated by inference rather than training.

**Searched for and not found** (news and literature scan of 2026-09-25,
search results only, not re-read at the primary source): any published
energy figure (Wh or joules) per Jev decision; any Jev technical paper,
weights, parameter count or self-hosting option (third-party projects named
after Jev exist, but are not Jev). This absence is why `r` is reconstructed
from proxies.

**Found and deliberately not cited** (same scan, not verified): a Cherry
Creek News article reporting that a TypeSafe employee measured a +15.9%
end-to-end speedup when routing one step of a real pipeline through Jev
(whole-pipeline throughput, a different metric from the per-decision figures
used here, and consistent with the model's complementarity term); a
KDnuggets piece criticising TypeSafe's self-built benchmarks; and arXiv
2501.16548 (FAccT 2025), a qualitative paper on the Jevons paradox in AI's
environmental debate, with no scenario model. None changes a number here;
they are candidates for future citations.

## Model

- **Demand responds to the full cost of a decision.** A fraction `c` of
  decisions still needs an LLM call, so the average decision costs `q + c`
  and uses `r + c` (in units of the old LLM-only decision), and volume
  scales as `(q + c)^(-eps)` (`METHODOLOGY.md` §2–§4). Growing volume as if
  every decision cost only JEV's price would be internally inconsistent
  (`VERIFICATION.md` §3, item 11).
- **Rebound is measured against the saving with complementarity**,
  `1 − (r + c)`: the LLM calls in the share `c` are part of the new path, not
  a behavioral response to a lower price (`METHODOLOGY.md` §7;
  `VERIFICATION.md` §3, item 12). It is undefined ("n/a") when `r + c ≥ 1`.
- **The 50% rebound split between "Efficiency wins" and "Partial rebound" is
  this project's own convention**, stated as such; the 100% (backfire)
  boundary is the sign of `E1 − E0`, not a convention.
- **The page leads with the breakeven elasticity** (`eps*`, the elasticity
  above which total energy exceeds the 2025 baseline at the current
  settings), with the outcome at the chosen `eps` underneath. The result
  depends so strongly on `eps`, which nobody has measured, that the
  threshold is more informative than any single outcome.

## Monte Carlo

- **The ranges are not tuned to reach any particular probability.** With the
  registry's ranges the backfire share is 61.6% of 10,000 samples. It is
  almost entirely a function of the `eps` range: a sample backfires when its
  `eps` exceeds its own `eps*`, and with `eps` uniform on [0.1, 2.0] the share
  is `(2 − mean eps*) / 1.9` in expectation (61.2% here; the gap is sampling
  noise, `METHODOLOGY.md` §9). The page says so next to the number. There is
  no evidence to justify a different `eps` range, so none was chosen to move
  the result.
- **`q` and `E0` are held fixed** at their point estimates; their
  sensitivity is shown by the sliders instead (`METHODOLOGY.md` §9).

## Default scenario and presets

- **Default `eps` is 0.5.** An earlier default of 1.2 put the first-load
  scenario above 10% of global electricity demand, which would greet every
  visitor with the plausibility warning. 0.5 is a landing-state choice, not
  a claim that it is the correct elasticity; the whole 0.1–2.0 range stays
  explorable. At the defaults (`s = 0.3`, `c = 0.3`) total AI inference
  energy falls 12.5% ("Efficiency wins", rebound 38%), and the breakeven is
  `eps* ≈ 0.966`.
- **Presets vary only the scenario parameters** (`s`, `eps`, `c`) and keep
  the sourced `r` and `q`. They were computed with `model.js`, chosen with a
  clear margin from the classification boundaries, and a Playwright test
  checks that each produces the outcome it is named after:

| Preset | `s` | `eps` | `c` | E1/E0 | Rebound | Outcome |
|---|---|---|---|---|---|---|
| Efficiency wins | 0.2 | 0.1 | 0.05 | 0.820 | 2.6% | savings |
| Partial rebound | 0.3 | 0.75 | 0.15 | 0.905 | 61.7% | partial rebound |
| Jevons backfire | 0.3 | 1.3 | 0.2 | 1.205 | 188.4% | backfire |

  The backfire preset's `eps` stays well below the slider's upper end so the
  illustration remains plausible (0.46% of 2025 global electricity demand);
  the slider can still reach far more extreme values, and the plausibility
  warning (R8) fires when it does.

## Page presentation

- **Share images are generated, not drawn.** `scripts/render-share-images.mjs`
  renders `docs/og.png` (link previews) and `docs/chart-breakeven.png` (posts)
  with Playwright from `scripts/share-content.mjs`, which reads every number
  from the model at the default scenario. Each PNG is stamped with a hash of
  the data and model it was rendered from, so a test fails if they change
  and the images are not re-rendered (`npm run render:share`). The
  link-preview description is filled in by the build from the same module.
- **Every color is a theme token** on `:root`. Light is the default and also
  applies when the viewer picks "light" on a dark system; dark applies on a
  dark system unless "light" was picked, or when "dark" was picked. The
  choice is remembered in `localStorage` (inside `try/catch`, so the page
  works without it). Tests check text contrast in all four combinations.
- **Numbers are always formatted as en-US** (decimal point, comma
  thousands), whatever the browser's language, to match the sources and the
  methodology.
- **`eps` in the Sources table shows its range**, labeled "range this
  project chose", not the 0.5 default: the cited UKERC review motivates a
  range and never states 0.5.
- **The rebound figure has an inline explanation** ("<100% = still saves;
  >100% = backfire").
- **Registered values are shown exactly as stored** in the Sources table and
  the "what we know" panel, so they can be checked digit for digit against
  their evidence; derived values and model outputs are rounded for display.
  Small figures are shown in decimal (scientific notation starts below
  0.0001).
- **The "last checked" line is computed** from the cited sources'
  `accessed_date` values, never hardcoded.
