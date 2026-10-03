// Check A.4: every source_url should resolve. A dead link produces a warning
// (non-zero exit is intentionally avoided here — the CI step treats failures
// of this script as non-blocking, per check A.4 in METHODOLOGY.md §10) and is recorded so it
// can be copied into VERIFICATION.md.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcesPath = path.join(__dirname, "..", "data", "sources.json");
const { entries } = JSON.parse(readFileSync(sourcesPath, "utf8"));

const urls = [...new Set(entries.map((e) => e.source_url).filter(Boolean))];

console.log(`Checking ${urls.length} distinct source URLs...`);

let failures = 0;
for (const url of urls) {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      // Some sites (e.g. blogs behind bot protection) reject HEAD but allow GET.
      const getRes = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(10000) });
      if (!getRes.ok) {
        console.warn(`::warning::Dead link (HTTP ${getRes.status}): ${url}`);
        failures++;
      } else {
        console.log(`OK (via GET): ${url}`);
      }
    } else {
      console.log(`OK: ${url}`);
    }
  } catch (err) {
    console.warn(`::warning::Unreachable (${err.message}): ${url}`);
    failures++;
  }
}

console.log(`\n${urls.length - failures}/${urls.length} links resolved.`);
if (failures > 0) {
  console.warn(`::warning::${failures} source link(s) could not be verified as reachable. See VERIFICATION.md.`);
}
// Intentionally exit 0 always: link rot is a warning, not a build blocker (check A.4, METHODOLOGY.md §10).
process.exit(0);
