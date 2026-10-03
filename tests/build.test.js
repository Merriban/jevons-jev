import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const distIndexPath = path.join(root, "dist", "index.html");

test("scripts/build.mjs runs and produces dist/index.html", () => {
  execFileSync("node", [path.join(root, "scripts", "build.mjs")], { cwd: root });
  assert.ok(existsSync(distIndexPath));
});

test("dist/index.html has no leftover build placeholders", () => {
  const html = readFileSync(distIndexPath, "utf8");
  assert.ok(!html.includes("__SOURCES_JSON__"));
  assert.ok(!html.includes("__MODEL_JS__"));
});

test("dist/index.html has no bare `export` statements (would break as a classic inline script)", () => {
  const html = readFileSync(distIndexPath, "utf8");
  assert.ok(!/^\s*export (function|const|class) /m.test(html));
});

test("dist/index.html embeds valid, parseable sources.json data", () => {
  const html = readFileSync(distIndexPath, "utf8");
  const match = html.match(/<script id="sources-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, "could not find inlined sources-data script tag");
  const parsed = JSON.parse(match[1]);
  assert.ok(Array.isArray(parsed.entries));
  assert.ok(parsed.entries.length >= 40);
});

test("dist/index.html contains no <script src> or fetch() calls to external files (must be self-contained)", () => {
  const html = readFileSync(distIndexPath, "utf8");
  assert.ok(!/<script[^>]+src=/.test(html), "found an external <script src=...>");
  assert.ok(!/\bfetch\s*\(/.test(html), "found a fetch() call, which would break file:// usage");
});

test("dist/index.html size stays within the 16 MiB artifact budget", () => {
  const stats = readFileSync(distIndexPath);
  assert.ok(stats.length < 16 * 1024 * 1024);
});
