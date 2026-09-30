import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CatalogService } from "../src/main/catalog/catalogService.ts";
import { CashService } from "../src/main/cash/cashService.ts";
import { openPosDatabase } from "../src/main/database/database.ts";
import { SalesService } from "../src/main/sales/salesService.ts";

const testDirectory = mkdtempSync(join(tmpdir(), "mercado-pos-sales-"));
const database = openPosDatabase(join(testDirectory, "sales.sqlite"));
const catalog = new CatalogService(database);
const sales = new SalesService(database);
seedOpenCashSession(database);

test.after(() => {
  database.close();
  rmSync(testDirectory, { recursive: true, force: true });
});

function seedOpenCashSession(database) {
  const id = "00000000-0000-4000-8000-000000000007";
  const now = "2026-01-01T00:00:00.000Z";
  database.prepare(`
    INSERT INTO pos_users (id, username, password_salt, password_hash, role, active, created_at, updated_at)
    VALUES (?, 'testcash', ?, ?, 'admin', 1, ?, ?)
  `).run(id, "a".repeat(32), "b".repeat(128), now, now);
  new CashService(database).openSession({ openingCashCop: "0" }, id);
}

test("registra los siete métodos, montos y datos opcionales sin procesar el pago", () => {
  const methods = [
    "cash", "debit_card", "credit_card", "bank_transfer", "nequi", "daviplata", "bre_b"
  ];

  for (const method of methods) {
    const product = catalog.createProduct({
      name: `Producto ${method}`,
      internalCode: `SKU-${method}`,
      barcode: null,
      costCop: "500",
      salePriceCop: "1250",
      unit: "unit",
      initialStock: "10"
    });
    const transfer = ["bank_transfer", "nequi", "daviplata", "bre_b"].includes(method);
    const card = ["debit_card", "credit_card"].includes(method);
    const sale = sales.createSale({
      items: [{ productId: product.id, quantity: "1.125" }],
      payment: {
        method,
        amountPaidCop: method === "cash" ? "1500" : "1406",
        ...(transfer ? { reference: `REF-${method}` } : {}),
        ...(card ? { authorizationCode: `AUTH-${method}` } : {})
      }
    });

    assert.equal(sale.status, "local_pending_invoice");
    assert.equal(sale.totalCop, "1406");
    assert.equal(sale.items.length, 1);
    assert.deepEqual(sale.items[0], {
      productId: product.id,
      productName: `Producto ${method}`,
      unit: "unit",
      quantity: "1.125",
      unitPriceCop: "1250",
      discount: null,
      discountTotalCop: "0",
      lineTotalCop: "1406"
    });
    assert.equal(sale.payment.method, method);
    assert.equal(sale.payment.amountPaidCop, method === "cash" ? "1500" : "1406");
    assert.equal(sale.payment.changeCop, method === "cash" ? "94" : "0");
    assert.equal(sale.payment.reference, transfer ? `REF-${method}` : null);
    assert.equal(sale.payment.authorizationCode, card ? `AUTH-${method}` : null);
    assert.equal(catalog.listProducts({ query: `SKU-${method}`, includeInactive: false })[0].stock, "8.875");
    const movement = catalog.listMovements(product.id)[0];
    assert.equal(movement.type, "sale_out");
    assert.equal(movement.saleId, sale.id);
    assert.equal(movement.quantity, "-1.125");
  }

  const history = sales.listRecentSales();
  assert.equal(history.length, methods.length);
  assert.deepEqual(new Set(history.map((sale) => sale.payment.method)), new Set(methods));
});

