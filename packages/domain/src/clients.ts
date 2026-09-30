import type { ClientCreateInput, ClientUpdateInput } from "@mercado-pos/contracts";
import { DEFAULT_CLIENT_CREDIT_LIMIT_COP } from "@mercado-pos/contracts";
import { MAX_SQLITE_INTEGER, parseCopInteger } from "./catalog.js";

export interface NormalizedClientDraft {
  name: string;
  documentType: string | null;
  documentNumber: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  creditLimitCop: string;
}

export function normalizeClientDraft(input: ClientCreateInput | ClientUpdateInput): NormalizedClientDraft {
  const name = input.name.trim();
  const documentType = normalizeOptional(input.documentType)?.toLocaleUpperCase("es-CO") ?? null;
  const documentNumber = normalizeOptional(input.documentNumber)?.toLocaleUpperCase("es-CO") ?? null;
  const email = normalizeOptional(input.email)?.toLocaleLowerCase("es-CO") ?? null;
  const phone = normalizeOptional(input.phone) ?? null;
  const address = normalizeOptional(input.address) ?? null;
  const creditLimitCop = input.creditLimitCop ?? DEFAULT_CLIENT_CREDIT_LIMIT_COP;

  if (!name || name.length > 120) {
    throw new Error("El nombre del cliente debe tener entre 1 y 120 caracteres.");
  }
  if ((documentType === null) !== (documentNumber === null)) {
    throw new Error("Completa tanto el tipo como el número de identificación, o deja ambos vacíos.");
  }
  if (documentType && documentType.length > 32) {
    throw new Error("El tipo de identificación no puede superar 32 caracteres.");
  }
  if (documentNumber && documentNumber.length > 64) {
    throw new Error("El número de identificación no puede superar 64 caracteres.");
  }
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error("Ingresa un correo electrónico válido.");
  }
  if (phone && phone.length > 32) throw new Error("El teléfono no puede superar 32 caracteres.");
  if (address && address.length > 240) throw new Error("La dirección no puede superar 240 caracteres.");
  const parsedCreditLimit = parseCopInteger(creditLimitCop);
  if (parsedCreditLimit > MAX_SQLITE_INTEGER) throw new Error("El límite de fiado supera el máximo permitido.");

  return { name, documentType, documentNumber, email, phone, address, creditLimitCop: parsedCreditLimit.toString() };
}

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}
