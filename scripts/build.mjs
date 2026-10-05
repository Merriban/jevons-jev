// Builds dist/index.html: a single, self-contained HTML file with
// data/sources.json and model/model.js inlined directly, so it works when
// opened via file:// (where an external <script type="module" src="...">
// or fetch('data/sources.json') would be blocked by the browser's same
// -origin restrictions on local files) and on GitHub Pages alike.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { shareContent } from "./share-content.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const template = readFileSync(path.join(root, "index.html"), "utf8");
const sourcesJson = readFileSync(path.join(root, "data", "sources.json"), "utf8");
const modelJs = readFileSync(path.join(root, "model", "model.js"), "utf8");

// Re-parse and re-stringify sources.json (rather than pasting the raw file
// text) so a stray literal "</script>" or unescaped character in the data
// can never break out of the inline <script type="application/json"> tag.
const sourcesObj = JSON.parse(sourcesJson);
const sourcesInline = JSON.stringify(sourcesObj).replace(/</g, "\\u003c");

// Strip ES module `export` keywords so the whole file can be concatenated
// into one classic (non-module) inline <script>, which avoids needing
// cross-file ES module imports entirely (those are what file:// blocks).
// The regex only touches `export function` / `export const` / `export class`
// at the start of a line, which is exactly (and only) how model.js exports
// things -- verified by the test in tests/build.test.js.
const modelInline = modelJs.replace(/^export (function|const|class) /gm, "$1 ");

if (/^export /m.test(modelInline)) {
  throw new Error("build.mjs: model.js still contains an `export` statement after stripping; update the regex.");
}

let output = template;
output = output.replace("__SOURCES_JSON__", () => sourcesInline);
output = output.replace("__MODEL_JS__", () => modelInline);

// Link-preview description, computed from the model at the default scenario.
const escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
output = output.replaceAll("__SHARE_DESCRIPTION__", () => escapeAttr(shareContent().ogDescription));

if (output.includes("__SOURCES_JSON__") || output.includes("__MODEL_JS__") || output.includes("__SHARE_DESCRIPTION__")) {
  throw new Error("build.mjs: a placeholder was not replaced. Check index.html's markers.");
}

const distDir = path.join(root, "dist");
mkdirSync(distDir, { recursive: true });
const outPath = path.join(distDir, "index.html");
writeFileSync(outPath, output, "utf8");

// The Open Graph image must be published next to the page, since og:image
// points at <site>/og.png.
const ogSource = path.join(root, "docs", "og.png");
if (!existsSync(ogSource)) throw new Error("build.mjs: docs/og.png is missing; run `npm run render:share`.");
copyFileSync(ogSource, path.join(distDir, "og.png"));

const bytes = Buffer.byteLength(output, "utf8");
console.log(`Built ${outPath} (${bytes.toLocaleString()} bytes, ${(bytes / 1024 / 1024).toFixed(3)} MiB)`);
if (bytes > 16 * 1024 * 1024) {
  throw new Error("build.mjs: dist/index.html exceeds a reasonable single-file size budget (16 MiB).");
}
