import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { app, BrowserWindow } from "electron";
import { calculateSaleAmounts } from "@mercado-pos/domain";
import { openPosDatabase } from "../src/main/database/database.ts";
import { SalesService } from "../src/main/sales/salesService.ts";
import { CatalogService } from "../src/main/catalog/catalogService.ts";
import { ClientsService } from "../src/main/clients/clientsService.ts";
import { ReceiptService } from "../src/main/receipts/receiptService.ts";
import { electronReceiptOutput } from "../src/main/receipts/electronReceiptOutput.ts";

const directory = resolve(process.argv[2]);
app.setPath("userData", join(directory, "electron-profile"));
void app.whenReady().then(async () => {
  await mkdir(directory, { recursive: true });
  const owner = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const database = openPosDatabase(":memory:");
  try {
    const catalog = new CatalogService(database);
    const clients = new ClientsService(database);
    const sales = new SalesService(database);
    const buyer = clients.create({ name: "Comprador de prueba <b>sin HTML</b> & familia", documentType: "CC", documentNumber: "000123", email: "pruebas@example.invalid" });
    const products = Array.from({ length: 40 }, (_, i) => catalog.createProduct({
      name: `${String(i + 1).padStart(2, "0")} Producto de nombre largo: café molido, arroz integral y frutas & ${"X".repeat(70)}`.slice(0, 120),
      internalCode: `QA-${i + 1}`, barcode: null, costCop: "500", salePriceCop: (1250n + BigInt(i) * 7n).toString(), unit: "kg", initialStock: "20"
    }));
    const fixtures = [3, 40].map((count) => {
      const chosen = products.slice(0, count);
      const amount = calculateSaleAmounts(chosen.map((product) => ({ quantity: "1.125", unitPriceCop: product.salePriceCop }))).totalCop;
      return sales.createSale({ clientId: buyer.id, items: chosen.map((product) => ({ productId: product.id, quantity: "1.125" })),
        payment: { method: "cash", amountPaidCop: (amount + 5000n).toString() } });
    });
    clients.update(buyer.id, { name: "NO DEBE APARECER CLIENTE", documentType: null, documentNumber: null, email: null, active: false });
    for (const product of products) catalog.updateProduct(product.id, {
      name: "NO DEBE APARECER PRODUCTO", internalCode: product.internalCode, barcode: null, costCop: "1", salePriceCop: "1", unit: "unit", active: false
    });
    const readState = () => ["sales", "sale_items", "sale_payments", "sale_buyer_snapshots", "inventory_movements", "products", "clients"]
      .map((table) => database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before = readState();
    const output = electronReceiptOutput(() => owner);
    const results = [];
    for (const width of [58, 80] as const) {
      for (const [index, sale] of fixtures.entries()) {
        const fileName = `comprobante-${width}mm-${index ? "40-productos" : "3-productos"}.pdf`;
        const receipts = new ReceiptService(sales, { ...output, selectPdfPath: async () => join(directory, fileName) });
        for (let repeat = 0; repeat < 2; repeat++) {
          assert.deepEqual(sales.getSale(sale.id), sale);
          const result = await receipts.exportPdf({ saleId: sale.id, layout: { paperWidthMm: width, marginMm: 3, pageHeightMm: 200 } });
          assert.equal(result.status, "saved", result.message);
          assert.deepEqual(readState(), before);
        }
        results.push({ fileName, saleId: sale.id, items: sale.items.length, totalCop: sale.totalCop, widthMm: width, heightMm: 200 });
      }
    }
    const printers = (await owner.webContents.getPrintersAsync()).map(({ name }) => name);
    await writeFile(join(directory, "results.json"), JSON.stringify({ electron: process.versions.electron, results, printers, physicalPrintTested: false }, null, 2));
    console.log(JSON.stringify({ electron: process.versions.electron, results, printerCount: printers.length, unchangedDatabase: true, physicalPrintTested: false }, null, 2));
  } finally {
    database.close();
    owner.destroy();
  }
  app.exit(0);
}).catch((error: unknown) => { console.error(error); app.exit(1); });
