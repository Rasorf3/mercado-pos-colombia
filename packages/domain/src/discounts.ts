import { DomainValidationError, MAX_SQLITE_INTEGER, parseCopInteger } from "./catalog.js";

export type DiscountDraft =
  | { type: "percentage"; value: string }
  | { type: "fixed"; valueCop: string };

export interface NormalizedDiscount {
  type: DiscountDraft["type"];
  /** Percentage uses basis points (10000 = 100%); fixed uses integer COP per unit. */
  value: bigint;
}

export interface ProductPromotionDraft {
  discount: DiscountDraft;
  startsOn: string;
  endsOn: string;
}

export interface NormalizedProductPromotion {
  discount: NormalizedDiscount;
  startsOn: string;
  endsOn: string;
}

export function normalizeDiscount(
  input: DiscountDraft | null | undefined,
  unitPriceCop: bigint
): NormalizedDiscount | null {
  if (input == null) return null;
  if (input.type === "percentage") {
    const value = parsePercentageBasisPoints(input.value);
    if (value < 1n || value > 10_000n) {
      throw new DomainValidationError("El descuento porcentual debe ser mayor que 0 y no superar 100%.");
    }
    return { type: input.type, value };
  }
  if (input.type === "fixed") {
    const value = parseCopInteger(input.valueCop);
    if (value === 0n) throw new DomainValidationError("El descuento fijo debe ser mayor que cero COP por unidad.");
    if (value > unitPriceCop) {
      throw new DomainValidationError("El descuento fijo por unidad no puede superar el precio de venta.");
    }
    return { type: input.type, value };
  }
  throw new DomainValidationError("El tipo de descuento no es válido.");
}

export function parsePercentageBasisPoints(rawValue: string): bigint {
  const value = rawValue.trim().replace(",", ".");
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new DomainValidationError("El porcentaje debe ser un número con máximo dos decimales.");
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
  const basisPoints = whole * 100n + fraction;
  if (basisPoints > 10_000n) {
    throw new DomainValidationError("El porcentaje no puede superar 100%.");
  }
  return basisPoints;
}

export function discountFromStored(type: string | null, value: bigint | null): DiscountDraft | null {
  if (type === null && value === null) return null;
  if (type === "percentage" && value !== null && value > 0n && value <= 10_000n) {
    const whole = value / 100n;
    const fraction = (value % 100n).toString().padStart(2, "0").replace(/0+$/, "");
    return { type, value: fraction ? `${whole}.${fraction}` : whole.toString() };
  }
  if (type === "fixed" && value !== null && value > 0n && value <= MAX_SQLITE_INTEGER) {
    return { type, valueCop: value.toString() };
  }
  throw new DomainValidationError("El descuento guardado no es válido.");
}

export function normalizeProductPromotion(
  input: ProductPromotionDraft | null | undefined,
  unitPriceCop: bigint
): NormalizedProductPromotion | null {
  if (input == null) return null;
  const startsOn = normalizeDateOnly(input.startsOn, "La fecha inicial");
  const endsOn = normalizeDateOnly(input.endsOn, "La fecha final");
  if (endsOn < startsOn) {
    throw new DomainValidationError("La fecha final debe ser igual o posterior a la fecha inicial.");
  }
  return {
    discount: normalizeDiscount(input.discount, unitPriceCop)!,
    startsOn,
    endsOn
  };
}

export function activePromotionDiscount(
  promotion: NormalizedProductPromotion | null,
  date: string
): NormalizedDiscount | null {
  if (!promotion) return null;
  const today = normalizeDateOnly(date, "La fecha de consulta");
  return today >= promotion.startsOn && today <= promotion.endsOn ? promotion.discount : null;
}

export function formatBogotaDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = new Map(parts.map(({ type, value }) => [type, value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function formatDiscountDraft(discount: NormalizedDiscount | null): DiscountDraft | null {
  if (!discount) return null;
  return discountFromStored(discount.type, discount.value);
}

function normalizeDateOnly(value: string, label: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new DomainValidationError(`${label} debe usar el formato AAAA-MM-DD.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (year < 1 || !daysInMonth || day < 1 || day > daysInMonth) {
    throw new DomainValidationError(`${label} no es una fecha válida.`);
  }
  return value;
}
