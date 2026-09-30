import {
  MAX_SQLITE_INTEGER,
  DomainValidationError,
  formatQuantityMilli,
  parseCopInteger,
  parseQuantityMilli
} from "./catalog.js";
import { normalizeDiscount, type DiscountDraft, type NormalizedDiscount } from "./discounts.js";

export const PAYMENT_METHOD_IDS = [
  "cash",
  "debit_card",
  "credit_card",
  "bank_transfer",
  "nequi",
  "daviplata",
  "bre_b"
] as const;

export type PaymentMethodId = typeof PAYMENT_METHOD_IDS[number];

export interface SaleAmountLineInput {
  quantity: string;
  unitPriceCop: string;
  discount?: DiscountDraft | null;
}

export interface SalePaymentDraft {
  method: string;
  amountPaidCop: string;
  reference?: string;
  authorizationCode?: string;
}

export interface NormalizedSalePayment {
  method: PaymentMethodId;
  amountPaidCop: bigint;
  changeCop: bigint;
  reference: string | null;
  authorizationCode: string | null;
}

export interface CreditPaymentDraft {
  amountCop: string;
  method: string;
  reference?: string;
  authorizationCode?: string;
}

export interface NormalizedCreditPayment {
  amountCop: bigint;
  method: PaymentMethodId;
  reference: string | null;
  authorizationCode: string | null;
}

export function calculateSaleAmounts(lines: SaleAmountLineInput[]): {
  lineTotalsCop: bigint[];
  lineDiscountsCop: bigint[];
  normalizedDiscounts: Array<NormalizedDiscount | null>;
  totalCop: bigint;
} {
  if (lines.length === 0 || lines.length > 100) {
    throw new DomainValidationError("La venta debe incluir entre 1 y 100 productos.");
  }

  let totalCop = 0n;
  const lineDiscountsCop: bigint[] = [];
  const normalizedDiscounts: Array<NormalizedDiscount | null> = [];
  const lineTotalsCop = lines.map(({ quantity: rawQuantity, unitPriceCop: rawPrice, discount }) => {
    const quantityMilli = parseQuantityMilli(rawQuantity);
    if (quantityMilli === 0n) {
      throw new DomainValidationError("La cantidad de cada producto debe ser mayor que cero.");
    }

    const unitPriceCop = parseCopInteger(rawPrice);
    const normalizedDiscount = normalizeDiscount(discount, unitPriceCop);
    const grossNumerator = unitPriceCop * quantityMilli;
    const grossLineCop = (grossNumerator + 500n) / 1_000n;
    let discountCop = 0n;
    if (normalizedDiscount?.type === "percentage") {
      const denominator = 10_000_000n;
      const discountNumerator = grossNumerator * normalizedDiscount.value;
      discountCop = (discountNumerator + denominator / 2n) / denominator;
    } else if (normalizedDiscount?.type === "fixed") {
      discountCop = (normalizedDiscount.value * quantityMilli + 500n) / 1_000n;
    }
    const netLineCop = grossLineCop - discountCop;
    if (grossLineCop > MAX_SQLITE_INTEGER || discountCop > grossLineCop || discountCop > MAX_SQLITE_INTEGER) {
      throw new DomainValidationError("El subtotal o descuento de una línea excede el máximo permitido por SQLite.");
    }
    if (netLineCop > MAX_SQLITE_INTEGER) {
      throw new DomainValidationError("El subtotal de una línea excede el máximo permitido por SQLite.");
    }
    totalCop += netLineCop;
    if (totalCop > MAX_SQLITE_INTEGER) {
      throw new DomainValidationError("El total de la venta excede el máximo permitido por SQLite.");
    }
    lineDiscountsCop.push(discountCop);
    normalizedDiscounts.push(normalizedDiscount);
    return netLineCop;
  });

  return { lineTotalsCop, lineDiscountsCop, normalizedDiscounts, totalCop };
}

export function addSaleQuantity(current: string, increment = "1"): string {
  const next = parseQuantityMilli(current) + parseQuantityMilli(increment);
  if (next > MAX_SQLITE_INTEGER) {
    throw new DomainValidationError("La cantidad excede el máximo permitido por SQLite.");
  }
  return formatQuantityMilli(next);
}

export function validateSaleStock(quantity: string, available: string, productName: string): void {
  const requestedMilli = parseQuantityMilli(quantity);
  const availableMilli = parseQuantityMilli(available);
  if (requestedMilli === 0n) {
    throw new DomainValidationError("La cantidad de cada producto debe ser mayor que cero.");
  }
  if (requestedMilli > availableMilli) {
    throw new DomainValidationError(`Existencia insuficiente para ${productName}.`);
  }
}

