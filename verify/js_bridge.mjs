// Thin bridge so verify/differential_test.py can invoke the real JS
// model/model.js as a subprocess and compare its output against the
// independent Python reimplementation. Reads one JSON request from stdin,
// writes one JSON response to stdout. Not used by the page or by the JS
// test suite -- this file exists solely for differential testing.
import { computeScenario, runMonteCarlo, sweepEpsilon, breakevenEpsilon } from "../model/model.js";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const input = JSON.parse(await readStdin());

if (input.mode === "scenarios") {
  const results = input.points.map((p) => computeScenario(p));
  process.stdout.write(JSON.stringify(results));
} else if (input.mode === "montecarlo") {
  const result = runMonteCarlo(input.ranges, input.fixed, input.n, input.seed);
  process.stdout.write(JSON.stringify(result));
} else if (input.mode === "sweep") {
  const { params, epsMin, epsMax, steps } = input;
  const result = sweepEpsilon(params, epsMin, epsMax, steps);
  process.stdout.write(JSON.stringify(result));
} else if (input.mode === "breakeven") {
  process.stdout.write(JSON.stringify(input.points.map((p) => breakevenEpsilon(p))));
} else {
  throw new Error(`Unknown mode: ${input.mode}`);
}
