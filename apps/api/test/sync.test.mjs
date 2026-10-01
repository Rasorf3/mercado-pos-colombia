import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildApp } from "../src/app.ts";
import { migrateSyncDatabase } from "../src/sync/database.ts";
import { SyncStore } from "../src/sync/syncStore.ts";
import { openPosDatabase } from "../../pos/src/main/database/database.ts";
import { AuthService } from "../../pos/src/main/auth/authService.ts";
import { CatalogService } from "../../pos/src/main/catalog/catalogService.ts";
import { ClientsService } from "../../pos/src/main/clients/clientsService.ts";
import { CashService } from "../../pos/src/main/cash/cashService.ts";
import { SalesService } from "../../pos/src/main/sales/salesService.ts";
import { ReceivablesService } from "../../pos/src/main/receivables/receivablesService.ts";
import { SyncService } from "../../pos/src/main/sync/syncService.ts";

const pairingKey="clave-solo-para-pruebas-aisladas-0000000000";
function adapter(pg) {
  const wrap=(connection)=>({query:async(sql,values)=>values===undefined&&sql.split(";").filter((x)=>x.trim()).length>1 ? (await connection.exec(sql)).at(-1) : connection.query(sql,values)});
  return {...wrap(pg),transaction:(action)=>pg.transaction((tx)=>action(wrap(tx))),close:()=>pg.close()};
}
async function server() {
  const pg=new PGlite(),db=adapter(pg);
  await migrateSyncDatabase(db);
  const store=new SyncStore(db,pairingKey),app=buildApp({sync:store});
  await app.ready();
  return {pg,db,store,app,close:async()=>{await app.close();await pg.close();}};
}
async function register(app,name,options={}) {
  const db=openPosDatabase(options.filePath??":memory:"),auth=new AuthService(db);
  const user=options.initialToken ? await auth.login({username:"admin",password:"12345"},1) : await auth.bootstrapAdmin({username:"admin",password:"12345"},1);
  const network={online:true,losePushReply:false,disconnectAfterReserve:false};
  let token=options.initialToken??null;
  const transport=async(url,init)=>{
    if(!network.online)throw new Error("caída simulada");
    const route=new URL(url).pathname+new URL(url).search;
    const response=await app.inject({method:init.method??"GET",url:route,headers:init.headers,payload:init.body});
    if(network.losePushReply&&route==="/sync/operations"&&response.statusCode===200) {network.losePushReply=false;throw new Error("respuesta perdida tras commit");}
    if(network.disconnectAfterReserve&&route==="/sync/credit-reservations"&&response.statusCode===200) {network.disconnectAfterReserve=false;network.online=false;}
    return new Response(response.body,{status:response.statusCode,headers:{"content-type":"application/json"}});
  };
  const sync=new SyncService(db,{read:()=>token,write:(value)=>{token=value;}},transport);
  return {name,db,user,auth,sync,network,token:()=>token,catalog:new CatalogService(db),clients:new ClientsService(db),cash:new CashService(db),sales:new SalesService(db),receivables:new ReceivablesService(db)};
}
const productDraft={name:"Arroz con nombre histórico",internalCode:"A",barcode:"00001",costCop:"600",salePriceCop:"1200",unit:"unit",initialStock:"1"};
const actor=(r)=>({id:r.user.id,username:r.user.username,role:r.user.role});
const setup=(r,merchantId)=>r.sync.setup({serverUrl:"http://127.0.0.1:3000",merchantId,deviceName:r.name,pairingKey});

