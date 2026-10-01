import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { SyncConflictSchema, type SyncConflict, type SyncEvent, type SyncOperation, type SyncSetup, type SyncStatus, type User } from "@mercado-pos/contracts";
import { Value } from "@sinclair/typebox/value";
import { formatQuantityMilli, parseQuantityMilli, roleCan } from "@mercado-pos/domain";
import type { CredentialVault } from "./credentialVault.ts";
import { applySyncEvent } from "./syncImporter.ts";
import { seedExistingDatabase, settings, signedStock, withCreditPermit } from "./syncJournal.ts";
import { CatalogService } from "../catalog/catalogService.ts";
import { retainPreEnrollmentBackup } from "../database/migrationBackup.ts";

export type SyncTransport=(url:string,init:RequestInit)=>Promise<Response>;
export class SyncService {
  private database:Database.Database;
  private vault:CredentialVault;
  private transport:SyncTransport;
  private connected=false;
  private message="Sincronización aún no configurada.";
  private running:Promise<void>|null=null;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private stopped=true;
  private retryDelay=15000;
  private activeIntents=new Set<string>();
  constructor(database:Database.Database,vault:CredentialVault,transport:SyncTransport=fetch) {this.database=database;this.vault=vault;this.transport=transport;}

  status(showConflicts=true):SyncStatus {
    const s=settings(this.database);
    const count=this.database.prepare("SELECT count(*) AS n FROM sync_outbox WHERE acknowledged=0").get() as {n:bigint};
    const conflicts=showConflicts ? (this.database.prepare("SELECT payload FROM sync_conflicts").all() as Array<{payload:string}>).map((r)=>JSON.parse(r.payload) as SyncConflict) : [];
    return {configured:s.enabled===1n,deviceId:s.device_id,deviceName:s.device_name,serverUrl:showConflicts?s.server_url:null,connected:this.connected,pending:Number(count.n),lastSyncAt:s.last_sync_at,message:this.message,conflicts};
  }

  async setup(input:SyncSetup):Promise<SyncStatus> {
    const s=settings(this.database),url=validateServerUrl(input.serverUrl);
    if(s.enabled===1n && (s.merchant_id!==input.merchantId || s.server_url!==url)) throw new Error("Esta caja ya pertenece a un comercio. No se puede cambiar el vínculo con operaciones existentes.");
    if(s.enabled!==1n)retainPreEnrollmentBackup(this.database);
    const hasLocalData=!!this.database.prepare("SELECT 1 FROM products UNION ALL SELECT 1 FROM clients UNION ALL SELECT 1 FROM sales LIMIT 1").get();
    const response=await this.send(url,"/sync/enroll",{method:"POST",body:JSON.stringify({merchantId:input.merchantId,deviceId:s.device_id,deviceName:input.deviceName.trim(),pairingKey:input.pairingKey,hasLocalData})},null) as {token:string;deviceId:string;merchantId:string};
    if(!/^[A-Za-z0-9_-]{43}$/.test(response.token) || response.deviceId!==s.device_id || response.merchantId!==input.merchantId) throw new Error("El servidor devolvió un vínculo inválido.");
    this.vault.write(response.token);
    this.database.transaction(()=>{
      if(s.enabled!==1n) seedExistingDatabase(this.database);
      this.database.prepare("UPDATE sync_settings SET merchant_id=?,server_url=?,device_name=?,enabled=1 WHERE id=1").run(input.merchantId,url,input.deviceName.trim());
    }).immediate();
    await this.synchronize();return this.status();
  }

  synchronize():Promise<void> {
    if(this.running)return this.running;
    this.running=this.exchange().finally(()=>{this.running=null;});return this.running;
  }

