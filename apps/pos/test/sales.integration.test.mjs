import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CatalogService } from "../src/main/catalog/catalogService.ts";
import { openPosDatabase } from "../src/main/database/database.ts";
import { SalesService } from "../src/main/sales/salesService.ts";

const testDirectory = mkdtempSync(join(tmpdir(), "mercado-pos-sales-"));
const database = openPosDatabase(join(testDirectory, "sales.sqlite"));
const catalog = new CatalogService(database);
const sales = new SalesService(database);

test.after(() => {
  database.close();
  rmSync(testDirectory, { recursive: true, force: true });
});

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
