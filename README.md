# The Jevons Question

An interactive page that asks whether radically cheaper AI decision models
would make total AI inference energy fall or rise, and lets you change every
assumption behind the answer.

### ▶ Live page: [merriban.github.io/jevons-jev](https://merriban.github.io/jevons-jev/)

**Key result, at default settings — a scenario, not a forecast:** total AI
inference energy rises above its 2025 baseline only if demand for AI
decisions has an elasticity above **0.966**.

![Desktop screenshot of the page](docs/screenshots/desktop.png)

How every number is derived: [`METHODOLOGY.md`](METHODOLOGY.md). How it was
checked: [`VERIFICATION.md`](VERIFICATION.md).

---

**If AI decisions got radically cheaper, would AI use less energy — or more?**

An interactive, open-source scenario study on what happens to total AI
inference energy use if the decision-style tasks currently handled by large
language models (classification, routing, scoring, yes/no calls) moved to a
much cheaper, non-text "System One" decision model like [Jev, from TypeSafe
AI](https://typesafe.ai) — and what the Jevons paradox has to say about
whether that would actually save any energy.

**This is a scenario tool, not a forecast.** Every number is either a cited
figure you can trace to its source, or an explicitly labeled scenario
assumption you're invited to change. Nothing here predicts what will
actually happen.

To run it locally, build it (`npm run build`) and open `dist/index.html` in
any browser; it works from a plain file, no server needed.

## What this is

Jev (and models like it) are, by their vendors' own evals, dramatically
cheaper and faster than general-purpose LLMs on bounded decision tasks. The obvious intuition is
"cheaper decisions → less energy". The Jevons paradox — first observed by
William Stanley Jevons in 1865, when more efficient steam engines *increased*
total coal consumption rather than reducing it — says that intuition can be
exactly backwards: if a price collapse increases usage by more than
proportionally, total energy use can rise even though each individual
decision got more efficient.

(The name is not a coincidence: TypeSafe AI says it named Jev after William
Stanley Jevons, expecting intelligence to follow coal's path — demand grows
as cost falls. Source: the FAQ in TypeSafe's launch post, ["Introducing
System One models and Jev"](https://typesafe.ai/blog/introducing-system-one-models-and-jev).)

This tool lets you explore that trade-off directly. Move the sliders,
compare the three presets ("Efficiency wins", "Partial rebound", "Jevons
backfire"), and see for yourself which assumptions push the outcome each
way.

## Methodology, in brief

The full derivation, with every formula proven step by step, is in
[`METHODOLOGY.md`](METHODOLOGY.md). The short version:

- `E0`: baseline AI inference energy (TWh/yr), of which a share `s` is spent
  on decision-style tasks.
- Replacing those decisions with a much cheaper alternative (price ratio
  `q`, energy ratio `r`, both JEV/LLM) doesn't just make each decision
  cheaper — it can also increase how *many* decisions get made, governed by
  a demand elasticity `eps`. A fraction `c` of the new volume still needs an
  LLM call alongside the cheaper model (complementarity, not full
  substitution), and those decisions pay for it: demand responds to the
  combined cost `q + c`, not to JEV's price alone.
- The key identity (proven in `METHODOLOGY.md` §4): when energy tracks price
  1:1, **total energy rises above the 2025 baseline `E0` if and only if
  `eps > 1`, whatever the complementarity `c`** — the mathematical
  condition for Jevons-paradox "backfire", identical in shape to the
  Khazzoom–Brookes postulate from the energy-economics literature.
- The rebound fraction is measured against the engineering saving *with*
  complementarity, `1 − (r + c)`: the LLM calls the share `c` still makes
  are part of the new path, not a rebound (`METHODOLOGY.md` §7).
- No figure for `r` (JEV's actual energy-per-decision, relative to an LLM)
  has been published by TypeSafe AI or measured independently, as far as
  this project could find. Rather than inventing a number, this project
  builds it from three biased proxies (price, latency, token count; the
  first two from the same TypeSafe eval) and shows the resulting range
  honestly instead of a single point estimate.
- A Monte Carlo run (10,000 samples, fixed seed, reproduced bit-for-bit in
  an independent Python implementation — see `verify/`) propagates all this
  uncertainty at once.

## Limits — read this before trusting any specific number

- **JEV's energy consumption in watt-hours is not public.** The `r`
  parameter is a reconstruction from indirect proxies, not a measurement,
  and the page says so more than once.
- **How it was built and checked.** This project was developed with Claude
  Code; every cited primary source was then opened and checked against the
  stored value by hand by the maintainer on 2026-09-29. The only entries still `unverified` are the four scenario
  parameters: three have no source to check by definition, and the rebound
  percentages quoted for `eps` sit in a full report that was not re-read (see
  `VERIFICATION.md` §5).
- **`s`, `eps`, and `c` have no measured values at all** — there is no
  public data on what share of AI inference is decision-style work, how
  price-elastic that demand is, or how often a decision model still needs an
  LLM alongside it. These are honest, wide-ranged guesses, clearly labeled
  as "scenario parameter" (not "measured") everywhere they appear.
- **The Monte Carlo panel's backfire probability (~62%) is a consequence of
  the stated ranges, not a prediction in either direction.** It is the share
  of samples whose elasticity lands above that sample's breakeven
  elasticity (between about 0.65 and 1.02 for 90% of samples), so it moves with where this
  project put the ends of the `eps` range (0.1–2.0) — see `METHODOLOGY.md`
  §6 and §9 and `DECISIONS.md`, including why the range was not tuned to
  reach any particular number. With the default settings the page shows a
  net saving (−12.5%, "Efficiency wins"), and its headline is the breakeven
  elasticity instead: total energy would rise only if `eps` exceeded ≈0.97.
- **Jev's price, cost and latency figures come from TypeSafe's own evals.**
  The workflows were built by TypeSafe's team, TypeSafe says it cannot prove
  its price is not subsidized, and Jev's published cost ($0.0004) and latency
  (0.4 s) are rounded to ±12.5%. `METHODOLOGY.md` §5 states how each of these
  can bias `q` and `r`.

## Contributing better data

Found a number that's wrong, a source that's moved, or a genuinely better
estimate for one of the scenario parameters? Contributions are very welcome,
especially:

1. **Re-opening any source URL in `data/sources.json` yourself** and
   confirming (or correcting) the quoted `evidence` and the `value` — then
   sending a PR that fixes the number or its `status`. Every entry follows the schema documented at the top of
   `tests/sources.test.js`.
2. **A better-justified range for `s`, `eps`, `c`, or `inference_share_of_ai_compute`.**
   These are explicitly acknowledged as guesses; if you have real data (a
   published breakdown of production LLM API call volume by task type, an
   actual measured price elasticity for AI inference, anything), open an
   issue or PR with the citation.
3. **An actual published Wh/joule figure for JEV**, if TypeSafe AI or anyone
   else ever discloses one — this would let `r` become a real measurement
   instead of a three-proxy reconstruction.

Before opening a PR, run:

```sh
npm install
npm test              # unit + data + model tests
npm run build          # produces dist/index.html
npx playwright install --with-deps chromium   # once
npx playwright test    # page tests against dist/index.html
python3 verify/differential_test.py            # JS vs. Python model agreement
node scripts/check-text-numbers.mjs            # every visible number traces to a source
node scripts/check-links.mjs                   # non-blocking link check
```

All of these run in CI (`.github/workflows/ci.yml`) on every push.

## Project layout

- `index.html` — the page source (a build template; see below).
- `model/model.js` — the pure computation core (no DOM).
- `model/units.js` — energy-unit conversion helpers.
- `data/sources.json` — every number used anywhere in this project, with its
  citation, verification status, and (for derived numbers) its formula.
- `verify/recompute.py` + `verify/differential_test.py` — an independent
  Python reimplementation of the model, used to cross-check the JS one.
- `scripts/build.mjs` — inlines `model/model.js` and `data/sources.json`
  directly into `index.html`, producing the actually-shippable
  `dist/index.html` (a single self-contained file that works from a plain
  `file://` URL — this is why the page can't just use an ES module `import`
  or `fetch()` for its data, both of which browsers block for local files).
- `scripts/check-text-numbers.mjs` — verifies every number visible on the
  rendered page traces to `data/sources.json` or a live model computation.
- `scripts/check-links.mjs` — checks that every cited URL still resolves
  (non-blocking).
- `tests/` — Node (`node --test`) unit/data/model tests and Playwright page
  tests.
- `METHODOLOGY.md` — the full derivation, with every formula proven.
- `DECISIONS.md` — a log of non-obvious decisions made while building this,
  with reasoning.
- `VERIFICATION.md` — the full verification report: every check's result,
  every discrepancy found against preliminary research, the adversarial
  review, and a manual spot-check list for a maintainer.

## Deploying your own copy

1. Push this repository to GitHub with GitHub Pages enabled with source
   "GitHub Actions" (Settings → Pages → Build and deployment → Source).
2. Push to the repository's default branch. `.github/workflows/ci.yml` runs
   the full test suite and, only if everything passes, deploys `dist/` to
   Pages.

## License

MIT.
