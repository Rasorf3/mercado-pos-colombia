import assert from "node:assert/strict";
import test from "node:test";
import { AuthService } from "../src/main/auth/authService.ts";
import { CashService } from "../src/main/cash/cashService.ts";
import { CatalogService } from "../src/main/catalog/catalogService.ts";
import { ClientsService } from "../src/main/clients/clientsService.ts";
import { openPosDatabase } from "../src/main/database/database.ts";
import { ReceivablesService } from "../src/main/receivables/receivablesService.ts";
import { SalesService } from "../src/main/sales/salesService.ts";

test("fiados, abonos, límites, snapshots y cierre de caja persisten de forma transaccional", async (t) => {
  const database = openPosDatabase(":memory:");
  t.after(() => database.close());
  const auth = new AuthService(database);
  const admin = await auth.bootstrapAdmin({ username: "credito-admin", password: "Admin seguro 2026!" }, 81);
  const manager = await auth.createUser({ username: "credito-jefe", password: "Jefe seguro 2026!", role: "employee_manager" });
  const employee = await auth.createUser({ username: "credito-cajero", password: "Cajero seguro 2026!", role: "employee" });

  const cash = new CashService(database);
  const catalog = new CatalogService(database);
  const clients = new ClientsService(database);
  const receivables = new ReceivablesService(database);
  const sales = new SalesService(database);
  const opened = cash.openSession({ openingCashCop: "10000" }, admin.id);
  const client = clients.create({
    name: "Cliente Fiado", documentType: "CC", documentNumber: "00123", email: null,
    phone: "3001112222", address: "Carrera 1"
  }, employee.id);
  assert.equal(client.creditLimitCop, "300000");
  assert.equal(client.creditBalanceCop, "0");

  const product = catalog.createProduct({
    name: "Arroz 5 kg", internalCode: "CREDIT-RICE", barcode: null,
    costCop: "70000", salePriceCop: "100000", unit: "unit", initialStock: "10"
  }, admin.id);
  const first = sales.createSale({
    clientId: client.id,
    settlement: "on_account",
    items: [{ productId: product.id, quantity: "1" }]
  }, employee.id);
  assert.equal(first.settlement, "on_account");
  assert.equal(first.payment, null);
  assert.equal(first.totalCop, "100000");
  assert.equal(database.prepare("SELECT count(*) AS count FROM sale_payments WHERE sale_id = ?").get(first.id).count, 0n);
  assert.equal(database.prepare("SELECT amount_cop FROM client_credit_entries WHERE sale_id = ?").get(first.id).amount_cop, 100000n);
  assert.equal(catalog.listProducts({ query: "CREDIT-RICE", includeInactive: false })[0].stock, "9");
  assert.equal(receivables.getAccount(client.id).entries[0].createdByUsername, employee.username);

  assert.throws(() => sales.createSale({
    clientId: client.id, settlement: "on_account",
    items: [{ productId: product.id, quantity: "2.01" }]
  }, employee.id), /supera el límite/);
  assert.throws(() => sales.createSale({
    clientId: client.id, settlement: "on_account",
    items: [{ productId: product.id, quantity: "1", discount: { type: "percentage", value: "100" } }]
  }, employee.id), /total mayor que cero/);
  assert.equal(catalog.listProducts({ query: "CREDIT-RICE", includeInactive: false })[0].stock, "9");
  assert.equal(database.prepare("SELECT count(*) AS count FROM sales").get().count, 1n);

  const extended = clients.setCreditLimit(client.id, "500000", employee.id);
  assert.equal(extended.creditLimitCop, "500000");
  assert.throws(() => clients.setCreditLimit(client.id, "99999", employee.id), /no puede ser menor que el saldo/);
  assert.equal(database.prepare("SELECT changed_by_user_id FROM client_credit_limit_events WHERE client_id = ?").get(client.id).changed_by_user_id, employee.id);

  clients.update(client.id, {
    name: "Cliente Renombrado", documentType: "CC", documentNumber: "00123", email: null,
    phone: "3119998877", address: "Calle nueva", active: true
  }, admin.id);
  const second = sales.createSale({
    clientId: client.id, settlement: "on_account",
    items: [{ productId: product.id, quantity: "2.01" }]
  }, manager.id);
  assert.equal(second.totalCop, "201000");
  assert.equal(receivables.getAccount(client.id).balanceCop, "301000");
  assert.deepEqual(sales.getSale(first.id).buyer, {
    clientId: client.id, name: "Cliente Fiado", documentType: "CC", documentNumber: "00123",
    email: null, phone: "3001112222", address: "Carrera 1"
  });
  assert.equal(sales.listSales({ page: 1, pageSize: 20, buyerQuery: "3001112222" }).total, 1);
  assert.equal(sales.listSales({ page: 1, pageSize: 20, buyerQuery: "3119998877" }).sales[0].id, second.id);
  assert.equal(sales.listSales({ page: 1, pageSize: 20, buyerQuery: "Cliente Fiado" }).sales[0].id, first.id);

  assert.throws(() => receivables.recordPayment({ clientId: client.id, amountCop: "301001", method: "cash" }, employee.id), /no puede superar/);
  assert.equal(receivables.getAccount(client.id).balanceCop, "301000");
  const cashPayment = receivables.recordPayment({ clientId: client.id, amountCop: "150000", method: "cash" }, employee.id);
  assert.equal(cashPayment.balanceCop, "151000");
  const nonCashPayment = receivables.recordPayment({
    clientId: client.id, amountCop: "151000", method: "nequi", reference: "NEQUI-REF-91"
  }, manager.id);
  assert.equal(nonCashPayment.balanceCop, "0");
  assert.equal(nonCashPayment.availableCreditCop, "500000");
  assert.equal(nonCashPayment.entries.find((entry) => entry.reference === "NEQUI-REF-91").createdByUsername, manager.username);
  assert.equal(receivables.listAccounts({ query: "" }).length, 0);
  assert.equal(receivables.listAccounts({ query: "Cliente Renombrado" })[0].balanceCop, "0");

  const active = cash.overview().activeSession;
  assert.equal(active.salesCount, 2);
  assert.equal(active.totalSalesCop, "301000");
  assert.equal(active.cashSalesCop, "0");
  assert.equal(active.creditPaymentsCop, "301000");
  assert.equal(active.cashCreditPaymentsCop, "150000");
  assert.equal(active.expectedCashCop, "160000");
  assert.deepEqual(active.creditPaymentTotals, [
    { method: "cash", amountCop: "150000", paymentsCount: 1 },
    { method: "nequi", amountCop: "151000", paymentsCount: 1 }
  ]);

  const rollbackProduct = catalog.createProduct({
    name: "Producto rollback fiado", internalCode: "CREDIT-ROLLBACK", barcode: null,
    costCop: "30000", salePriceCop: "50000", unit: "unit", initialStock: "1"
  }, admin.id);
  const beforeRollback = {
    sales: database.prepare("SELECT count(*) AS count FROM sales").get().count,
    entries: database.prepare("SELECT count(*) AS count FROM client_credit_entries").get().count
  };
  database.exec(`
    CREATE TRIGGER fail_credit_movement BEFORE INSERT ON inventory_movements
    WHEN NEW.type = 'sale_out' AND NEW.product_id = '${rollbackProduct.id}'
    BEGIN SELECT RAISE(ABORT, 'forced credit movement failure'); END;
  `);
  assert.throws(() => sales.createSale({
    clientId: client.id, settlement: "on_account",
    items: [{ productId: rollbackProduct.id, quantity: "1" }]
  }, employee.id), /forced credit movement failure/);
  assert.equal(database.prepare("SELECT count(*) AS count FROM sales").get().count, beforeRollback.sales);
  assert.equal(database.prepare("SELECT count(*) AS count FROM client_credit_entries").get().count, beforeRollback.entries);
  assert.equal(catalog.listProducts({ query: "CREDIT-ROLLBACK", includeInactive: false })[0].stock, "1");
  database.exec("DROP TRIGGER fail_credit_movement");

  database.exec(`
    CREATE TRIGGER fail_credit_cash_close BEFORE INSERT ON cash_session_credit_payment_totals
    BEGIN SELECT RAISE(ABORT, 'forced credit cash summary failure'); END;
  `);
  assert.throws(() => cash.closeSession({ countedCashCop: "160000" }, manager.id), /forced credit cash summary failure/);
  assert.equal(cash.overview().activeSession.id, opened.id);
  assert.equal(database.prepare("SELECT count(*) AS count FROM cash_session_credit_payment_totals WHERE cash_session_id = ?").get(opened.id).count, 0n);
  database.exec("DROP TRIGGER fail_credit_cash_close");

  const closed = cash.closeSession({ countedCashCop: "160000" }, manager.id);
  assert.equal(closed.status, "closed");
  assert.equal(closed.expectedCashCop, "160000");
  assert.equal(closed.creditPaymentsCop, "301000");
  assert.equal(closed.cashCreditPaymentsCop, "150000");
  assert.deepEqual(cash.overview().recentSessions, [closed]);
  assert.throws(() => database.prepare("UPDATE client_credit_entries SET amount_cop = 1").run(), /immutable/);
  assert.throws(() => database.prepare("DELETE FROM client_credit_entries").run(), /immutable/);
  assert.throws(() => database.prepare("UPDATE cash_session_credit_payment_totals SET total_cop = 1").run(), /immutable/);
});
