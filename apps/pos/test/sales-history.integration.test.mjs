import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openPosDatabase } from "../src/main/database/database.ts";
import { CatalogService } from "../src/main/catalog/catalogService.ts";
import { ClientsService } from "../src/main/clients/clientsService.ts";
import { SalesService } from "../src/main/sales/salesService.ts";
import { ReceiptService } from "../src/main/receipts/receiptService.ts";
import { renderReceipt } from "../src/main/receipts/receiptTemplate.ts";
import { createSalesHandlers } from "../src/main/sales/salesHandlers.ts";
import { SALES_CHANNELS } from "../src/salesBridge.ts";

const layout = { paperWidthMm: 58, marginMm: 3, pageHeightMm: 200 };
const productInput = { name: 'Arroz <img src="https://example.invalid/x"> & "especial"', internalCode: "HIST-01",
  barcode: "000001", costCop: "100", salePriceCop: "9007199254740993", unit: "kg", initialStock: "100" };
const buyerInput = { name: "Comprador <script>alert('x')</script>", documentType: "CC", documentNumber: "00123", email: "pruebas@example.invalid" };

function seed(database) {
  const catalog = new CatalogService(database);
  const clients = new ClientsService(database);
  const sales = new SalesService(database);
  const product = catalog.createProduct(productInput);
  const buyer = clients.create(buyerInput);
  const sale = sales.createSale({ clientId: buyer.id, items: [{ productId: product.id, quantity: "1" }],
    payment: { method: "cash", amountPaidCop: "9007199254741000" } });
  return { catalog, clients, sales, product, buyer, sale };
}