  private async exchange():Promise<void> {
    if(settings(this.database).enabled!==1n)return;
    try {
      await this.recoverCreditIntents();
      for(;;) {
        const next=this.database.prepare("SELECT operation_id,payload FROM sync_outbox WHERE acknowledged=0 ORDER BY sequence LIMIT 1").get() as {operation_id:string;payload:string}|undefined;
        if(!next)break;
        const event=await this.request("/sync/operations",{method:"POST",body:next.payload}) as SyncEvent;
        // Apply canonical corrections before downloading other devices' rows.
        // Otherwise an offline duplicate barcode could block SQLite's UNIQUE
        // constraint before the server gets the opportunity to reconcile it.
        this.database.transaction(()=>{
          if(event.operation?.id!==next.operation_id)throw new Error("El servidor confirmó una operación distinta.");
          applySyncEvent(this.database,event);
          this.database.prepare("UPDATE sync_outbox SET acknowledged=1 WHERE operation_id=?").run(next.operation_id);
        }).immediate();
      }
      await this.pull();
      const result=await this.request("/sync/conflicts",{method:"GET"}) as {conflicts:SyncConflict[]};
      if(!Array.isArray(result.conflicts)) throw new Error("El servidor devolvió incidencias inválidas.");
      this.database.transaction(()=>{
        this.database.prepare("DELETE FROM sync_conflicts").run();
        for(const c of result.conflicts) {
          if(!(Value.Check(SyncConflictSchema as never,c) as boolean))throw new Error("El servidor devolvió una incidencia inválida.");
          const narrowed={id:c.id,kind:c.kind,entityId:c.entityId,label:c.label,quantityMilli:c.quantityMilli,message:c.message,resolved:c.resolved,...(c.proposed?{proposed:c.proposed}:{})};
          this.database.prepare("INSERT INTO sync_conflicts VALUES(?,?)").run(c.id,JSON.stringify(narrowed));
        }
        this.database.prepare("UPDATE sync_settings SET last_sync_at=? WHERE id=1").run(new Date().toISOString());
        this.database.prepare("DELETE FROM sync_credit_intents WHERE committed=1 AND operation_id IN(SELECT operation_id FROM sync_outbox WHERE acknowledged=1)").run();
      }).immediate();
      this.connected=true;this.retryDelay=15000;this.message="Datos sincronizados. Las ventas siguen pendientes de facturación electrónica.";
    } catch(error) {
      this.connected=false;this.retryDelay=Math.min(this.retryDelay*2,60000);
      this.message=error instanceof Error?error.message:"No se pudo sincronizar. Las ventas guardadas permanecen en este equipo.";
      throw new Error(this.message);
    }
  }

  private async pull():Promise<void> {
    for(;;) {
      const s=settings(this.database);
      const page=await this.request(`/sync/events?after=${s.cursor}`,{method:"GET"}) as {events:SyncEvent[];cursor:string;more:boolean};
      if(!Array.isArray(page.events) || !/^(0|[1-9][0-9]*)$/.test(page.cursor) || BigInt(page.cursor)<BigInt(s.cursor)) throw new Error("El servidor devolvió una página de sincronización inválida.");
      this.database.transaction(()=>{
        for(const event of page.events) applySyncEvent(this.database,event);
        this.database.prepare("UPDATE sync_settings SET cursor=? WHERE id=1").run(page.cursor);
      }).immediate();
      if(!page.more)return;
    }
  }

  async withCredit<T>(user:User,clientId:string,delta:()=>string,action:()=>T):Promise<T> {
    if(settings(this.database).enabled!==1n)return action();
    await this.synchronize();
    const id=randomUUID(),deltaCop=delta();
    this.activeIntents.add(id);
    this.database.prepare("INSERT INTO sync_credit_intents(id,client_id,delta_cop) VALUES(?,?,?)").run(id,clientId,deltaCop);
    try {
      await this.request("/sync/credit-reservations",{method:"POST",body:JSON.stringify({id,clientId,deltaCop,actor:actor(user)})});
      // No asynchronous work is allowed between the permit and the local commit.
      const result=withCreditPermit(this.database,{id,clientId,deltaCop},action);
      // The committed operation remains valid if the network drops now. Its
      // reservation is retained until the server receives the same event ID.
      void this.synchronize().catch(()=>{});
      return result;
    } catch(error) {
      const intent=this.database.prepare("SELECT committed FROM sync_credit_intents WHERE id=?").get(id) as {committed:bigint}|undefined;
      if(intent?.committed===0n) {
        try {await this.request(`/sync/credit-reservations/${id}`,{method:"DELETE"});this.database.prepare("DELETE FROM sync_credit_intents WHERE id=?").run(id);} catch { /* retained for safe recovery */ }
      }
      throw new Error(error instanceof Error?error.message:"Se necesita conexión con el servidor para registrar fiados o abonos compartidos.");
    } finally {this.activeIntents.delete(id);}
  }

