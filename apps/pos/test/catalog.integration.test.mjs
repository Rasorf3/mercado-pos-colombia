import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CatalogService, DuplicateBarcodeError } from "../src/main/catalog/catalogService.ts";
import { openPosDatabase } from "../src/main/database/database.ts";

const testDirectory = mkdtempSync(join(tmpdir(), "mercado-pos-catalog-"));
const databasePath = join(testDirectory, "catalog.sqlite");
let database = openPosDatabase(databasePath);
let catalog = new CatalogService(database);

test.after(() => {
  database.close();
  rmSync(testDirectory, { recursive: true, force: true });
});

test("el catálogo y sus valores exactos persisten al reabrir SQLite", () => {
  const product = catalog.createProduct({
    name: "Arroz",
    internalCode: "ARR-01",
    barcode: "0001234567890",
    costCop: "9007199254740993",
    salePriceCop: "9007199254741993",
    unit: "kg",
    initialStock: "12,375"
  });

  assert.equal(product.barcode, "0001234567890");
  assert.equal(product.costCop, "9007199254740993");
  assert.equal(product.stock, "12.375");

  database.close();
  database = openPosDatabase(databasePath);
  catalog = new CatalogService(database);
  assert.deepEqual(catalog.listProducts({ query: "0001234567890", includeInactive: false })[0], product);
  assert.equal(catalog.listMovements(product.id)[0].type, "initial");
});

test("rechaza códigos de barras duplicados al crear y editar", () => {
  const existing = catalog.listProducts({ query: "0001234567890", includeInactive: false })[0];
  const another = catalog.createProduct({
    name: "Lentejas",
    internalCode: "LEN-01",
    barcode: null,
    costCop: "1000",
    salePriceCop: "1500",
    unit: "kg",
    initialStock: "0"
  });

  assert.throws(() => catalog.createProduct({
    name: "Duplicado",
    internalCode: "DUP-01",
    barcode: "0001234567890",
    costCop: "1",
    salePriceCop: "2",
    unit: "unit",
    initialStock: "0"
  }), DuplicateBarcodeError);

  assert.throws(() => catalog.updateProduct(another.id, {
    name: another.name,
    internalCode: another.internalCode,
    barcode: existing.barcode,
    costCop: another.costCop,
    salePriceCop: another.salePriceCop,
    unit: another.unit,
    active: true
  }), DuplicateBarcodeError);
  assert.equal(catalog.listProducts({ query: "", includeInactive: false }).length, 2);
});

test("cada entrada y ajuste actualiza stock y deja movimiento, sin permitir negativos", () => {
  const product = catalog.listProducts({ query: "LEN-01", includeInactive: false })[0];
  catalog.recordEntry({ productId: product.id, quantity: "2,125", note: "Reposición" });
  catalog.recordAdjustment({ productId: product.id, delta: "-0.125", note: "Conteo físico" });

  let updated = catalog.listProducts({ query: "LEN-01", includeInactive: false })[0];
  let movements = catalog.listMovements(product.id);
  assert.equal(updated.stock, "2");
  assert.deepEqual(movements.slice(0, 2).map(({ type, quantity, stockBefore, stockAfter }) => ({ type, quantity, stockBefore, stockAfter })), [
    { type: "adjustment", quantity: "-0.125", stockBefore: "2.125", stockAfter: "2" },
    { type: "entry", quantity: "2.125", stockBefore: "0", stockAfter: "2.125" }
  ]);

  assert.throws(() => catalog.recordAdjustment({ productId: product.id, delta: "-2.001", note: "Prueba de límite" }), /por debajo de cero/);
  updated = catalog.listProducts({ query: "LEN-01", includeInactive: false })[0];
  assert.equal(updated.stock, "2");
  assert.equal(catalog.listMovements(product.id).length, 3);

  database.exec(`
    CREATE TRIGGER fail_test_entry BEFORE INSERT ON inventory_movements
    WHEN NEW.type = 'entry' AND NEW.note = 'fallo forzado'
    BEGIN SELECT RAISE(ABORT, 'fallo forzado'); END;
  `);
  assert.throws(() => catalog.recordEntry({ productId: product.id, quantity: "1", note: "fallo forzado" }), /fallo forzado/);
  assert.equal(catalog.listProducts({ query: "LEN-01", includeInactive: false })[0].stock, "2");
  assert.equal(catalog.listMovements(product.id).length, 3);
});

test("permite editar y desactivar sin borrar el historial ni el producto", () => {
  const product = catalog.listProducts({ query: "LEN-01", includeInactive: false })[0];
  const deactivated = catalog.updateProduct(product.id, {
    name: "Lenteja roja",
    internalCode: "LEN-01",
    barcode: null,
    costCop: "1100",
    salePriceCop: "1700",
    unit: "kg",
    active: false
  });

  assert.equal(deactivated.name, "Lenteja roja");
  assert.equal(deactivated.active, false);
  assert.equal(catalog.listProducts({ query: "Lenteja roja", includeInactive: false }).length, 0);
  assert.equal(catalog.listProducts({ query: "Lenteja roja", includeInactive: true })[0].id, product.id);
  assert.equal(catalog.listMovements(product.id).length, 3);

  const reactivated = catalog.updateProduct(product.id, {
    name: "Lenteja roja",
    internalCode: "LEN-01",
    barcode: null,
    costCop: "1100",
    salePriceCop: "1700",
    unit: "kg",
    active: true
  });
  assert.equal(reactivated.active, true);
});

test("persiste la equivalencia de peso opcional por empaque y admite libras", () => {
  const packaged = catalog.createProduct({
    name: "Café bolsa", internalCode: "CAF-LB", barcode: null,
    costCop: "1000", salePriceCop: "1500", unit: "unit",
    initialStock: "4", weightPerUnit: "2.5", weightUnit: "lb"
  });
  assert.equal(packaged.stock, "4");
  assert.equal(packaged.weightPerUnit, "2.5");
  assert.equal(packaged.weightUnit, "lb");
  assert.equal(catalog.listProducts({ query: "CAF-LB", includeInactive: false })[0].weightUnit, "lb");
  assert.throws(() => catalog.createProduct({
    name: "Invalido", internalCode: "CAF-BAD", barcode: null,
    costCop: "1000", salePriceCop: "1500", unit: "kg",
    initialStock: "4", weightPerUnit: "2.5", weightUnit: "lb"
  }), /solo aplica a productos.*unidades/);
});