export function combineSaleQuantities(
  lines: Array<{ productId: string; quantity: string }>
): Array<{ productId: string; quantityMilli: bigint }> {
  if (lines.length === 0 || lines.length > 100) {
    throw new DomainValidationError("La venta debe incluir entre 1 y 100 productos.");
  }

  const quantities = new Map<string, bigint>();
  for (const line of lines) {
    if (!line.productId.trim()) {
      throw new DomainValidationError("Falta el producto de una línea de venta.");
    }
    const quantity = parseQuantityMilli(line.quantity);
    if (quantity === 0n) {
      throw new DomainValidationError("La cantidad de cada producto debe ser mayor que cero.");
    }
    const combined = (quantities.get(line.productId) ?? 0n) + quantity;
    if (combined > MAX_SQLITE_INTEGER) {
      throw new DomainValidationError("La cantidad excede el máximo permitido por SQLite.");
    }
    quantities.set(line.productId, combined);
  }

  return Array.from(quantities, ([productId, quantityMilli]) => ({ productId, quantityMilli }));
}

export function normalizeSalePayment(
  input: SalePaymentDraft,
  totalCop: bigint
): NormalizedSalePayment {
  if (!PAYMENT_METHOD_IDS.some((method) => method === input.method)) {
    throw new DomainValidationError("El método de pago seleccionado no es válido.");
  }
  if (totalCop < 0n || totalCop > MAX_SQLITE_INTEGER) {
    throw new DomainValidationError("El total de la venta no es válido.");
  }

  const method = input.method as PaymentMethodId;
  const amountPaidCop = parseCopInteger(input.amountPaidCop);
  if (method === "cash") {
    if (amountPaidCop === 0n) {
      throw new DomainValidationError("Ingresa el efectivo recibido antes de registrar la venta.");
    }
    if (amountPaidCop < totalCop) {
      throw new DomainValidationError("El efectivo recibido no alcanza a cubrir el total.");
    }
  } else if (amountPaidCop !== totalCop) {
    throw new DomainValidationError("El valor pagado debe ser igual al total para este método.");
  }

  const transferMethod = method === "bank_transfer" || method === "nequi" || method === "daviplata" || method === "bre_b";
  const cardMethod = method === "debit_card" || method === "credit_card";
  const reference = normalizeOptionalReference(input.reference, "La referencia");
  const authorizationCode = normalizeOptionalReference(input.authorizationCode, "El código de autorización", 64);

  if (reference && !transferMethod) {
    throw new DomainValidationError("La referencia solo aplica a transferencias, Nequi, DaviPlata o Bre-B.");
  }
  if (authorizationCode && !cardMethod) {
    throw new DomainValidationError("El código de autorización solo aplica a pagos con tarjeta.");
  }
  if (authorizationCode && /^\d{3,4}$/.test(authorizationCode)) {
    throw new DomainValidationError("No ingreses CVV ni PIN como código de autorización.");
  }

  return {
    method,
    amountPaidCop,
    changeCop: method === "cash" ? amountPaidCop - totalCop : 0n,
    reference,
    authorizationCode
  };
}

export function normalizeCreditPayment(input: CreditPaymentDraft, balanceCop: bigint): NormalizedCreditPayment {
  if (!PAYMENT_METHOD_IDS.some((method) => method === input.method)) {
    throw new DomainValidationError("El método del abono no es válido.");
  }
  if (balanceCop <= 0n || balanceCop > MAX_SQLITE_INTEGER) {
    throw new DomainValidationError("El cliente no tiene un saldo pendiente para abonar.");
  }
  const amountCop = parseCopInteger(input.amountCop);
  if (amountCop === 0n) throw new DomainValidationError("El valor del abono debe ser mayor que cero.");
  if (amountCop > balanceCop) throw new DomainValidationError("El abono no puede superar el saldo pendiente.");

  const method = input.method as PaymentMethodId;
  const transferMethod = method === "bank_transfer" || method === "nequi" || method === "daviplata" || method === "bre_b";
  const cardMethod = method === "debit_card" || method === "credit_card";
  const reference = normalizeOptionalReference(input.reference, "La referencia");
  const authorizationCode = normalizeOptionalReference(input.authorizationCode, "El código de autorización", 64);
  if (reference && !transferMethod) {
    throw new DomainValidationError("La referencia solo aplica a transferencias, Nequi, DaviPlata o Bre-B.");
  }
  if (authorizationCode && !cardMethod) {
    throw new DomainValidationError("El código de autorización solo aplica a pagos con tarjeta.");
  }
  if (authorizationCode && /^\d{3,4}$/.test(authorizationCode)) {
    throw new DomainValidationError("No ingreses CVV ni PIN como código de autorización.");
  }
  return { amountCop, method, reference, authorizationCode };
}

function normalizeOptionalReference(value: string | undefined, label: string, maxLength = 120): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new DomainValidationError(`${label} no puede superar ${maxLength} caracteres.`);
  }
  if (/\b(?:cvv|cvc|pin|contrase(?:ñ|n)a|password|clave\s+(?:bancaria|de acceso|de ingreso))\b/i.test(normalized)) {
    throw new DomainValidationError(`${label} no puede contener claves, PIN ni datos de seguridad.`);
  }
  if (/\d{13,19}/.test(normalized.replace(/[\s-]/g, ""))) {
    throw new DomainValidationError(`${label} no puede contener un número de tarjeta.`);
  }
  return normalized;
}
