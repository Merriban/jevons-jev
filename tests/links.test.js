// Check A.4 helper: link-check status classification (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLinkStatus } from "../scripts/link-status.mjs";

test("2xx statuses are OK", () => {
  for (const s of [200, 204, 299]) assert.equal(classifyLinkStatus(s).kind, "ok");
});

test("403 is reported as blocked (likely bot protection), not as a dead link", () => {
  const r = classifyLinkStatus(403);
  assert.equal(r.kind, "blocked");
  assert.equal(r.label, "Blocked (HTTP 403, likely bot protection)");
});

test("404 and 410 are dead links", () => {
  assert.deepEqual(classifyLinkStatus(404), { kind: "dead", label: "Dead link (HTTP 404)" });
  assert.deepEqual(classifyLinkStatus(410), { kind: "dead", label: "Dead link (HTTP 410)" });
});

test("other non-2xx statuses are unexpected responses", () => {
  for (const s of [301, 429, 500, 503]) assert.equal(classifyLinkStatus(s).kind, "error");
});
