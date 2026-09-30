import type { CompanyProfileInput } from "@mercado-pos/contracts";

export function normalizeCompanyProfile(input: CompanyProfileInput): CompanyProfileInput {
  const businessName = input.businessName.trim();
  const legalName = optional(input.legalName);
  const nit = optional(input.nit);
  const verificationDigit = optional(input.verificationDigit);
  const address = optional(input.address);
  const city = optional(input.city);
  const department = optional(input.department);
  const phone = optional(input.phone);
  const secondaryPhone = optional(input.secondaryPhone);
  const email = optional(input.email)?.toLocaleLowerCase("es-CO") ?? null;

  if (!businessName || businessName.length > 120) {
    throw new Error("El nombre del comercio debe tener entre 1 y 120 caracteres.");
  }
  if (legalName && legalName.length > 160) throw new Error("La razón social no puede superar 160 caracteres.");
  if (nit && (nit.length > 32 || !/^[0-9.\-\s]+$/.test(nit))) {
    throw new Error("El NIT solo puede contener dígitos, puntos, espacios o guiones.");
  }
  if (verificationDigit && !/^[0-9]$/.test(verificationDigit)) {
    throw new Error("El dígito de verificación debe ser un solo número.");
  }
  if (verificationDigit && !nit) throw new Error("Ingresa el NIT antes del dígito de verificación.");
  if (address && address.length > 240) throw new Error("La dirección no puede superar 240 caracteres.");
  if (city && city.length > 100) throw new Error("La ciudad o municipio no puede superar 100 caracteres.");
  if (department && department.length > 100) throw new Error("El departamento no puede superar 100 caracteres.");
  if (phone && phone.length > 32) throw new Error("El teléfono principal no puede superar 32 caracteres.");
  if (secondaryPhone && secondaryPhone.length > 32) throw new Error("El teléfono secundario no puede superar 32 caracteres.");
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error("Ingresa un correo electrónico válido para el comercio.");
  }

  return { businessName, legalName, nit, verificationDigit, address, city, department, phone, secondaryPhone, email };
}

function optional(value: string | null): string | null {
  return value?.trim() || null;
}
