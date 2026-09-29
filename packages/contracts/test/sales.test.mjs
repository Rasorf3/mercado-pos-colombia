import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "@sinclair/typebox/value";
import {
  PAYMENT_METHOD_OPTIONS,
  PaymentMethodSchema,
  SaleCreateSchema
} from "../dist/catalog.js";

test("TypeBox acepta los siete métodos estables y las referencias según el método", () => {
  assert.deepEqual(PAYMENT_METHOD_OPTIONS.map(({ id }) => id), [
    "cash", "debit_card", "credit_card", "bank_transfer", "nequi", "daviplata", "bre_b"
  ]);
  for (const { id } of PAYMENT_METHOD_OPTIONS) {
    assert.equal(Value.Check(PaymentMethodSchema, id), true);
    assert.equal(Value.Check(SaleCreateSchema, {
      items: [{ productId: "550e8400-e29b-41d4-a716-446655440000", quantity: "1.125" }],
      payment: { method: id, amountPaidCop: "1250" }
    }), true);
  }

  assert.equal(Value.Check(SaleCreateSchema, {
    items: [{ productId: "550e8400-e29b-41d4-a716-446655440000", quantity: "1" }],
    payment: { method: "nequi", amountPaidCop: "1000", reference: "NEQ-01" }
  }), true);
  assert.equal(Value.Check(SaleCreateSchema, {
    items: [{ productId: "550e8400-e29b-41d4-a716-446655440000", quantity: "1" }],
    payment: { method: "debit_card", amountPaidCop: "1000", authorizationCode: "AUTH01" }
  }), true);
});

test("el contrato rechaza métodos desconocidos y datos sensibles de tarjeta", () => {
  const base = {
    items: [{ productId: "550e8400-e29b-41d4-a716-446655440000", quantity: "1" }],
    payment: { method: "cash", amountPaidCop: "1000" }
  };
  assert.equal(Value.Check(SaleCreateSchema, { ...base, payment: { ...base.payment, method: "crypto" } }), false);
  assert.equal(Value.Check(SaleCreateSchema, { ...base, payment: { ...base.payment, cardNumber: "4111111111111111" } }), false);
  assert.equal(Value.Check(SaleCreateSchema, { ...base, payment: { ...base.payment, cvv: "123" } }), false);
  assert.equal(Value.Check(SaleCreateSchema, { ...base, payment: { ...base.payment, pin: "1234" } }), false);
});
