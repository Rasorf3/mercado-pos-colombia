import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CatalogService } from "../src/main/catalog/catalogService.ts";
import { ClientsService } from "../src/main/clients/clientsService.ts";
import { openPosDatabase } from "../src/main/database/database.ts";
import { SalesService } from "../src/main/sales/salesService.ts";

const directory = mkdtempSync(join(tmpdir(), "mercado-pos-clients-"));
let database = openPosDatabase(join(directory, "clients.sqlite"));

test.after(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

test("persiste, busca, edita y desactiva perfiles; la venta conserva la instantánea del comprador", () => {
  let clients = new ClientsService(database);
  const created = clients.create({
    name: "  Mercado La 14 ",
    documentType: " cc ",
    documentNumber: " 001234 ",
    email: "  COMPRAS@EJEMPLO.CO "
  });
  assert.equal(created.name, "Mercado La 14");
  assert.equal(created.documentType, "CC");
  assert.equal(created.documentNumber, "001234");
  assert.equal(created.email, "compras@ejemplo.co");
  assert.equal(clients.list({ query: "0012", includeInactive: false })[0].id, created.id);
  assert.throws(() => clients.create({
    name: "Duplicado",
    documentType: "cc",
    documentNumber: "001234",
    email: null
  }), /Ya existe un cliente/);

  const catalog = new CatalogService(database);
  const product = catalog.createProduct({
    name: "Producto para venta a cliente",
    internalCode: "CLIENT-SALE-01",
    barcode: null,
    costCop: "300",
    salePriceCop: "1000",
    unit: "unit",
    initialStock: "3"
  });
  const sales = new SalesService(database);
  const sale = sales.createSale({
    clientId: created.id,
    items: [{ productId: product.id, quantity: "1" }],
    payment: { method: "cash", amountPaidCop: "1000" }
  });
  assert.deepEqual(sale.buyer, {
    clientId: created.id,
    name: "Mercado La 14",
    documentType: "CC",
    documentNumber: "001234",
    email: "compras@ejemplo.co"
  });

  clients.update(created.id, {
    name: "Mercado La 14 actualizado",
    documentType: "NIT",
    documentNumber: "900123456-7",
    email: "nueva@ejemplo.co",
    active: false
  });
  assert.equal(clients.list({ query: "", includeInactive: false }).length, 0);
  assert.equal(clients.list({ query: "actualizado", includeInactive: true })[0].active, false);
  assert.deepEqual(sales.listRecentSales()[0].buyer, sale.buyer);
  assert.throws(() => database.prepare(`
    UPDATE sale_buyer_snapshots SET buyer_name = 'No permitido' WHERE sale_id = ?
  `).run(sale.id), /sale buyer snapshot is immutable/);

  const noBuyerSale = sales.createSale({
    items: [{ productId: product.id, quantity: "1" }],
    payment: { method: "cash", amountPaidCop: "1000" }
  });
  assert.equal(noBuyerSale.buyer, null);

  database.close();
  database = openPosDatabase(join(directory, "clients.sqlite"));
  clients = new ClientsService(database);
  assert.equal(clients.list({ query: "001234", includeInactive: true })[0].name, "Mercado La 14 actualizado");
  assert.deepEqual(new SalesService(database).listRecentSales()[1].buyer, sale.buyer);
});
