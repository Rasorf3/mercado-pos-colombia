import assert from "node:assert/strict";
import test from "node:test";
import { openPosDatabase } from "../src/main/database/database.ts";
import { AuthService } from "../src/main/auth/authService.ts";
import { CatalogService } from "../src/main/catalog/catalogService.ts";
import { ClientsService } from "../src/main/clients/clientsService.ts";
import { SalesService } from "../src/main/sales/salesService.ts";
import { CashService } from "../src/main/cash/cashService.ts";

test("bootstrap, login y permisos guardan hashes y revocan usuarios desactivados", async (context) => {
  const database = openPosDatabase(":memory:");
  context.after(() => database.close());
  const auth = new AuthService(database);

  assert.equal(auth.state(1).needsBootstrap, true);
  await assert.rejects(auth.bootstrapAdmin({ username: "admin1", password: "1234" }, 9), /entre 5 y 128/);
  const admin = await auth.bootstrapAdmin({ username: "TiendaAdmin", password: "Una clave robusta 2026!" }, 1);
  assert.equal(admin.role, "admin");
  assert.equal(auth.state(1).needsBootstrap, false);
  assert.equal(auth.state(1).user?.id, admin.id);

  const stored = database.prepare("SELECT password_salt, password_hash FROM pos_users WHERE id = ?").get(admin.id);
  assert.notEqual(stored.password_hash, "Una clave robusta 2026!");
  assert.equal(stored.password_hash.length, 128);
  assert.equal(stored.password_salt.length, 32);
  await assert.rejects(auth.bootstrapAdmin({ username: "another", password: "Otra clave segura 2026!" }, 2), /ya tiene usuarios/i);
  await assert.rejects(auth.createUser({ username: "corto1", password: "1234", role: "employee" }), /entre 5 y 128/);
  const fiveCharacterPasswordUser = await auth.createUser({ username: "corto2", password: "abcde", role: "employee" });
  assert.equal(fiveCharacterPasswordUser.username, "corto2");

  const employee = await auth.createUser({ username: "cajero1", password: "Clave del cajero 2026!", role: "employee" });
  assert.equal(employee.role, "employee");
  const manager = await auth.createUser({ username: "jefe1", password: "Clave del jefe 2026!", role: "employee_manager" });
  assert.equal(manager.role, "employee_manager");
  await assert.rejects(auth.createUser({ username: "master1", password: "Clave del master 2026!", role: "admin_master" }), /Solo se pueden crear/i);

  await auth.login({ username: "TIENDAADMIN", password: "Una clave robusta 2026!" }, 3);
  await auth.login({ username: "cajero1", password: "Clave del cajero 2026!" }, 4);
  assert.equal(auth.requireCapability(4, "sales:create").id, employee.id);
  assert.throws(() => auth.requireCapability(4, "sales:history"), /No tienes permiso/i);
  assert.throws(() => auth.requireCapability(4, "catalog:manage"), /No tienes permiso/i);
  assert.equal(auth.requireCapability(3, "users:manage").id, admin.id);
  assert.throws(() => auth.requireCapability(4, "inventory:manage"), /No tienes permiso/i);
  await auth.login({ username: "jefe1", password: "Clave del jefe 2026!" }, 6);
  assert.equal(auth.requireCapability(6, "inventory:manage").id, manager.id);
  assert.equal(auth.requireCapability(6, "sales:create").id, manager.id);
  assert.equal(auth.requireCapability(6, "catalog:sale-read").id, manager.id);
  assert.equal(auth.requireCapability(6, "clients:lookup-for-sale").id, manager.id);
  assert.throws(() => auth.requireCapability(6, "users:manage"), /No tienes permiso/i);
  await assert.rejects(auth.login({ username: "cajero1", password: "incorrecta" }, 5), /Usuario o contraseña/i);

  const catalog = new CatalogService(database);
  const product = catalog.createProduct({
    name: "Producto de caja", internalCode: "CAJA-01", barcode: null,
    costCop: "500", salePriceCop: "1000", unit: "unit", initialStock: "3"
  }, admin.id);
  assert.equal(product.createdByUsername, admin.username);
  assert.equal(catalog.listMovements(product.id)[0].createdByUsername, admin.username);
  const stockMovement = catalog.recordEntry({ productId: product.id, quantity: "1", note: "Reposición" }, manager.id);
  assert.equal(stockMovement.createdByUsername, manager.username);
  assert.equal(catalog.listMovements(product.id)[0].createdByUsername, manager.username);
  assert.equal(catalog.listProductsForSale("CAJA-01")[0].costCop, undefined);
  const clients = new ClientsService(database);
  new CashService(database).openSession({ openingCashCop: "0" }, admin.id);
  const client = clients.create({ name: "Comprador de prueba", documentType: null, documentNumber: null, email: null }, employee.id);
  const sale = new SalesService(database).createSale({
    items: [{ productId: product.id, quantity: "1" }], clientId: client.id,
    payment: { method: "cash", amountPaidCop: "1000" }
  }, employee.id);
  const sales = new SalesService(database);
  assert.equal(sale.createdByUsername, employee.username);
  assert.equal(sales.listSales({ page: 1, pageSize: 10 }).sales[0].createdByUsername, employee.username);
  const managerSale = sales.createSale({
    items: [{ productId: product.id, quantity: "1" }],
    payment: { method: "cash", amountPaidCop: "1000" }
  }, auth.requireCapability(6, "sales:create").id);
  assert.equal(managerSale.createdByUsername, manager.username);
  assert.equal(database.prepare("SELECT created_by_user_id FROM clients WHERE id = ?").get(client.id).created_by_user_id, employee.id);
  assert.equal(database.prepare("SELECT created_by_user_id FROM sales WHERE id = ?").get(sale.id).created_by_user_id, employee.id);
  assert.equal(database.prepare("SELECT created_by_user_id FROM inventory_movements WHERE sale_id = ?").get(sale.id).created_by_user_id, employee.id);

  auth.setUserActive(employee.id, false, admin.id);
  assert.throws(() => auth.requireCapability(4, "sales:create"), /sesión terminó/i);
});

test("no es posible completar el flujo inicial después de crear la primera cuenta", async () => {
  const database = openPosDatabase(":memory:");
  try {
    const auth = new AuthService(database);
    await auth.bootstrapAdmin({ username: "admin1", password: "Contraseña inicial 2026!" }, 1);
    assert.throws(() => auth.setUserActive(auth.state(1).user.id, false, auth.state(1).user.id), /desactivar tu propio/i);
  } finally {
    database.close();
  }
});
