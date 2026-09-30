import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "@sinclair/typebox/value";
import { ClientCreateSchema, ClientSearchSchema, ClientUpdateSchema, CreditPaymentInputSchema, SaleCreateSchema } from "../dist/index.js";

const client = {
  name: "Cliente de prueba",
  documentType: "CC",
  documentNumber: "001234",
  email: "cliente@example.co"
};

test("valida contratos de clientes, correo y búsqueda", () => {
  assert.equal(Value.Check(ClientCreateSchema, client), true);
  assert.equal(Value.Check(ClientCreateSchema, { ...client, email: "correo-inválido" }), false);
  assert.equal(Value.Check(ClientUpdateSchema, { ...client, active: false }), true);
  assert.equal(Value.Check(ClientSearchSchema, { query: "cliente", includeInactive: true }), true);
  assert.equal(Value.Check(ClientCreateSchema, { ...client, phone: "3001234567", address: "Calle 1" }), true);
  assert.equal(Value.Check(ClientCreateSchema, { ...client, creditLimitCop: "300000" }), true);
  assert.equal(Value.Check(ClientCreateSchema, { ...client, creditLimitCop: "300.000" }), false);
  assert.equal(Value.Check(CreditPaymentInputSchema, {
    clientId: "550e8400-e29b-41d4-a716-446655440001", amountCop: "1000", method: "cash"
  }), true);
});

test("permite asociar una venta a un cliente UUID válido o dejarla sin comprador", () => {
  const base = {
    items: [{ productId: "550e8400-e29b-41d4-a716-446655440000", quantity: "1" }],
    payment: { method: "cash", amountPaidCop: "1000" }
  };
  assert.equal(Value.Check(SaleCreateSchema, base), true);
  assert.equal(Value.Check(SaleCreateSchema, {
    ...base,
    clientId: "550e8400-e29b-41d4-a716-446655440001"
  }), true);
  assert.equal(Value.Check(SaleCreateSchema, { ...base, clientId: "bad-id" }), false);
  assert.equal(Value.Check(SaleCreateSchema, {
    ...base, settlement: "on_account", clientId: "550e8400-e29b-41d4-a716-446655440001"
  }), true);
  assert.equal(Value.Check(SaleCreateSchema, {
    items: base.items, settlement: "on_account", clientId: "550e8400-e29b-41d4-a716-446655440001"
  }), true);
});
