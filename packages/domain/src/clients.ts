import type { ClientCreateInput, ClientUpdateInput } from "@mercado-pos/contracts";

export interface NormalizedClientDraft {
  name: string;
  documentType: string | null;
  documentNumber: string | null;
  email: string | null;
}

export function normalizeClientDraft(input: ClientCreateInput | ClientUpdateInput): NormalizedClientDraft {
  const name = input.name.trim();
  const documentType = normalizeOptional(input.documentType)?.toLocaleUpperCase("es-CO") ?? null;
  const documentNumber = normalizeOptional(input.documentNumber)?.toLocaleUpperCase("es-CO") ?? null;
  const email = normalizeOptional(input.email)?.toLocaleLowerCase("es-CO") ?? null;

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

  return { name, documentType, documentNumber, email };
}

function normalizeOptional(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}