function snapshot(database) {
  return Object.fromEntries(["sales", "sale_items", "sale_payments", "sale_buyer_snapshots", "inventory_movements", "products", "clients"]
    .map((table) => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

function fakeOutput(overrides = {}) {
  const calls = { html: [], printed: 0, written: [], closed: 0, dialogs: [] };
  const output = {
    printerCount: async () => 1,
    selectPdfPath: async (name) => { calls.dialogs.push(name); return "chosen.pdf"; },
    writePdf: async (path, data) => { calls.written.push({ path, data }); },
    open: async (html) => {
      calls.html.push(html);
      return {
        print: async () => { calls.printed++; return { status: "printed", message: "Encolado" }; },
        pdf: async () => new Uint8Array([37, 80, 68, 70]),
        close: () => { calls.closed++; }
      };
    },
    ...overrides
  };
  return { calls, output };
}

test("el historial persiste instantáneas e importes exactos y escapa todos los textos del comprobante", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mercado-history-"));
  const path = join(dir, "sales.sqlite");
  let database = openPosDatabase(path);
  t.after(() => { database.close(); rmSync(dir, { recursive: true, force: true }); });
  const { sale, catalog, clients, product, buyer } = seed(database);
  const original = renderReceipt(sale, layout);
  catalog.updateProduct(product.id, { ...productInput, name: "PRODUCTO EDITADO", unit: "unit", salePriceCop: "123", active: false });
  clients.update(buyer.id, { ...buyerInput, name: "COMPRADOR EDITADO", documentNumber: "99999", active: false });
  database.close();
  database = openPosDatabase(path);
  const sales = new SalesService(database);
  assert.deepEqual(sales.getSale(sale.id), sale);
  assert.equal(sales.listSales({ page: 1, pageSize: 20 }).sales[0].totalCop, "9007199254740993");
  assert.equal(sale.payment.changeCop, "7");
  const saved = snapshot(database);
  const { calls, output } = fakeOutput();
  const receipts = new ReceiptService(sales, output);
  for (const width of [58, 80]) {
    const request = { saleId: sale.id, layout: { ...layout, paperWidthMm: width } };
    for (let repeat = 0; repeat < 3; repeat++) {
      sales.listSales({ page: 1, pageSize: 1 });
      assert.equal((await receipts.exportPdf(request)).status, "saved");
      assert.equal((await receipts.print(request)).status, "printed");
    }
  }
  assert.deepEqual(snapshot(database), saved);
  assert.equal(calls.html[0], original);
  assert.equal(calls.closed, 12);
  assert.equal(calls.written.length, 6);
  assert.ok(calls.html.every((html) => !html.includes("PRODUCTO EDITADO") && !html.includes("COMPRADOR EDITADO")));
  assert.match(original, /&lt;img src=&quot;https:/);
  assert.match(original, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
  assert.doesNotMatch(original, /<script|<img|<link|<iframe/);
  assert.match(original, /COMPROBANTE LOCAL — NO ES FACTURA ELECTRÓNICA/);
  assert.match(original, /9\.007\.199\.254\.740\.993/);
  assert.match(original, /Facturación electrónica pendiente/);
});

test("paginación estable, vacíos y límites inclusivos por fecha colombiana", (t) => {
  const database = openPosDatabase(":memory:");
  t.after(() => database.close());
  const { sales, product, sale } = seed(database);
  const make = () => sales.createSale({ items: [{ productId: product.id, quantity: "1" }],
    payment: { method: "bank_transfer", amountPaidCop: productInput.salePriceCop } });
  const other = [make(), make(), make(), make()];
  const dates = ["2026-09-28T04:59:59.999Z", "2026-09-28T05:00:00.000Z", "2026-09-29T04:59:59.999Z", "2026-09-29T04:59:59.999Z", "2026-09-29T05:00:00.000Z"];
  [sale, ...other].forEach((saved, index) => database.prepare("UPDATE sales SET created_at = ? WHERE id = ?").run(dates[index], saved.id));
  const before = snapshot(database);
  const filter = { page: 1, pageSize: 2, dateFrom: "2026-09-28", dateTo: "2026-09-28" };
  const first = sales.listSales(filter);
  const second = sales.listSales({ ...filter, page: 2 });
  assert.equal(first.total, 3);
  assert.deepEqual(first.sales.map((s) => s.id), [other[2].id, other[1].id]);
  assert.deepEqual(second.sales.map((s) => s.id), [other[0].id]);
  assert.equal(sales.listSales({ ...filter, page: 3 }).sales.length, 0);
  assert.equal(sales.listSales({ page: 1, pageSize: 10, dateTo: "2026-09-27" }).total, 1);
  assert.equal(sales.listSales({ page: 1, pageSize: 10, dateFrom: "2026-10-01" }).total, 0);
  assert.equal(sales.listSales({ page: 1, pageSize: 100 }).total, 5);
  for (const input of [{ page: 0 }, { pageSize: 101 }, { page: 1.5 }, { dateFrom: "2026-02-30" },
    { dateTo: "2026-13-01" }, { dateFrom: "2026-09-30", dateTo: "2026-09-01" }, { dateFrom: "' OR 1=1--" }]) {
    assert.throws(() => sales.listSales({ page: 1, pageSize: 20, ...input }));
  }
  assert.throws(() => sales.getSale("../../catalog.sqlite"));
  assert.throws(() => sales.getSale("00000000-0000-0000-0000-000000000000"), /No se encontró/);
  assert.deepEqual(snapshot(database), before);
});

test("cancelación, falta de impresoras y fallos de impresión/PDF no escriben en SQLite", async (t) => {
  const database = openPosDatabase(":memory:");
  t.after(() => database.close());
  const { sales, sale } = seed(database);
  const before = snapshot(database);
  const request = { saleId: sale.id, layout };
  const noPrinters = fakeOutput({ printerCount: async () => 0 });
  assert.match((await new ReceiptService(sales, noPrinters.output).print(request)).message, /No hay impresoras/);
  assert.equal(noPrinters.calls.html.length, 0);
  const cancelledPdf = fakeOutput({ selectPdfPath: async () => null });
  assert.equal((await new ReceiptService(sales, cancelledPdf.output).exportPdf(request)).status, "cancelled");
  assert.equal(cancelledPdf.calls.written.length, 0);
  assert.equal(cancelledPdf.calls.html.length, 0);
  for (const status of ["cancelled", "error"]) {
    let closed = false;
    const output = fakeOutput({ open: async () => ({
      print: async () => ({ status, message: status }), pdf: async () => { throw new Error("PDF failure"); },
      close: () => { closed = true; }
    }) }).output;
    const receipts = new ReceiptService(sales, output);
    assert.equal((await receipts.print(request)).status, status);
    assert.equal((await receipts.exportPdf(request)).status, "error");
    assert.equal(closed, true);
  }
  const failedWrite = fakeOutput({ writePdf: async () => { throw new Error("permission denied"); } });
  assert.equal((await new ReceiptService(sales, failedWrite.output).exportPdf(request)).status, "error");
  assert.equal(failedWrite.calls.closed, 1);
  const failedOpen = fakeOutput({ open: async () => { throw new Error("load failed"); } });
  assert.equal((await new ReceiptService(sales, failedOpen.output).print(request)).status, "error");
  assert.deepEqual(snapshot(database), before);
});

test("IPC rechaza remitentes, IDs, rutas, HTML y formatos ajenos al contrato; serializa diálogos", async (t) => {
  const database = openPosDatabase(":memory:");
  t.after(() => database.close());
  const { sales, sale } = seed(database);
  const before = snapshot(database);
  let release;
  let entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const output = fakeOutput({ open: async () => ({
    close() {}, pdf: async () => new Uint8Array(),
    print: () => { entered(); return new Promise((resolve) => { release = resolve; }); }
  }) }).output;
  const receipts = new ReceiptService(sales, output);
  const frame = {};
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  const event = { sender: window.webContents, senderFrame: frame };
  const testAuth = {
    requireUser: () => ({ id: "admin-test", role: "admin" }),
    requireCapability: () => ({ id: "admin-test", role: "admin" })
  };
  const handlers = createSalesHandlers(sales, receipts, () => window, testAuth);
  for (const handler of Object.values(handlers)) {
    assert.throws(() => handler({ sender: {}, senderFrame: frame }), /no autorizada/);
    assert.throws(() => handler({ ...event, senderFrame: {} }), /no autorizada/);
    assert.throws(() => handler({ ...event, senderFrame: null }), /no autorizada/);
  }
  for (const channel of [SALES_CHANNELS.printReceipt, SALES_CHANNELS.exportReceiptPdf]) {
    for (const bad of [{ saleId: "bad", layout }, { saleId: sale.id, layout, html: "<script>" },
      { saleId: sale.id, layout, path: "C:/other.pdf" }, { saleId: sale.id, layout: { ...layout, marginMm: -1 } },
      { saleId: sale.id, layout: { ...layout, paperWidthMm: 70 } }]) {
      assert.throws(() => handlers[channel](event, bad), /no es válida/);
    }
  }
  const request = { saleId: sale.id, layout };
  const printing = handlers[SALES_CHANNELS.printReceipt](event, request);
  await ready;
  assert.equal((await handlers[SALES_CHANNELS.exportReceiptPdf](event, request)).status, "error");
  release({ status: "cancelled", message: "Cancelado" });
  await printing;
  assert.deepEqual(handlers[SALES_CHANNELS.getSale](event, sale.id), sale);
  assert.equal(handlers[SALES_CHANNELS.listSales](event, { page: 1, pageSize: 20 }).total, 1);
  assert.deepEqual(snapshot(database), before);
});
