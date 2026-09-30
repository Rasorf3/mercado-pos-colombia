import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "@sinclair/typebox/value";
import { CompanyProfileInputSchema } from "../dist/index.js";

const profile = {
  businessName: "Mercado del Barrio",
  legalName: null,
  nit: "000900123456",
  verificationDigit: "7",
  address: "Calle 10 # 20-30",
  city: "Bogotá",
  department: "Cundinamarca",
  phone: "3001234567",
  secondaryPhone: null,
  email: "contacto@ejemplo.co"
};

test("acepta el perfil local y rechaza datos fuera del contrato", () => {
  assert.equal(Value.Check(CompanyProfileInputSchema, profile), true);
  assert.equal(Value.Check(CompanyProfileInputSchema, { ...profile, verificationDigit: "12" }), false);
  assert.equal(Value.Check(CompanyProfileInputSchema, { ...profile, email: "inválido" }), false);
  assert.equal(Value.Check(CompanyProfileInputSchema, { ...profile, secret: "no" }), false);
  assert.equal(Value.Check(CompanyProfileInputSchema, { ...profile, businessName: "" }), false);
});
