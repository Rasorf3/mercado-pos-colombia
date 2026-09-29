import { PAYMENT_METHOD_OPTIONS, type PaymentMethod, type ProductUnit } from "@mercado-pos/contracts";

export function saleMoney(value: string): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(BigInt(value));
}

export function saleDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short", timeStyle: "medium", timeZone: "America/Bogota"
  }).format(new Date(value));
}

export function paymentLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_OPTIONS.find((option) => option.id === method)?.label ?? method;
}

export function saleUnit(unit: ProductUnit): string {
  return ({ unit: "und.", kg: "kg", g: "g", l: "L", ml: "ml", m: "m" })[unit];
}