test("dos cajas venden offline, reintentan sin duplicar, detectan y concilian faltante conservando ventas",async()=>{
  const s=await server(),a=await register(s.app,"Caja A"),b=await register(s.app,"Caja B"),merchant=randomUUID();
  try {
    const product=a.catalog.createProduct(productDraft,a.user.id);
    await setup(a,merchant);await setup(b,merchant);
    assert.equal(b.catalog.listProducts({query:"00001",includeInactive:false})[0].id,product.id);
    assert.equal(b.auth.listUsers().length,1,"los actores remotos no son cuentas de acceso");
    const shiftA=a.cash.openSession({openingCashCop:"1000"},a.user.id),shiftB=b.cash.openSession({openingCashCop:"2000"},b.user.id);
    await a.sync.synchronize();await b.sync.synchronize();await a.sync.synchronize();
    assert.equal(a.cash.overview().activeSession.id,shiftA.id);assert.equal(b.cash.overview().activeSession.id,shiftB.id);
    a.network.online=false;b.network.online=false;
    const input={items:[{productId:product.id,quantity:"1"}],payment:{method:"cash",amountPaidCop:"2000"}};
    const saleA=a.sales.createSale(input,a.user.id),saleB=b.sales.createSale(input,b.user.id);
    assert.equal(a.sync.status().pending,1);assert.equal(b.sync.status().pending,1);
    await assert.rejects(a.sync.synchronize(),/Sin conexión/);
    assert.equal(a.sales.getSale(saleA.id).totalCop,"1200");
    a.network.online=true;a.network.losePushReply=true;
    await assert.rejects(a.sync.synchronize(),/Sin conexión/);
    assert.equal(a.sync.status().pending,1);
    await a.sync.synchronize();
    b.network.online=true;await b.sync.synchronize();await a.sync.synchronize();
    assert.equal((await s.db.query("SELECT count(*)::text AS n FROM sync_entities WHERE merchant_id=$1 AND table_name='sales'",[merchant])).rows[0].n,"2");
    assert.equal(a.sales.listRecentSales().length,2);assert.equal(b.sales.listRecentSales().length,2);
    assert.equal(a.catalog.listProducts({query:"",includeInactive:true})[0].stock,"0");
    assert.equal(a.sync.status().conflicts.find((c)=>c.kind==="stock_shortage").quantityMilli,"1000");
    assert.equal(a.cash.overview().activeSession.cashSalesCop,"1200","la caja no suma pagos del otro equipo");
    a.catalog.updateProduct(product.id,{...productDraft,name:"Nombre nuevo",salePriceCop:"5000",active:true},a.user.id);
    await a.sync.synchronize();await b.sync.synchronize();
    for(const r of [a,b]) for(const id of [saleA.id,saleB.id]) {const saved=r.sales.getSale(id);assert.equal(saved.totalCop,"1200");assert.equal(saved.items[0].productName,productDraft.name);assert.equal(saved.payment.changeCop,"800");}
    await a.sync.reconcileStock(a.user,product.id,"0","Conteo físico con ambas cajas sincronizadas");
    await b.sync.synchronize();
    assert.equal(a.sync.status().conflicts.filter((c)=>c.kind==="stock_shortage").length,0);
    assert.equal(b.catalog.listProducts({query:"",includeInactive:true})[0].stock,"0");
    assert.equal(a.sales.listRecentSales().length,2);
    const eventsBefore=(await s.db.query("SELECT count(*)::text AS n FROM sync_events")).rows[0].n;
    await a.sync.synchronize();await b.sync.synchronize();
    assert.equal((await s.db.query("SELECT count(*)::text AS n FROM sync_events")).rows[0].n,eventsBefore);
    assert.deepEqual(a.db.pragma("foreign_key_check"),[]);assert.deepEqual(b.db.pragma("foreign_key_check"),[]);
    a.cash.closeSession({countedCashCop:"2200"},a.user.id);b.cash.closeSession({countedCashCop:"3200"},b.user.id);
    await a.sync.synchronize();await b.sync.synchronize();
    assert.equal(b.cash.overview().recentSessions.length,1);
  } finally {a.db.close();b.db.close();await s.close();}
});

test("conflictos offline de código y ediciones convergen sin perder clientes ni compradores históricos",async()=>{
  const s=await server(),a=await register(s.app,"Caja A"),b=await register(s.app,"Caja B"),merchant=randomUUID();
  try {
    const original=a.catalog.createProduct({...productDraft,initialStock:"5"},a.user.id);
    const client=a.clients.create({name:"Comprador original",documentType:"CC",documentNumber:"000123",email:null,phone:"3001234567",address:"Dirección original"},a.user.id);
    a.cash.openSession({openingCashCop:"0"},a.user.id);
    const sale=a.sales.createSale({items:[{productId:original.id,quantity:"1"}],clientId:client.id,payment:{method:"cash",amountPaidCop:"1200"}},a.user.id);
    a.cash.closeSession({countedCashCop:"1200"},a.user.id);
    a.cash.openSession({openingCashCop:"0"},a.user.id);
    a.cash.closeSession({countedCashCop:"0"},a.user.id);
    await setup(a,merchant);await setup(b,merchant);
    assert.equal(b.cash.overview().recentSessions.length,0,"cierres iniciales son de otra caja");
    a.network.online=false;b.network.online=false;
    const pa=a.catalog.createProduct({...productDraft,barcode:"00002",name:"Nuevo A"},a.user.id);
    const pb=b.catalog.createProduct({...productDraft,barcode:"00002",name:"Nuevo B"},b.user.id);
    a.catalog.updateProduct(original.id,{...productDraft,name:"Edición A",active:true},a.user.id);
    b.catalog.updateProduct(original.id,{...productDraft,name:"Edición B",active:true},b.user.id);
    a.clients.update(client.id,{name:"Nombre actual",documentType:"CC",documentNumber:"000123",email:null,phone:"3009999999",address:"Dirección nueva",active:true,creditLimitCop:"300000"},a.user.id);
    a.network.online=true;b.network.online=true;
    await a.sync.synchronize();await b.sync.synchronize();await a.sync.synchronize();
    for(const r of [a,b]) {
      const products=r.catalog.listProducts({query:"",includeInactive:true});
      assert.equal(products.find((p)=>p.id===pa.id).barcode,"00002");
      assert.equal(products.find((p)=>p.id===pb.id).barcode,null);
      assert.equal(products.find((p)=>p.id===original.id).name,"Edición A");
      const saved=r.sales.getSale(sale.id);
      assert.equal(saved.items[0].productName,productDraft.name);
      assert.equal(saved.buyer.name,"Comprador original");assert.equal(saved.buyer.phone,"3001234567");assert.equal(saved.buyer.address,"Dirección original");
      assert.equal(r.sync.status().pending,0);
      assert.deepEqual(r.db.pragma("foreign_key_check"),[]);
    }
    const conflicts=a.sync.status().conflicts.filter((c)=>c.kind==="data_conflict");
    assert.equal(conflicts.length,2);
    await a.sync.reviewConflict(a.user,conflicts[0].id,"Datos revisados por administrador");
    assert.equal(a.sync.status().conflicts.find((c)=>c.id===conflicts[0].id).resolved,true);
    const last=JSON.parse(b.db.prepare("SELECT payload FROM sync_outbox WHERE payload LIKE '%Edición B%' LIMIT 1").get().payload);
    assert.equal((await s.app.inject({method:"POST",url:"/sync/operations",headers:{authorization:`Bearer ${b.token()}`},payload:{...last,id:randomUUID(),actor:{...actor(b),role:"employee"}}})).statusCode,422);
  } finally {a.db.close();b.db.close();await s.close();}
});

