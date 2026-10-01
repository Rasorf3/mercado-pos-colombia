import assert from "node:assert/strict";
import test from "node:test";
import { openPosDatabase } from "../src/main/database/database.ts";
import { CatalogService } from "../src/main/catalog/catalogService.ts";
import { SalesService } from "../src/main/sales/salesService.ts";
import { CashService } from "../src/main/cash/cashService.ts";
import { AuthService } from "../src/main/auth/authService.ts";
import { trackedTransaction, seedExistingDatabase } from "../src/main/sync/syncJournal.ts";

test("la cola guarda venta, pago y movimiento juntos y revierte ante fallo", async () => {
  const db=openPosDatabase(":memory:");
  try {
    const user=await new AuthService(db).bootstrapAdmin({ username:"admin",password:"12345" },1);
    const catalog=new CatalogService(db), sales=new SalesService(db);
    const product=catalog.createProduct({ name:"Arroz",internalCode:"A",barcode:"001",costCop:"800",salePriceCop:"1200",unit:"unit",initialStock:"5" },user.id);
    new CashService(db).openSession({ openingCashCop:"0" },user.id);
    db.transaction(() => { seedExistingDatabase(db); db.prepare("UPDATE sync_settings SET enabled=1").run(); })();
    const before=db.prepare("SELECT count(*) AS n FROM sync_outbox").get().n;
    const input={ items:[{productId:product.id,quantity:"2"}],payment:{method:"cash",amountPaidCop:"2400"} };
    const sale=trackedTransaction(db,"sale",user.id,()=>sales.createSale(input,user.id)).immediate();
    const row=db.prepare("SELECT payload FROM sync_outbox ORDER BY sequence DESC LIMIT 1").get();
    const event=JSON.parse(row.payload);
    assert.equal(event.changes.filter((c)=>c.table==="sales")[0].row.id,sale.id);
    assert.equal(event.changes.filter((c)=>c.table==="sale_payments").length,1);
    assert.equal(event.changes.filter((c)=>c.table==="inventory_movements").length,1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sync_outbox").get().n,before+1n);
    assert.throws(()=>trackedTransaction(db,"sale",user.id,()=>{ sales.createSale(input,user.id);throw new Error("fallo simulado"); }).immediate(),/fallo simulado/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sales").get().n,1n);
    assert.equal(db.prepare("SELECT stock_milli FROM products").get().stock_milli,3000n);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sync_outbox").get().n,before+1n);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sync_capture").get().n,0n);
  } finally { db.close(); }
});
