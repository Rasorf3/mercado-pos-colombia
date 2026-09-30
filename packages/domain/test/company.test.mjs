import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCompanyProfile } from "../dist/company.js";

const profile = {
  businessName: "  Mercado del Barrio  ", legalName: " ", nit: " 000900123456 ",
  verificationDigit: " 7 ", address: " Calle 10 ", city: " Bogotá ",
  department: " Cundinamarca ", phone: " 3001234567 ",
  secondaryPhone: null, email: " CONTACTO@EJEMPLO.CO "
};

test("normaliza el perfil sin perder ceros del NIT ni agregar datos fiscales", () => {
  assert.deepEqual(normalizeCompanyProfile(profile), {
    businessName: "Mercado del Barrio", legalName: null, nit: "000900123456",
    verificationDigit: "7", address: "Calle 10", city: "Bogotá",
    department: "Cundinamarca", phone: "3001234567",
    secondaryPhone: null, email: "contacto@ejemplo.co"
  });
});

test("rechaza nombre vacío, NIT arbitrario y DV sin NIT", () => {
  assert.throws(() => normalizeCompanyProfile({ ...profile, businessName: " " }), /nombre del comercio/);
  assert.throws(() => normalizeCompanyProfile({ ...profile, nit: "abc" }), /NIT solo/);
  assert.throws(() => normalizeCompanyProfile({ ...profile, nit: null }), /NIT antes/);
  assert.throws(() => normalizeCompanyProfile({ ...profile, email: "incorrecto" }), /correo electrónico/);
});