test("cola persistente sobrevive reinicio y cancela reservas abandonadas sin crear deuda",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"mercado-sync-restart-")),filePath=join(directory,"test.sqlite");
  const s=await server();let a=await register(s.app,"Caja persistente",{filePath});const b=await register(s.app,"Caja B"),merchant=randomUUID();
  try {
    const product=a.catalog.createProduct({...productDraft,initialStock:"5"},a.user.id);
    const client=a.clients.create({name:"Comprador",documentType:null,documentNumber:null,email:null,creditLimitCop:"1500"},a.user.id);
    await setup(a,merchant);await setup(b,merchant);
    a.cash.openSession({openingCashCop:"0"},a.user.id);await a.sync.synchronize();
    a.network.online=false;
    const sale=a.sales.createSale({items:[{productId:product.id,quantity:"1"}],payment:{method:"cash",amountPaidCop:"1200"}},a.user.id);
    const token=a.token();a.db.close();a=await register(s.app,"Caja persistente",{filePath,initialToken:token});
    assert.equal(a.sync.status().pending,1);
    await a.sync.synchronize();await b.sync.synchronize();assert.equal(b.sales.getSale(sale.id).totalCop,"1200");
    a.network.disconnectAfterReserve=true;
    await assert.rejects(a.sync.withCredit(a.user,client.id,()=>"1200",()=>{throw new Error("fallo local antes de guardar");}),/fallo local/);
    assert.equal(a.db.prepare("SELECT count(*) AS n FROM sync_credit_intents WHERE committed=0").get().n,1n);
    a.network.online=true;await a.sync.synchronize();
    assert.equal(a.db.prepare("SELECT count(*) AS n FROM sync_credit_intents").get().n,0n);
    assert.equal((await s.db.query("SELECT state FROM sync_credit_reservations")).rows[0].state,"cancelled");
    assert.equal(a.receivables.getAccount(client.id).balanceCop,"0");
    const op=JSON.parse(a.db.prepare("SELECT payload FROM sync_outbox WHERE payload LIKE '%bootstrap%' ORDER BY sequence LIMIT 1").get().payload);
    const orphan={...op,id:randomUUID(),changes:op.changes.map((c)=>c.table==="inventory_movements"?{...c,key:randomUUID(),row:{...c.row,id:randomUUID(),product_id:randomUUID()}}:{...c,key:randomUUID(),row:{...c.row,id:randomUUID(),barcode:"99999"}})};
    for(const c of orphan.changes)c.key=c.row.id;
    const before=(await s.db.query("SELECT count(*)::text AS n FROM sync_entities")).rows[0].n;
    assert.equal((await s.app.inject({method:"POST",url:"/sync/operations",headers:{authorization:`Bearer ${a.token()}`},payload:orphan})).statusCode,409);
    assert.equal((await s.db.query("SELECT count(*)::text AS n FROM sync_entities")).rows[0].n,before,"fallo revierte también la escritura central del producto");
  } finally {a.db.close();b.db.close();await s.close();rmSync(directory,{recursive:true,force:true});}
});

