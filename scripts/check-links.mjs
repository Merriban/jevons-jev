// Check A.4: every source_url should resolve. A dead link produces a warning
// (non-zero exit is intentionally avoided here — the CI step treats failures
// of this script as non-blocking, per check A.4 in METHODOLOGY.md §10) and is recorded so it
// can be copied into VERIFICATION.md.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classifyLinkStatus } from "./link-status.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcesPath = path.join(__dirname, "..", "data", "sources.json");
const { entries } = JSON.parse(readFileSync(sourcesPath, "utf8"));

const urls = [...new Set(entries.map((e) => e.source_url).filter(Boolean))];

console.log(`Checking ${urls.length} distinct source URLs...`);

const counts = { ok: 0, blocked: 0, dead: 0, error: 0 };
for (const url of urls) {
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(10000) });
    let via = "";
    if (!res.ok) {
      // Some sites reject HEAD but allow GET.
      res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(10000) });
      via = " (via GET)";
    }
    const { kind, label } = classifyLinkStatus(res.status);
    counts[kind]++;
    if (kind === "ok") console.log(`OK${via}: ${url}`);
    else console.warn(`::warning::${label}: ${url}`);
  } catch (err) {
    counts.error++;
    console.warn(`::warning::Unreachable (${err.message}): ${url}`);
  }
}

console.log(`\n${counts.ok}/${urls.length} links resolved; ${counts.blocked} blocked (HTTP 403), ${counts.dead} dead (HTTP 404/410), ${counts.error} other errors.`);
if (counts.ok < urls.length) {
  console.warn(`::warning::${urls.length - counts.ok} source link(s) could not be verified as reachable. See VERIFICATION.md.`);
}
// Intentionally exit 0 always: link rot is a warning, not a build blocker (check A.4, METHODOLOGY.md §10).
process.exit(0);