  async reconcileStock(user:User,productId:string,countedQuantity:string,note:string):Promise<SyncStatus> {
    if(!roleCan(user.role,"sync:manage"))throw new Error("Solo Admin puede conciliar faltantes.");
    await this.synchronize();
    const counted=parseQuantityMilli(countedQuantity),signed=signedStock(this.database,productId),delta=counted-signed;
    if(delta===0n)throw new Error("El conteo coincide con la existencia registrada; no hay ajuste que guardar.");
    new CatalogService(this.database).recordAdjustment({productId,delta:formatQuantityMilli(delta),note:`Conciliación: físico ${formatQuantityMilli(counted)}; saldo ${formatQuantityMilli(signed)}. ${note.trim()}`},user.id);
    try {await this.synchronize();} catch {this.message="El ajuste quedó guardado en esta caja y pendiente de envío. No repitas el conteo para reenviarlo; usa Sincronizar.";}
    return this.status();
  }

  async reviewConflict(user:User,id:string,note:string):Promise<SyncStatus> {
    await this.request(`/sync/conflicts/${id}/review`,{method:"POST",body:JSON.stringify({actor:actor(user),note})});
    await this.synchronize();return this.status();
  }

  private async recoverCreditIntents():Promise<void> {
    const rows=this.database.prepare("SELECT id FROM sync_credit_intents WHERE committed=0").all() as Array<{id:string}>;
    for(const row of rows) {if(this.activeIntents.has(row.id))continue;await this.request(`/sync/credit-reservations/${row.id}`,{method:"DELETE"});this.database.prepare("DELETE FROM sync_credit_intents WHERE id=? AND committed=0").run(row.id);}
  }

  async requireOnline<T>(action:()=>T):Promise<T> {if(settings(this.database).enabled===1n)await this.synchronize();return action();}
  start():void {this.stopped=false;this.schedule();}
  stop():void {this.stopped=true;if(this.timer)clearTimeout(this.timer);}
  private schedule():void {if(this.stopped)return;this.timer=setTimeout(()=>{void this.synchronize().catch(()=>{}).finally(()=>this.schedule());},this.retryDelay);this.timer.unref();}
  private async request(path:string,init:RequestInit):Promise<unknown> {
    const s=settings(this.database),token=this.vault.read();
    if(!s.server_url || !token)throw new Error("Se necesita recuperar el vínculo de esta caja con el servidor.");
    return this.send(s.server_url,path,init,token);
  }
  private async send(url:string,path:string,init:RequestInit,token:string|null):Promise<unknown> {
    let response:Response;
    try {response=await this.transport(`${url}${path}`,{...init,headers:{...(init.body!==undefined?{"content-type":"application/json"}:{}),...(token?{authorization:`Bearer ${token}`}:{})},signal:AbortSignal.timeout(5000),redirect:"error"});}
    catch {throw new Error("Sin conexión con el servidor. Puedes continuar con ventas pagadas; los fiados y abonos compartidos esperan a recuperar la conexión.");}
    const text=await response.text();if(text.length>16*1024*1024)throw new Error("La respuesta del servidor excede el límite permitido.");
    let body:unknown;try{body=JSON.parse(text);}catch{throw new Error("El servidor no devolvió una respuesta válida.");}
    if(!response.ok)throw new Error((body as {message?:string})?.message?.slice(0,500)??"No se pudo completar la sincronización.");
    return body;
  }
}

function actor(user:User):SyncOperation["actor"] {return {id:user.id,username:user.username,role:user.role==="admin_master"?"admin":user.role};}
export function validateServerUrl(value:string):string {
  const url=new URL(value.trim());
  if(url.username || url.password || url.search || url.hash || (url.pathname!=="/" && url.pathname!==""))throw new Error("Ingresa solo la dirección del servidor, sin credenciales ni rutas.");
  if(url.protocol!=="https:" && !(url.protocol==="http:" && ["localhost","127.0.0.1","[::1]"].includes(url.hostname)))throw new Error("Usa HTTPS para conectar cajas por la red. HTTP solo se admite en este computador para pruebas.");
  return url.origin;
}