test("fiado y abonos exigen conexión y reservas globales impiden exceder cupo o saldo",async()=>{
  const s=await server(),a=await register(s.app,"Caja A"),b=await register(s.app,"Caja B"),merchant=randomUUID();
  try {
    const product=a.catalog.createProduct({...productDraft,initialStock:"10"},a.user.id);
    const client=a.clients.create({name:"Comprador",documentType:"CC",documentNumber:"000123",email:null,creditLimitCop:"1500"},a.user.id);
    await setup(a,merchant);await setup(b,merchant);
    a.cash.openSession({openingCashCop:"0"},a.user.id);b.cash.openSession({openingCashCop:"0"},b.user.id);
    await a.sync.synchronize();await b.sync.synchronize();
    const input={items:[{productId:product.id,quantity:"1"}],clientId:client.id,settlement:"on_account"};
    a.network.online=false;
    await assert.rejects(a.sync.withCredit(a.user,client.id,()=>a.sales.quoteCredit(input),()=>a.sales.createSale(input,a.user.id)),/Sin conexión/);
    assert.equal(a.sales.listRecentSales().length,0);
    a.network.online=true;a.network.disconnectAfterReserve=true;
    const sale=await a.sync.withCredit(a.user,client.id,()=>a.sales.quoteCredit(input),()=>a.sales.createSale(input,a.user.id));
    await assert.rejects(a.sync.synchronize(),/Sin conexión/);
    await assert.rejects(b.sync.withCredit(b.user,client.id,()=>b.sales.quoteCredit(input),()=>b.sales.createSale(input,b.user.id)),/cupo disponible/);
    assert.equal(b.sales.listRecentSales().length,0);
    a.network.online=true;await a.sync.synchronize();await b.sync.synchronize();
    assert.equal(b.receivables.getAccount(client.id).balanceCop,"1200");
    assert.equal(b.sales.getSale(sale.id).settlement,"on_account");
    b.network.disconnectAfterReserve=true;
    const payment={clientId:client.id,amountCop:"1000",method:"cash"};
    await b.sync.withCredit(b.user,client.id,()=>"-1000",()=>b.receivables.recordPayment(payment,b.user.id));
    await assert.rejects(b.sync.synchronize(),/Sin conexión/);
    await assert.rejects(a.sync.withCredit(a.user,client.id,()=>"-1000",()=>a.receivables.recordPayment(payment,a.user.id)),/saldo o el cupo/);
    b.network.online=true;await b.sync.synchronize();await a.sync.synchronize();
    assert.equal(a.receivables.getAccount(client.id).balanceCop,"200");
    assert.equal(b.cash.overview().activeSession.cashCreditPaymentsCop,"1000");
    assert.equal(a.cash.overview().activeSession.cashCreditPaymentsCop,"0");
    await a.sync.synchronize();assert.equal(a.receivables.getAccount(client.id).entries.length,2);
  } finally {a.db.close();b.db.close();await s.close();}
});

test("API autentica cajas, aísla comercios y rechaza roles, secretos y reutilización de IDs",async()=>{
  const s=await server(),a=await register(s.app,"Caja A"),b=await register(s.app,"Otro comercio");
  try {
    const product=a.catalog.createProduct(productDraft,a.user.id);await setup(a,randomUUID());await setup(b,randomUUID());
    assert.equal(b.catalog.listProducts({query:"",includeInactive:true}).length,0);
    assert.equal((await s.app.inject({method:"GET",url:"/sync/events?after=0"})).statusCode,401);
    assert.equal((await s.app.inject({method:"GET",url:"/sync/events?after=0",headers:{authorization:"Bearer invalido"}})).statusCode,401);
    const op=JSON.parse(a.db.prepare("SELECT payload FROM sync_outbox LIMIT 1").get().payload);
    const response=await s.app.inject({method:"POST",url:"/sync/operations",headers:{authorization:`Bearer ${a.token()}`},payload:{...op,createdAt:"2027-01-01T00:00:00.000Z"}});
    assert.equal(response.statusCode,409);
    assert.equal((await s.app.inject({method:"POST",url:"/sync/operations",headers:{authorization:`Bearer ${a.token()}`},payload:{...op,id:randomUUID(),actor:{...actor(a),role:"admin_master"}}})).statusCode,400);
    assert.equal((await s.app.inject({method:"POST",url:"/sync/operations",headers:{authorization:`Bearer ${a.token()}`},payload:{...op,id:randomUUID(),password:"no debe viajar"}})).statusCode,400);
    assert.equal(a.catalog.listProducts({query:"",includeInactive:true})[0].id,product.id);
  } finally {a.db.close();b.db.close();await s.close();}
});
