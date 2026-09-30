import assert from "node:assert/strict";
import test from "node:test";
import { AuthService } from "../src/main/auth/authService.ts";
import { openPosDatabase } from "../src/main/database/database.ts";
import { CatalogService } from "../src/main/catalog/catalogService.ts";
import { CashService } from "../src/main/cash/cashService.ts";
import { createCashHandlers } from "../src/main/cash/cashHandlers.ts";
import { CASH_CHANNELS } from "../src/cashBridge.ts";
import { SalesService } from "../src/main/sales/salesService.ts";

test("apertura y cierre concilian ventas, conservan usuarios y bloquean operaciones fuera del turno", async (t) => {
  const database = openPosDatabase(":memory:");
  t.after(() => database.close());
  const auth = new AuthService(database);
  const admin = await auth.bootstrapAdmin({ username: "cajaadmin", password: "Admin seguro 2026!" }, 71);
  const manager = await auth.createUser({ username: "cajajefe", password: "Jefe seguro 2026!", role: "employee_manager" });
  const employee = await auth.createUser({ username: "cajero", password: "Cajero seguro 2026!", role: "employee" });
  const cash = new CashService(database);
  const sales = new SalesService(database);
  const catalog = new CatalogService(database);
  const product = catalog.createProduct({
    name: "Producto de prueba caja", internalCode: "CASH-001", barcode: null,
    costCop: "500", salePriceCop: "1000", unit: "unit", initialStock: "10"
  }, admin.id);
  const frame = {};
  const webContents = { id: 71, mainFrame: frame };
  const window = { webContents, isDestroyed: () => false };
  const handlers = createCashHandlers(cash, () => window, auth);
  const event = { sender: webContents, senderFrame: frame };
  const invoke = async (channel, input) => handlers[channel](event, input);

  assert.deepEqual(await invoke(CASH_CHANNELS.availability), {
    isOpen: false, openedAt: null, openedByUsername: null
  });
  assert.throws(() => sales.createSale({
    items: [{ productId: product.id, quantity: "1" }],
    payment: { method: "cash", amountPaidCop: "1000" }
  }, employee.id), /No hay una caja abierta/);
  assert.equal(catalog.listProducts({ query: "CASH-001", includeInactive: false })[0].stock, "10");
  assert.equal(database.prepare("SELECT count(*) AS count FROM sales").get().count, 0n);

  await auth.login({ username: employee.username, password: "Cajero seguro 2026!" }, 71);
  await assert.rejects(invoke(CASH_CHANNELS.overview), /No tienes permiso/);
  await assert.rejects(invoke(CASH_CHANNELS.open, { openingCashCop: "20000" }), /No tienes permiso/);
  assert.deepEqual(await invoke(CASH_CHANNELS.availability), { isOpen: false, openedAt: null, openedByUsername: null });

  await auth.login({ username: admin.username, password: "Admin seguro 2026!" }, 71);
  await assert.rejects(invoke(CASH_CHANNELS.open, { openingCashCop: "-1" }), /no son válidos/);
  const opened = await invoke(CASH_CHANNELS.open, { openingCashCop: "50000" });
  assert.equal(opened.status, "open");
  assert.equal(opened.openingCashCop, "50000");
  assert.equal(opened.expectedCashCop, "50000");
  assert.equal(opened.creditPaymentsCop, "0");
  assert.equal(opened.cashCreditPaymentsCop, "0");
  await assert.rejects(invoke(CASH_CHANNELS.open, { openingCashCop: "0" }), /Ya hay un turno/);

  await auth.login({ username: employee.username, password: "Cajero seguro 2026!" }, 71);
  const availability = await invoke(CASH_CHANNELS.availability);
  assert.deepEqual(availability, { isOpen: true, openedAt: opened.openedAt, openedByUsername: admin.username });
  assert.equal(Object.hasOwn(availability, "openingCashCop"), false);
  const employeeCashSale = sales.createSale({
    items: [{ productId: product.id, quantity: "1" }],
    payment: { method: "cash", amountPaidCop: "1500" }
  }, employee.id);
  const cardSale = sales.createSale({
    items: [{ productId: product.id, quantity: "1" }],
    payment: { method: "debit_card", amountPaidCop: "1000" }
  }, employee.id);
  const secondCashSale = sales.createSale({
    items: [{ productId: product.id, quantity: "1" }],
    payment: { method: "cash", amountPaidCop: "2000" }
  }, employee.id);
  assert.equal(employeeCashSale.cashSessionId, opened.id);
  assert.equal(cardSale.cashSessionId, opened.id);
  assert.equal(secondCashSale.cashSessionId, opened.id);

  const current = cash.overview().activeSession;
  assert.equal(current.salesCount, 3);
  assert.equal(current.totalSalesCop, "3000");
  assert.equal(current.cashSalesCop, "2000");
  assert.equal(current.creditPaymentsCop, "0");
  assert.equal(current.cashCreditPaymentsCop, "0");
  assert.equal(current.expectedCashCop, "52000");
  assert.deepEqual(current.creditPaymentTotals, []);
  assert.deepEqual(current.paymentTotals, [
    { method: "cash", amountCop: "2000", salesCount: 2 },
    { method: "debit_card", amountCop: "1000", salesCount: 1 }
  ]);

  await auth.login({ username: manager.username, password: "Jefe seguro 2026!" }, 71);
  await assert.rejects(invoke(CASH_CHANNELS.close, { countedCashCop: "51.900" }), /no son válidos/);
  database.exec(`
    CREATE TRIGGER fail_cash_close_snapshot BEFORE INSERT ON cash_session_payment_totals
    BEGIN SELECT RAISE(ABORT, 'forced cash summary failure'); END;
  `);
  assert.throws(() => cash.closeSession({ countedCashCop: "51900" }, manager.id), /forced cash summary failure/);
  assert.equal(database.prepare("SELECT status FROM cash_sessions WHERE id = ?").get(opened.id).status, "open");
  assert.equal(database.prepare("SELECT count(*) AS count FROM cash_session_payment_totals WHERE cash_session_id = ?").get(opened.id).count, 0n);
  database.exec("DROP TRIGGER fail_cash_close_snapshot");

  const closed = await invoke(CASH_CHANNELS.close, { countedCashCop: "51900" });
  assert.equal(closed.status, "closed");
  assert.equal(closed.openedByUsername, admin.username);
  assert.equal(closed.closedByUsername, manager.username);
  assert.equal(closed.expectedCashCop, "52000");
  assert.equal(closed.creditPaymentsCop, "0");
  assert.equal(closed.cashCreditPaymentsCop, "0");
  assert.deepEqual(closed.creditPaymentTotals, []);
  assert.equal(closed.countedCashCop, "51900");
  assert.equal(closed.varianceCashCop, "-100");
  assert.deepEqual(cash.overview(), { activeSession: null, recentSessions: [closed] });
  await assert.rejects(invoke(CASH_CHANNELS.close, { countedCashCop: "52000" }), /No hay un turno/);
  assert.throws(() => database.prepare("UPDATE cash_session_payment_totals SET total_cop = 1 WHERE cash_session_id = ?").run(opened.id), /immutable/);
  assert.throws(() => database.prepare("UPDATE cash_sessions SET opening_cash_cop = 1 WHERE id = ?").run(opened.id), /immutable/);
  assert.throws(() => sales.createSale({
    items: [{ productId: product.id, quantity: "1" }],
    payment: { method: "cash", amountPaidCop: "1000" }
  }, employee.id), /No hay una caja abierta/);
  assert.equal(catalog.listProducts({ query: "CASH-001", includeInactive: false })[0].stock, "7");
});
