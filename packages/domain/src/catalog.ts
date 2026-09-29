export const PRODUCT_UNITS = ["unit", "kg", "g", "l", "ml", "m"] as const;
export type ProductUnit = typeof PRODUCT_UNITS[number];
export const PRODUCT_WEIGHT_UNITS = ["g", "kg", "lb"] as const;
export type ProductWeightUnit = typeof PRODUCT_WEIGHT_UNITS[number];
export type MovementType = "initial" | "entry" | "adjustment" | "sale_out";

export interface ProductDraftInput {
  name: string;
  internalCode: string;
  barcode: string | null;
  costCop: string;
  salePriceCop: string;
  unit: string;
  weightPerUnit?: string | null;
  weightUnit?: string | null;
}

export interface NormalizedProductDraft {
  name: string;
  internalCode: string;
  barcode: string | null;
  costCop: bigint;
  salePriceCop: bigint;
  unit: ProductUnit;
  weightPerUnitMilli: bigint | null;
  weightUnit: ProductWeightUnit | null;
}

export const MAX_SQLITE_INTEGER = 9_223_372_036_854_775_807n;

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

export function parseCopInteger(value: string): bigint {
  if (!/^\d{1,19}$/.test(value)) {
    throw new DomainValidationError("El costo y el precio deben ser pesos enteros en COP.");
  }

  const amount = BigInt(value);
  if (amount > MAX_SQLITE_INTEGER) {
    throw new DomainValidationError("El valor excede el máximo entero permitido por SQLite.");
  }

  return amount;
}

export function parseQuantityMilli(value: string): bigint {
  const normalized = normalizeDecimalSeparator(value);
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(normalized);

  if (!match) {
    throw new DomainValidationError("La cantidad debe ser positiva o cero y tener máximo tres decimales.");
  }

  const whole = BigInt(match[1]);
  const fractional = BigInt((match[2] ?? "").padEnd(3, "0"));
  const milli = whole * 1_000n + fractional;

  if (milli > MAX_SQLITE_INTEGER) {
    throw new DomainValidationError("La cantidad excede el máximo entero permitido por SQLite.");
  }

  return milli;
}

export function parseQuantityDeltaMilli(value: string): bigint {
  const normalized = normalizeDecimalSeparator(value);
  const match = /^([+-]?)(\d+)(?:\.(\d{1,3}))?$/.exec(normalized);

  if (!match) {
    throw new DomainValidationError("El ajuste debe tener máximo tres decimales.");
  }

  const whole = BigInt(match[2]);
  const fractional = BigInt((match[3] ?? "").padEnd(3, "0"));
  const absoluteDelta = whole * 1_000n + fractional;
  if (absoluteDelta > MAX_SQLITE_INTEGER) {
    throw new DomainValidationError("El ajuste excede el máximo entero permitido por SQLite.");
  }

  return match[1] === "-" ? -absoluteDelta : absoluteDelta;
}

export function formatQuantityMilli(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 1_000n;
  const fractional = (absolute % 1_000n).toString().padStart(3, "0").replace(/0+$/, "");
  return fractional ? `${sign}${whole}.${fractional}` : `${sign}${whole}`;
}

export function normalizeProductDraft(input: ProductDraftInput): NormalizedProductDraft {
  const name = input.name.trim();
  const internalCode = input.internalCode.trim();
  const barcode = input.barcode?.trim() || null;

  if (!name) {
    throw new DomainValidationError("El nombre del producto es obligatorio.");
  }
  if (name.length > 120) {
    throw new DomainValidationError("El nombre no puede superar 120 caracteres.");
  }
  if (!internalCode || internalCode.length > 64) {
    throw new DomainValidationError("El código interno es obligatorio y admite máximo 64 caracteres.");
  }
  if (barcode && barcode.length > 64) {
    throw new DomainValidationError("El código de barras admite máximo 64 caracteres.");
  }
  if (!PRODUCT_UNITS.some((unit) => unit === input.unit)) {
    throw new DomainValidationError("La unidad de medida no es válida.");
  }

  const rawWeight = input.weightPerUnit ?? null;
  const rawWeightUnit = input.weightUnit ?? null;
  if ((rawWeight === null) !== (rawWeightUnit === null)) {
    throw new DomainValidationError("Completa tanto el peso por unidad como su unidad, o deja ambos vacíos.");
  }
  if (rawWeight !== null && input.unit !== "unit") {
    throw new DomainValidationError("El peso por empaque solo aplica a productos cuyo inventario se cuenta por unidades.");
  }
  if (rawWeightUnit !== null && !PRODUCT_WEIGHT_UNITS.some((unit) => unit === rawWeightUnit)) {
    throw new DomainValidationError("La unidad del peso por empaque debe ser g, kg o lb.");
  }
  const weightPerUnitMilli = rawWeight === null ? null : parseQuantityMilli(rawWeight);
  if (weightPerUnitMilli === 0n) {
    throw new DomainValidationError("El peso por unidad debe ser mayor que cero.");
  }

  return {
    name,
    internalCode,
    barcode,
    costCop: parseCopInteger(input.costCop),
    salePriceCop: parseCopInteger(input.salePriceCop),
    unit: input.unit as ProductUnit,
    weightPerUnitMilli,
    weightUnit: rawWeightUnit as ProductWeightUnit | null
  };
}

export function calculateStockWeight(
  stock: string,
  weightPerUnit: string | null,
  weightUnit: ProductWeightUnit | null
): string | null {
  if (weightPerUnit === null || weightUnit === null) return null;
  const stockMilli = parseQuantityMilli(stock);
  const weightMilli = parseQuantityMilli(weightPerUnit);
  const totalMilli = (stockMilli * weightMilli + 500n) / 1_000n;
  return `${formatQuantityMilli(totalMilli)} ${weightUnit}`;
}

export function applyStockDelta(currentStockMilli: bigint, deltaMilli: bigint): bigint {
  if (currentStockMilli < 0n) {
    throw new DomainValidationError("El inventario actual no puede ser negativo.");
  }

  const nextStockMilli = currentStockMilli + deltaMilli;
  if (nextStockMilli < 0n) {
    throw new DomainValidationError("El ajuste dejaría las existencias por debajo de cero.");
  }
  if (nextStockMilli > MAX_SQLITE_INTEGER) {
    throw new DomainValidationError("Las existencias excederían el máximo entero permitido por SQLite.");
  }

  return nextStockMilli;
}

export function validateMovementNote(note: string): string {
  const normalized = note.trim();
  if (!normalized || normalized.length > 240) {
    throw new DomainValidationError("El motivo es obligatorio y admite máximo 240 caracteres.");
  }
  return normalized;
}

function normalizeDecimalSeparator(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes(",") && trimmed.includes(".")) {
    throw new DomainValidationError("Usa coma o punto como separador decimal, no ambos.");
  }
  return trimmed.replace(",", ".");
}
