import assert from "node:assert/strict";
import test from "node:test";
import {
  applyStockDelta,
  formatQuantityMilli,
  normalizeProductDraft,
  calculateStockWeight,
  parseCopInteger,
  parseQuantityDeltaMilli,
  parseQuantityMilli
} from "../dist/catalog.js";
import { activePromotionDiscount, formatBogotaDate } from "../dist/index.js";

test("las cantidades mantienen exactos hasta tres decimales", () => {
  assert.equal(parseQuantityMilli("12,305"), 12_305n);
  assert.equal(formatQuantityMilli(parseQuantityMilli("12.305")), "12.305");
  assert.equal(formatQuantityMilli(parseQuantityMilli("4.500")), "4.5");
  assert.equal(parseQuantityDeltaMilli("-0,125"), -125n);
  assert.throws(() => parseQuantityMilli("1.0001"), /máximo tres decimales/);
});

test("los valores COP se representan como enteros BigInt", () => {
  assert.equal(parseCopInteger("9007199254740993"), 9_007_199_254_740_993n);
  assert.equal(normalizeProductDraft({
    name: "  Arroz  ",
    internalCode: " A-01 ",
    barcode: " 000123 ",
    costCop: "3500",
    salePriceCop: "5000",
    unit: "kg"
  }).barcode, "000123");
});

test("el dominio rechaza cualquier movimiento que deje stock negativo", () => {
  assert.equal(applyStockDelta(1_000n, -250n), 750n);
  assert.throws(() => applyStockDelta(250n, -251n), /por debajo de cero/);
});

test("calcula el peso total de unidades empaquetadas con aritmética entera", () => {
  assert.equal(calculateStockWeight("4", "2.5", "lb"), "10 lb");
  assert.equal(calculateStockWeight("0.5", "1.125", "kg"), "0.563 kg");
  assert.equal(calculateStockWeight("4", null, null), null);
  assert.throws(() => normalizeProductDraft({
    name: "Arroz empacado", internalCode: "ARZ-LB", barcode: null,
    costCop: "100", salePriceCop: "200", unit: "kg", weightPerUnit: "2", weightUnit: "lb"
  }), /solo aplica a productos.*unidades/);
});

test("valida promociones de catálogo y respeta fechas inclusivas de Colombia", () => {
  const promotion = normalizeProductDraft({
    name: "Café",
    internalCode: "CAFE-PROMO",
    barcode: null,
    costCop: "500",
    salePriceCop: "2000",
    unit: "unit",
    promotion: { discount: { type: "percentage", value: "12.50" }, startsOn: "2026-09-28", endsOn: "2026-09-30" }
  }).promotion;
  assert.deepEqual(activePromotionDiscount(promotion, "2026-09-28"), { type: "percentage", value: 1250n });
  assert.deepEqual(activePromotionDiscount(promotion, "2026-09-30"), { type: "percentage", value: 1250n });
  assert.equal(activePromotionDiscount(promotion, "2026-10-01"), null);
  assert.equal(formatBogotaDate(new Date("2026-09-29T04:00:00.000Z")), "2026-09-28");
  assert.throws(() => normalizeProductDraft({
    name: "Café", internalCode: "CAFE-ERR", barcode: null, costCop: "500", salePriceCop: "2000", unit: "unit",
    promotion: { discount: { type: "fixed", valueCop: "2001" }, startsOn: "2026-09-28", endsOn: "2026-09-30" }
  }), /no puede superar el precio/);
  assert.throws(() => normalizeProductDraft({
    name: "Café", internalCode: "CAFE-DATE", barcode: null, costCop: "500", salePriceCop: "2000", unit: "unit",
    promotion: { discount: { type: "fixed", valueCop: "100" }, startsOn: "2026-02-30", endsOn: "2026-02-28" }
  }), /fecha inicial no es una fecha válida/);
});
