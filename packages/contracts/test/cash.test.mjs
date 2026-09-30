import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "@sinclair/typebox/value";
import { CashAvailabilitySchema, CashOverviewSchema, CloseCashSessionInputSchema, OpenCashSessionInputSchema } from "../dist/index.js";

test("los contratos de caja aceptan montos enteros y rechazan saldos inválidos", () => {
  assert.equal(Value.Check(OpenCashSessionInputSchema, { openingCashCop: "0" }), true);
  assert.equal(Value.Check(OpenCashSessionInputSchema, { openingCashCop: "001250" }), true);
  assert.equal(Value.Check(OpenCashSessionInputSchema, { openingCashCop: "1.5" }), false);
  assert.equal(Value.Check(OpenCashSessionInputSchema, { openingCashCop: "-1" }), false);
  assert.equal(Value.Check(OpenCashSessionInputSchema, { openingCashCop: "0", other: "field" }), false);
  assert.equal(Value.Check(CloseCashSessionInputSchema, { countedCashCop: "30000" }), true);
  assert.equal(Value.Check(CloseCashSessionInputSchema, { countedCashCop: "-1" }), false);
  assert.equal(Value.Check(CashAvailabilitySchema, { isOpen: false, openedAt: null, openedByUsername: null }), true);
});

test("el resumen registra el conteo, una diferencia firmada y totales por método", () => {
  const closed = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "closed",
    openingCashCop: "25000",
    openedAt: "2026-09-29T12:00:00.000Z",
    openedByUsername: "admin1",
    closedAt: "2026-09-29T20:00:00.000Z",
    closedByUsername: "jefe1",
    salesCount: 2,
    totalSalesCop: "45000",
    cashSalesCop: "30000",
    expectedCashCop: "55000",
    countedCashCop: "54900",
    varianceCashCop: "-100",
    paymentTotals: [
      { method: "cash", amountCop: "30000", salesCount: 1 },
      { method: "nequi", amountCop: "15000", salesCount: 1 }
    ]
  };
  assert.equal(Value.Check(CashOverviewSchema, { activeSession: null, recentSessions: [closed] }), true);
  assert.equal(Value.Check(CashOverviewSchema, { activeSession: null, recentSessions: [{ ...closed, varianceCashCop: "100 COP" }] }), false);
});
