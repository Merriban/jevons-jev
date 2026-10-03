// Classifies an HTTP status from the link check (check A.4). Kept separate
// from scripts/check-links.mjs so it can be unit-tested without network.
//
// 403 is reported apart from 404/410: sites behind bot protection (e.g.
// iea.org) answer automated requests with 403 while the page exists, so a
// 403 means "could not check automatically", not "the source is gone".
export function classifyLinkStatus(status) {
  if (status >= 200 && status < 300) return { kind: "ok", label: "OK" };
  if (status === 403) return { kind: "blocked", label: "Blocked (HTTP 403, likely bot protection)" };
  if (status === 404 || status === 410) return { kind: "dead", label: `Dead link (HTTP ${status})` };
  return { kind: "error", label: `Unexpected response (HTTP ${status})` };
}
