import assert from "node:assert/strict";
import test from "node:test";
import {
  PAYMENT_METHOD_IDS,
  addSaleQuantity,
  calculateSaleAmounts,
  combineSaleQuantities,
  normalizeSalePayment
} from "../dist/sales.js";

test("métodos de pago tienen identificadores estables y se validan", () => {
  assert.deepEqual(PAYMENT_METHOD_IDS, [
    "cash", "debit_card", "credit_card", "bank_transfer", "nequi", "daviplata", "bre_b"
  ]);

  for (const method of PAYMENT_METHOD_IDS) {
    const reference = ["bank_transfer", "nequi", "daviplata", "bre_b"].includes(method) ? "REF-123" : undefined;
    const authorizationCode = ["debit_card", "credit_card"].includes(method) ? "AUTH123" : undefined;
    const payment = normalizeSalePayment({ method, amountPaidCop: "1000", reference, authorizationCode }, 1000n);
    assert.equal(payment.method, method);
    assert.equal(payment.changeCop, 0n);
  }

  assert.equal(normalizeSalePayment({ method: "cash", amountPaidCop: "1500" }, 1000n).changeCop, 500n);
  assert.throws(() => normalizeSalePayment({ method: "unknown", amountPaidCop: "1000" }, 1000n), /no es válido/);
  assert.throws(() => normalizeSalePayment({ method: "cash", amountPaidCop: "999" }, 1000n), /no alcanza/);
  assert.throws(() => normalizeSalePayment({ method: "nequi", amountPaidCop: "1001" }, 1000n), /igual al total/);
  assert.throws(() => normalizeSalePayment({ method: "cash", amountPaidCop: "1000", reference: "ref" }, 1000n), /solo aplica/);
  assert.throws(() => normalizeSalePayment({ method: "credit_card", amountPaidCop: "1000", authorizationCode: "123" }, 1000n), /CVV ni PIN/);
  assert.throws(() => normalizeSalePayment({ method: "bank_transfer", amountPaidCop: "1000", reference: "4111111111111111" }, 1000n), /número de tarjeta/);
});

test("totales COP son exactos y redondean cada línea half-up al peso", () => {
  const amounts = calculateSaleAmounts([
    { quantity: "0.5", unitPriceCop: "1" },
    { quantity: "0.5", unitPriceCop: "3" },
    { quantity: "1.250", unitPriceCop: "9007199254740993" }
  ]);
  assert.deepEqual(amounts.lineTotalsCop, [1n, 2n, 11_258_999_068_426_241n]);
  assert.equal(amounts.totalCop, 11_258_999_068_426_244n);
  assert.throws(() => calculateSaleAmounts([{ quantity: "0", unitPriceCop: "100" }]), /mayor que cero/);
});

test("las cantidades repetidas se combinan sin aritmética de punto flotante", () => {
  assert.equal(addSaleQuantity("0.125", "0.875"), "1");
  assert.deepEqual(combineSaleQuantities([
    { productId: "p1", quantity: "0.125" },
    { productId: "p2", quantity: "1" },
    { productId: "p1", quantity: "0.875" }
  ]), [
    { productId: "p1", quantityMilli: 1000n },
    { productId: "p2", quantityMilli: 1000n }
  ]);
});
