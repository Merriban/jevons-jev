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

test("link-preview meta tags are present, with absolute URLs, and og.png is published next to the page", () => {
  const html = readFileSync(distIndexPath, "utf8");
  const meta = (attr, name) => {
    const m = html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)">`));
    assert.ok(m, `missing <meta ${attr}="${name}">`);
    return m[1];
  };
  const site = "https://merriban.github.io/jevons-jev/";
  assert.equal(meta("property", "og:type"), "website");
  assert.equal(meta("property", "og:url"), site);
  assert.equal(meta("property", "og:image"), `${site}og.png`);
  assert.equal(meta("name", "twitter:image"), `${site}og.png`);
  assert.equal(meta("property", "og:image:width"), "1200");
  assert.equal(meta("property", "og:image:height"), "630");
  assert.equal(meta("name", "twitter:card"), "summary_large_image");
  for (const [attr, name] of [["property", "og:title"], ["property", "og:description"], ["property", "og:image:alt"], ["name", "twitter:title"], ["name", "twitter:description"]]) {
    assert.ok(meta(attr, name).length > 20, `${name} should not be empty`);
  }
  for (const url of [meta("property", "og:url"), meta("property", "og:image"), meta("name", "twitter:image")]) {
    assert.match(url, /^https:\/\//, `${url} must be absolute`);
  }
  const canonical = html.match(/<link rel="canonical" href="([^"]*)">/);
  assert.ok(canonical && canonical[1] === site, "missing or wrong canonical link");
  assert.ok(!html.includes("__SHARE_DESCRIPTION__"));
  const published = readFileSync(path.join(root, "dist", "og.png"));
  assert.ok(published.equals(readFileSync(path.join(root, "docs", "og.png"))), "dist/og.png must be a copy of docs/og.png");
});

