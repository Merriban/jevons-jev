import { test } from "node:test";
import assert from "node:assert/strict";
import { toWh, fromWh, convert, EnergyQty, WH_PER_UNIT } from "../model/units.js";

test("1 TWh = 1e12 Wh", () => {
  assert.equal(toWh(1, "TWh"), 1e12);
});

test("1 GWh = 1e9 Wh", () => {
  assert.equal(toWh(1, "GWh"), 1e9);
});

test("1 MWh = 1e6 Wh", () => {
  assert.equal(toWh(1, "MWh"), 1e6);
});

test("1 kWh = 1e3 Wh", () => {
  assert.equal(toWh(1, "kWh"), 1e3);
});

test("round-trip conversion is identity within floating point tolerance", () => {
  for (const unit of Object.keys(WH_PER_UNIT)) {
    const back = fromWh(toWh(123.456, unit), unit);
    assert.ok(Math.abs(back - 123.456) < 1e-9, `round trip failed for ${unit}`);
  }
});

test("convert() TWh -> Wh matches direct factor", () => {
  assert.equal(convert(2.5, "TWh", "Wh"), 2.5e12);
});

test("convert() Wh -> TWh matches direct factor", () => {
  assert.equal(convert(2.5e12, "Wh", "TWh"), 2.5);
});

test("unknown unit throws", () => {
  assert.throws(() => toWh(1, "PWh"), RangeError);
  assert.throws(() => fromWh(1, "PWh"), RangeError);
});

test("non-finite value throws", () => {
  assert.throws(() => toWh(NaN, "TWh"), TypeError);
  assert.throws(() => toWh(Infinity, "TWh"), TypeError);
});

test("EnergyQty stores canonical Wh and converts back", () => {
  const q = new EnergyQty(1, "TWh", "datacenter_total");
  assert.equal(q.in("TWh"), 1);
  assert.equal(q.in("GWh"), 1000);
});

test("EnergyQty.add refuses to mix scopes silently", () => {
  const a = new EnergyQty(1, "TWh", "gpu_only");
  const b = new EnergyQty(1, "TWh", "datacenter_total");
  assert.throws(() => a.add(b), /different scopes/);
});

test("EnergyQty.add allows same-scope addition", () => {
  const a = new EnergyQty(1, "TWh", "gpu_only");
  const b = new EnergyQty(2, "TWh", "gpu_only");
  const sum = a.add(b);
  assert.equal(sum.in("TWh"), 3);
  assert.equal(sum.scope, "gpu_only");
});

test("EnergyQty.add allows mixed scope only when explicitly forced", () => {
  const a = new EnergyQty(1, "TWh", "gpu_only");
  const b = new EnergyQty(1, "TWh", "datacenter_total");
  const sum = a.add(b, { allowMixedScope: true });
  assert.equal(sum.in("TWh"), 2);
  assert.equal(sum.scope, "unknown");
});

test("EnergyQty.add treats 'unknown' scope as mixable with anything", () => {
  const a = new EnergyQty(1, "TWh", "unknown");
  const b = new EnergyQty(1, "TWh", "gpu_only");
  const sum = a.add(b);
  assert.equal(sum.in("TWh"), 2);
});

test("applyPUE scales value and re-scopes to datacenter_total", () => {
  const gpu = new EnergyQty(100, "MWh", "gpu_only");
  const total = gpu.applyPUE(1.2);
  assert.equal(total.in("MWh"), 120);
  assert.equal(total.scope, "datacenter_total");
});

test("applyPUE rejects pue < 1", () => {
  const gpu = new EnergyQty(100, "MWh", "gpu_only");
  assert.throws(() => gpu.applyPUE(0.9), RangeError);
});

test("applyPUE refuses to re-apply to an already-total quantity", () => {
  const total = new EnergyQty(100, "MWh", "datacenter_total");
  assert.throws(() => total.applyPUE(1.2), /already scoped/);
});
