// Energy unit conversion helpers.
// Internally, all energy quantities in this codebase are canonicalised to
// watt-hours (Wh) as soon as they cross a module boundary, specifically to
// make unit-mismatch bugs (e.g. mixing GPU-only and whole-datacenter figures,
// or Wh and TWh) impossible to hide inside plain numbers.

export const WH_PER_UNIT = Object.freeze({
  Wh: 1,
  kWh: 1e3,
  MWh: 1e6,
  GWh: 1e9,
  TWh: 1e12,
});

/**
 * Convert a value expressed in `fromUnit` into watt-hours.
 */
export function toWh(value, fromUnit) {
  const factor = WH_PER_UNIT[fromUnit];
  if (factor === undefined) {
    throw new RangeError(`Unknown energy unit: ${fromUnit}`);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`toWh expects a finite number, got ${value}`);
  }
  return value * factor;
}

/**
 * Convert a value in watt-hours into `toUnit`.
 */
export function fromWh(valueWh, toUnit) {
  const factor = WH_PER_UNIT[toUnit];
  if (factor === undefined) {
    throw new RangeError(`Unknown energy unit: ${toUnit}`);
  }
  if (typeof valueWh !== "number" || !Number.isFinite(valueWh)) {
    throw new TypeError(`fromWh expects a finite number, got ${valueWh}`);
  }
  return valueWh / factor;
}

/**
 * Convert directly between two energy units, via Wh.
 */
export function convert(value, fromUnit, toUnit) {
  return fromWh(toWh(value, fromUnit), toUnit);
}

/**
 * A tagged energy quantity. Carrying the unit alongside the number, and the
 * measurement "scope" (what physical boundary the figure covers), makes it
 * possible to forbid arithmetic across incompatible scopes at the type
 * level instead of silently producing a wrong number.
 *
 * Recognised scopes (see METHODOLOGY.md and sources.json `notes` fields):
 *  - "gpu_only": AI accelerator power draw only, no cooling/networking/PUE.
 *  - "datacenter_it": IT equipment load (servers incl. GPU+CPU+memory+NIC),
 *    still excluding facility overhead.
 *  - "datacenter_total": whole-facility energy including cooling and other
 *    overhead (i.e. IT load x PUE).
 *  - "unknown": scope not stated by the source; must not be silently mixed
 *    with any other scope.
 */
export class EnergyQty {
  constructor(value, unit, scope = "unknown") {
    this.valueWh = toWh(value, unit);
    this.scope = scope;
  }

  static fromWh(valueWh, scope = "unknown") {
    const q = new EnergyQty(0, "Wh", scope);
    q.valueWh = valueWh;
    return q;
  }

  in(unit) {
    return fromWh(this.valueWh, unit);
  }

  /**
   * Add another EnergyQty. Refuses to add quantities with different scopes
   * unless `allowMixedScope` is explicitly set, which forces the caller to
   * acknowledge the conversion is not scope-clean.
   */
  add(other, { allowMixedScope = false } = {}) {
    if (!allowMixedScope && this.scope !== "unknown" && other.scope !== "unknown" && this.scope !== other.scope) {
      throw new Error(
        `Refusing to add EnergyQty of different scopes ("${this.scope}" vs "${other.scope}") without allowMixedScope: true`
      );
    }
    const scope = this.scope === other.scope ? this.scope : "unknown";
    return EnergyQty.fromWh(this.valueWh + other.valueWh, scope);
  }

  /**
   * Apply a PUE (Power Usage Effectiveness) factor to convert an IT-load or
   * GPU-only figure into a whole-facility figure. `pue` must be >= 1.
   */
  applyPUE(pue) {
    if (typeof pue !== "number" || !Number.isFinite(pue) || pue < 1) {
      throw new RangeError(`PUE must be a finite number >= 1, got ${pue}`);
    }
    if (this.scope === "datacenter_total") {
      throw new Error("Refusing to apply PUE to a quantity already scoped as datacenter_total");
    }
    return new EnergyQty(this.valueWh * pue, "Wh", "datacenter_total");
  }
}