test("aplica promociones activas y guarda el descuento efectivo como instantánea de venta", () => {
  const todayParts = new Intl.DateTimeFormat("en", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const todayFields = new Map(todayParts.map(({ type, value }) => [type, value]));
  const today = `${todayFields.get("year")}-${todayFields.get("month")}-${todayFields.get("day")}`;
  const product = catalog.createProduct({
    name: "Producto promoción", internalCode: "SALE-PROMO", barcode: null,
    costCop: "500", salePriceCop: "1000", unit: "unit", initialStock: "10",
    promotion: { discount: { type: "percentage", value: "10" }, startsOn: today, endsOn: today }
  });
  assert.deepEqual(catalog.listProductsForSale("SALE-PROMO")[0].activePromotion, { type: "percentage", value: "10" });

  const automatic = sales.createSale({
    items: [{ productId: product.id, quantity: "3" }],
    payment: { method: "cash", amountPaidCop: "2700" }
  });
  assert.equal(automatic.totalCop, "2700");
  assert.deepEqual(automatic.items[0], {
    productId: product.id, productName: product.name, unit: "unit", quantity: "3",
    unitPriceCop: "1000", discount: { type: "percentage", value: "10" },
    discountTotalCop: "300", lineTotalCop: "2700"
  });

  const manual = sales.createSale({
    items: [{ productId: product.id, quantity: "2.5", discount: { type: "fixed", valueCop: "125" } }],
    payment: { method: "cash", amountPaidCop: "2187" }
  });
  assert.equal(manual.totalCop, "2187");
  assert.equal(manual.items[0].discountTotalCop, "313");
  assert.deepEqual(manual.items[0].discount, { type: "fixed", valueCop: "125" });
  const saleCount = database.prepare("SELECT count(*) AS count FROM sales").get().count;
  assert.throws(() => sales.createSale({
    items: [{ productId: product.id, quantity: "1", discount: { type: "fixed", valueCop: "1001" } }],
    payment: { method: "cash", amountPaidCop: "0" }
  }), /no puede superar el precio/);
  assert.equal(database.prepare("SELECT count(*) AS count FROM sales").get().count, saleCount);

  const edited = catalog.updateProduct(product.id, {
    name: "Producto cambiado", internalCode: product.internalCode, barcode: null,
    costCop: "600", salePriceCop: "2000", unit: "unit", active: true, promotion: null
  });
  assert.equal(edited.promotion, null);
  assert.deepEqual(sales.getSale(automatic.id).items[0], automatic.items[0]);
  assert.deepEqual(sales.getSale(manual.id).items[0], manual.items[0]);
});

test("revierte venta, pago, líneas, movimientos y stock si falla al registrar el movimiento", () => {
  const product = catalog.createProduct({
    name: "Producto de prueba de rollback",
    internalCode: "ROLLBACK-01",
    barcode: null,
    costCop: "700",
    salePriceCop: "1000",
    unit: "kg",
    initialStock: "5"
  });
  const before = {
    sales: database.prepare("SELECT count(*) AS count FROM sales").get().count,
    items: database.prepare("SELECT count(*) AS count FROM sale_items").get().count,
    payments: database.prepare("SELECT count(*) AS count FROM sale_payments").get().count,
    buyerSnapshots: database.prepare("SELECT count(*) AS count FROM sale_buyer_snapshots").get().count,
    movements: database.prepare("SELECT count(*) AS count FROM inventory_movements").get().count,
    stock: catalog.listProducts({ query: "ROLLBACK-01", includeInactive: false })[0].stock
  };

  database.exec(`
    CREATE TRIGGER fail_one_sale_movement BEFORE INSERT ON inventory_movements
    WHEN NEW.type = 'sale_out' AND NEW.product_id = '${product.id}'
    BEGIN SELECT RAISE(ABORT, 'forced movement failure'); END;
  `);
  assert.throws(() => sales.createSale({
    items: [{ productId: product.id, quantity: "2" }],
    payment: { method: "cash", amountPaidCop: "2000" }
  }), /forced movement failure/);

  assert.equal(database.prepare("SELECT count(*) AS count FROM sales").get().count, before.sales);
  assert.equal(database.prepare("SELECT count(*) AS count FROM sale_items").get().count, before.items);
  assert.equal(database.prepare("SELECT count(*) AS count FROM sale_payments").get().count, before.payments);
  assert.equal(database.prepare("SELECT count(*) AS count FROM sale_buyer_snapshots").get().count, before.buyerSnapshots);
  assert.equal(database.prepare("SELECT count(*) AS count FROM inventory_movements").get().count, before.movements);
  assert.equal(catalog.listProducts({ query: "ROLLBACK-01", includeInactive: false })[0].stock, before.stock);

  database.exec("DROP TRIGGER fail_one_sale_movement");
  const saved = sales.createSale({
    items: [
      { productId: product.id, quantity: "0.125" },
      { productId: product.id, quantity: "1.875" }
    ],
    payment: { method: "bank_transfer", amountPaidCop: "2000", reference: "TRF-ROLLBACK-OK" }
  });
  assert.equal(saved.items.length, 1);
  assert.equal(saved.items[0].quantity, "2");
  assert.equal(saved.totalCop, "2000");
  assert.equal(catalog.listProducts({ query: "ROLLBACK-01", includeInactive: false })[0].stock, "3");
});

test("rechaza método, valor y stock inválidos sin crear una venta parcial", () => {
  const product = catalog.createProduct({
    name: "Producto de validación",
    internalCode: "PAYMENT-VALIDATION",
    barcode: null,
    costCop: "100",
    salePriceCop: "1000",
    unit: "unit",
    initialStock: "1"
  });
  const countBefore = database.prepare("SELECT count(*) AS count FROM sales").get().count;

  assert.throws(() => sales.createSale({
    items: [{ productId: product.id, quantity: "1" }],
    payment: { method: "cash", amountPaidCop: "999" }
  }), /no alcanza/);
  assert.throws(() => sales.createSale({
    items: [{ productId: product.id, quantity: "1" }],
    payment: { method: "cash", amountPaidCop: "0" }
  }), /Ingresa el efectivo recibido/);
  assert.throws(() => sales.createSale({
    items: [{ productId: product.id, quantity: "1" }],
    payment: { method: "credit_card", amountPaidCop: "1001" }
  }), /igual al total/);
  assert.throws(() => sales.createSale({
    items: [{ productId: product.id, quantity: "1.001" }],
    payment: { method: "cash", amountPaidCop: "2000" }
  }), /insuficiente/);
  assert.throws(() => sales.createSale({
    items: [{ productId: product.id, quantity: "1" }],
    payment: { method: "cash", amountPaidCop: "1000", reference: "No aplica" }
  }), /solo aplica/);

  assert.equal(database.prepare("SELECT count(*) AS count FROM sales").get().count, countBefore);
  assert.equal(catalog.listProducts({ query: "PAYMENT-VALIDATION", includeInactive: false })[0].stock, "1");
});
