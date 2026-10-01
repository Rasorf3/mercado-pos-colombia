import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { SYNC_TABLES, type CreditReservation, type SyncChange, type SyncConflict, type SyncEvent, type SyncOperation, type SyncRow, type SyncTable, type SyncTableSpec } from "@mercado-pos/contracts";
import { canonicalJson, inventoryBalance, roleCan, validateSyncOperation } from "@mercado-pos/domain";
import type { SqlConnection, SyncDatabase } from "./database.js";

export interface DeviceIdentity { merchantId: string; deviceId: string; name: string; bootstrapAllowed: boolean }
export class SyncRequestError extends Error { statusCode: number; constructor(message: string, statusCode=409) { super(message); this.statusCode=statusCode; } }
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export class SyncStore {
  private database: SyncDatabase;
  private pairingHash: string;
  constructor(database: SyncDatabase, pairingKey: string) {
    if (pairingKey.length<32) throw new Error("La clave de vinculación del servidor debe tener al menos 32 caracteres.");
    this.database=database; this.pairingHash=digest(pairingKey);
  }

  async enroll(input: { merchantId:string; deviceId:string; deviceName:string; pairingKey:string; hasLocalData:boolean }) {
    if (!timingSafeEqual(Buffer.from(digest(input.pairingKey)),Buffer.from(this.pairingHash))) throw new SyncRequestError("La clave de vinculación no es válida.",401);
    return this.database.transaction(async (tx) => {
      await tx.query("INSERT INTO sync_merchants(id) VALUES($1) ON CONFLICT DO NOTHING",[input.merchantId]);
      const merchant=(await tx.query("SELECT seed_owner FROM sync_merchants WHERE id=$1 FOR UPDATE",[input.merchantId])).rows[0];
      const enrolled=(await tx.query("SELECT bootstrap_allowed FROM sync_devices WHERE merchant_id=$1 AND id=$2",[input.merchantId,input.deviceId])).rows[0];
      if(enrolled) {
        const token=randomBytes(32).toString("base64url");
        await tx.query("UPDATE sync_devices SET token_hash=$3,name=$4 WHERE merchant_id=$1 AND id=$2 AND active=true",[input.merchantId,input.deviceId,digest(token),input.deviceName.trim()]);
        return {token,deviceId:input.deviceId,merchantId:input.merchantId};
      }
      const hasData=(await tx.query("SELECT 1 FROM sync_entities WHERE merchant_id=$1 LIMIT 1",[input.merchantId])).rows.length>0;
      if (input.hasLocalData && (hasData || merchant.seed_owner)) throw new SyncRequestError("Vincula primero la instalación que conserva los datos. Las cajas adicionales deben empezar con una base vacía para evitar inventario duplicado.");
      if (input.hasLocalData) await tx.query("UPDATE sync_merchants SET seed_owner=$2 WHERE id=$1",[input.merchantId,input.deviceId]);
      const token=randomBytes(32).toString("base64url");
      await tx.query("INSERT INTO sync_devices(merchant_id,id,name,token_hash,bootstrap_allowed) VALUES($1,$2,$3,$4,$5)",[input.merchantId,input.deviceId,input.deviceName.trim(),digest(token),input.hasLocalData]);
      return { token,deviceId:input.deviceId,merchantId:input.merchantId };
    });
  }

  async authenticate(token: string): Promise<DeviceIdentity> {
    const row=(await this.database.query("SELECT merchant_id,id,name,bootstrap_allowed FROM sync_devices WHERE token_hash=$1 AND active=true",[digest(token)])).rows[0];
    if (!row) throw new SyncRequestError("La caja no está autorizada en este servidor.",401);
    return {merchantId:row.merchant_id,deviceId:row.id,name:row.name,bootstrapAllowed:row.bootstrap_allowed};
  }

  private async lock(tx: SqlConnection, device:DeviceIdentity): Promise<void> {
    await tx.query("SELECT id FROM sync_merchants WHERE id=$1 FOR UPDATE",[device.merchantId]);
    if (!(await tx.query("SELECT 1 FROM sync_devices WHERE merchant_id=$1 AND id=$2 AND active=true",[device.merchantId,device.deviceId])).rows.length) throw new SyncRequestError("Esta caja ha sido desactivada.",401);
  }

  async push(device:DeviceIdentity, operation:SyncOperation):Promise<SyncEvent> {
    try {validateSyncOperation(operation);} catch(error) {throw new SyncRequestError(error instanceof Error?error.message:"La operación no es válida.",422);}
    const requestHash=digest(canonicalJson(operation));
    return this.database.transaction(async(tx)=>{
      await this.lock(tx,device);
      const existing=(await tx.query("SELECT sequence::text,device_id,payload,request_hash FROM sync_events WHERE merchant_id=$1 AND operation_id=$2",[device.merchantId,operation.id])).rows[0];
      if (existing) {
        if (existing.device_id!==device.deviceId || existing.request_hash!==requestHash) throw new SyncRequestError("Un identificador de operación no puede reutilizarse con datos distintos.");
        return {sequence:existing.sequence,deviceId:existing.device_id,operation:existing.payload};
      }
      if (operation.kind==="bootstrap" && !device.bootstrapAllowed) throw new SyncRequestError("Esta caja no puede importar un historial inicial.",403);
      const changes:SyncChange[]=[];
      for (const change of operation.changes) {
        const current=await this.entity(tx,device,change.table,change.key);
        const spec:SyncTableSpec=SYNC_TABLES[change.table];
        if(current && change.table==="clients" && operation.kind==="client" && (!operation.actor || !roleCan(operation.actor.role,"clients:manage"))) throw new SyncRequestError("No tienes permiso para editar el perfil de otro cliente.",403);
        if(operation.kind==="credit_limit" && change.table==="clients" && (!current || Object.keys(change.row).some((field)=>!["credit_limit_cop","updated_at","updated_by_user_id"].includes(field) && current.data[field]!==change.row[field]))) throw new SyncRequestError("Cambiar el cupo no permite editar otros datos del cliente.",403);
        if (current && !spec.mutable) {
          if (canonicalJson(current.data)!==canonicalJson(change.row)) throw new SyncRequestError("No se puede modificar una operación histórica ya recibida.");
          continue;
        }
        if (change.table==="cash_sessions" && change.row.origin_device_id!==device.deviceId) throw new SyncRequestError("No se puede modificar el turno de otra caja.",403);
        if (current && change.table==="cash_sessions" && (current.data.status!=="open" || change.row.status!=="closed")) throw new SyncRequestError("El cierre de caja ya está congelado.");
        if (current && current.head!==change.baseId && operation.kind!=="bootstrap") {
          await this.conflict(tx,device,change,"Otro equipo modificó este registro. Se conservó la versión del servidor; revisa los datos antes de reaplicar el cambio.");
          changes.push({...change,row:current.data,headId:current.head});
          continue;
        }
        const row={...change.row};
        if (change.table==="products" && row.barcode!==null) {
          const duplicate=(await tx.query("SELECT row_key FROM sync_entities WHERE merchant_id=$1 AND table_name='products' AND data->>'barcode'=$2 AND row_key!=$3",[device.merchantId,row.barcode,change.key])).rows[0];
          if (duplicate) { await this.conflict(tx,device,change,"Código de barras creado en dos cajas. Se conservan ambos productos y sus ventas; corrige el código del producto señalado."); row.barcode=null; }
        }
        if (change.table==="clients" && row.document_type!==null) {
          const duplicate=(await tx.query("SELECT row_key FROM sync_entities WHERE merchant_id=$1 AND table_name='clients' AND lower(data->>'document_type')=lower($2) AND lower(data->>'document_number')=lower($3) AND row_key!=$4",[device.merchantId,row.document_type,row.document_number,change.key])).rows[0];
          if (duplicate) { await this.conflict(tx,device,change,"Identificación creada en dos cajas. Se conservaron los perfiles y compradores históricos; revisa el perfil sin identificación."); row.document_type=null;row.document_number=null; }
        }
        if(change.table==="clients") {
          try {await this.validateLimit(tx,device,change.key,BigInt(row.credit_limit_cop!));}
          catch(error) {
            if(!current || !(error instanceof SyncRequestError))throw error;
            await this.conflict(tx,device,change,error.message+" Se conservó el cupo central; revisa la solicitud local.");
            changes.push({...change,row:current.data,headId:current.head});
            continue;
          }
        }
        await tx.query("INSERT INTO sync_entities(merchant_id,table_name,row_key,data,head,source_device_id) VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT(merchant_id,table_name,row_key) DO UPDATE SET data=excluded.data,head=excluded.head,source_device_id=excluded.source_device_id",[device.merchantId,change.table,change.key,JSON.stringify(row),operation.id,device.deviceId]);
        changes.push({...change,row,headId:operation.id});
      }
      await this.validateReferences(tx,device,changes,operation.kind==="bootstrap");
      for(const productId of new Set(changes.filter((c)=>c.table==="inventory_movements").map((c)=>c.row.product_id!))) {
        const total=(await tx.query("SELECT COALESCE(SUM((data->>'quantity_milli')::numeric),0)::text AS quantity FROM sync_entities WHERE merchant_id=$1 AND table_name='inventory_movements' AND data->>'product_id'=$2",[device.merchantId,productId])).rows[0];
        try {inventoryBalance([total.quantity]);} catch {throw new SyncRequestError("La existencia consolidada excede el límite permitido.",422);}
      }
      const ledger=operation.changes.filter((c)=>c.table==="client_credit_entries");
      if (ledger.length && operation.kind!=="bootstrap") {
        const reservation=(await tx.query("SELECT client_id,delta_cop::text,state FROM sync_credit_reservations WHERE merchant_id=$1 AND id=$2 AND device_id=$3 FOR UPDATE",[device.merchantId,operation.creditReservationId,device.deviceId])).rows[0];
        const delta=ledger.reduce((sum,c)=>sum+(c.row.entry_type==="sale_charge"?1n:-1n)*BigInt(c.row.amount_cop!),0n);
        if (!reservation || reservation.state!=="reserved" || BigInt(reservation.delta_cop)!==delta || ledger.some((c)=>c.row.client_id!==reservation.client_id)) throw new SyncRequestError("La operación de cartera no tiene una autorización vigente del servidor.");
        await tx.query("UPDATE sync_credit_reservations SET state='consumed' WHERE merchant_id=$1 AND id=$2",[device.merchantId,operation.creditReservationId]);
      }
      const canonical={...operation,changes};
      const event=(await tx.query("INSERT INTO sync_events(merchant_id,operation_id,device_id,request_hash,payload) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING sequence::text",[device.merchantId,operation.id,device.deviceId,requestHash,JSON.stringify(canonical)])).rows[0];
      return {sequence:event.sequence,deviceId:device.deviceId,operation:canonical};
    });
  }

  async pull(device:DeviceIdentity,after:string):Promise<{events:SyncEvent[];cursor:string;more:boolean}> {
    const rows=(await this.database.query("SELECT sequence::text,device_id,payload FROM sync_events WHERE merchant_id=$1 AND sequence>$2::bigint ORDER BY sequence LIMIT 101",[device.merchantId,after])).rows;
    const events=rows.slice(0,100).map((r)=>({sequence:r.sequence,deviceId:r.device_id,operation:r.payload}));
    return {events,cursor:events.at(-1)?.sequence??after,more:rows.length>100};
  }

  async reserveCredit(device:DeviceIdentity,input:CreditReservation):Promise<{id:string}> {
    if (!roleCan(input.actor.role,"credit:collect")) throw new SyncRequestError("No tienes permiso para gestionar cartera.",403);
    return this.database.transaction(async(tx)=>{
      await this.lock(tx,device);
      const existing=(await tx.query("SELECT device_id,client_id,delta_cop::text,state FROM sync_credit_reservations WHERE merchant_id=$1 AND id=$2",[device.merchantId,input.id])).rows[0];
      if (existing) {
        if (existing.device_id!==device.deviceId || existing.client_id!==input.clientId || existing.delta_cop!==input.deltaCop || existing.state!=="reserved") throw new SyncRequestError("La autorización de cartera ya se utilizó o cambió.");
        return {id:input.id};
      }
      const client=await this.entity(tx,device,"clients",input.clientId);
      if (!client || client.data.active!=="1") throw new SyncRequestError("Sincroniza un cliente activo antes de registrar fiados o abonos.");
      const balance=await this.creditBalance(tx,device,input.clientId);
      const delta=BigInt(input.deltaCop);
      const pending=(await tx.query("SELECT COALESCE(SUM(CASE WHEN ($3::bigint>0 AND delta_cop>0) OR ($3::bigint<0 AND delta_cop<0) THEN delta_cop ELSE 0 END),0)::text AS amount FROM sync_credit_reservations WHERE merchant_id=$1 AND client_id=$2 AND state='reserved'",[device.merchantId,input.clientId,input.deltaCop])).rows[0];
      const projected=balance+BigInt(pending.amount)+delta;
      if (projected<0n || projected>BigInt(client.data.credit_limit_cop!)) throw new SyncRequestError("La operación supera el saldo o el cupo disponible, incluyendo operaciones pendientes de otras cajas.");
      await tx.query("INSERT INTO sync_credit_reservations(merchant_id,id,device_id,client_id,delta_cop,state) VALUES($1,$2,$3,$4,$5::bigint,'reserved')",[device.merchantId,input.id,device.deviceId,input.clientId,input.deltaCop]);
      return {id:input.id};
    });
  }

  async cancelCredit(device:DeviceIdentity,id:string):Promise<void> {
    await this.database.transaction(async(tx)=>{await this.lock(tx,device);await tx.query("UPDATE sync_credit_reservations SET state='cancelled' WHERE merchant_id=$1 AND id=$2 AND device_id=$3 AND state='reserved'",[device.merchantId,id,device.deviceId]);});
  }

  async conflicts(device:DeviceIdentity):Promise<SyncConflict[]> {
    const data=(await this.database.query("SELECT id,payload,resolved FROM sync_data_conflicts WHERE merchant_id=$1 ORDER BY id",[device.merchantId])).rows.map((r)=>({...r.payload,id:r.id,resolved:r.resolved}));
    const inventory=(await this.database.query("SELECT data->>'product_id' AS id, SUM((data->>'quantity_milli')::numeric)::text AS quantity FROM sync_entities WHERE merchant_id=$1 AND table_name='inventory_movements' GROUP BY data->>'product_id' HAVING SUM((data->>'quantity_milli')::numeric)<0",[device.merchantId])).rows;
    for (const r of inventory) {
      const product=await this.entity(this.database,device,"products",r.id);
      data.push({id:`stock:${r.id}`,kind:"stock_shortage",entityId:r.id,label:product?.data.name??r.id,quantityMilli:(-BigInt(r.quantity)).toString(),message:"Las ventas de varias cajas superaron la existencia registrada. Cuenta físicamente el producto y registra la conciliación.",resolved:false});
    }
    return data;
  }

  async reviewConflict(device:DeviceIdentity,id:string,actor:SyncOperation["actor"],note:string):Promise<void> {
    if (!actor || !roleCan(actor.role,"sync:manage")) throw new SyncRequestError("Solo Admin puede revisar incidencias.",403);
    await this.database.query("UPDATE sync_data_conflicts SET resolved=true,reviewed_by=$3::jsonb,review_note=$4 WHERE merchant_id=$1 AND id=$2",[device.merchantId,id,JSON.stringify(actor),note]);
  }

  private async entity(tx:SqlConnection,device:DeviceIdentity,table:SyncTable,key:string) { return (await tx.query("SELECT data,head,source_device_id FROM sync_entities WHERE merchant_id=$1 AND table_name=$2 AND row_key=$3",[device.merchantId,table,key])).rows[0] as {data:SyncRow;head:string;source_device_id:string}|undefined; }
  private async creditBalance(tx:SqlConnection,device:DeviceIdentity,id:string):Promise<bigint> { const r=(await tx.query("SELECT COALESCE(SUM(CASE WHEN data->>'entry_type'='sale_charge' THEN (data->>'amount_cop')::numeric ELSE -(data->>'amount_cop')::numeric END),0)::text AS amount FROM sync_entities WHERE merchant_id=$1 AND table_name='client_credit_entries' AND data->>'client_id'=$2",[device.merchantId,id])).rows[0];return BigInt(r.amount); }
  private async validateLimit(tx:SqlConnection,device:DeviceIdentity,id:string,limit:bigint) { const pending=(await tx.query("SELECT COALESCE(SUM(CASE WHEN delta_cop>0 THEN delta_cop ELSE 0 END),0)::text AS amount FROM sync_credit_reservations WHERE merchant_id=$1 AND client_id=$2 AND state='reserved'",[device.merchantId,id])).rows[0];if(limit<await this.creditBalance(tx,device,id)+BigInt(pending.amount)) throw new SyncRequestError("El cupo no puede quedar por debajo del saldo y de las autorizaciones pendientes."); }
  private async conflict(tx:SqlConnection,device:DeviceIdentity,change:SyncChange,message:string) { const payload:SyncConflict={id:randomUUID(),kind:"data_conflict",entityId:change.key,label:change.row.name??change.key,quantityMilli:null,message,resolved:false,proposed:change};await tx.query("INSERT INTO sync_data_conflicts(id,merchant_id,entity_id,payload) VALUES($1,$2,$3,$4::jsonb)",[payload.id,device.merchantId,change.key,JSON.stringify(payload)]); }
  private async validateReferences(tx:SqlConnection,device:DeviceIdentity,changes:SyncChange[],bootstrap:boolean) {
    const refs:Record<string,SyncTable>={product_id:"products",client_id:"clients",sale_id:"sales",cash_session_id:"cash_sessions"};
    for(const c of changes) for(const [field,table] of Object.entries(refs)) {
      const id=c.row[field];if(!id)continue;
      const referenced=await this.entity(tx,device,table,id);
      if(!referenced)throw new SyncRequestError("La operación tiene una referencia pendiente de sincronizar.");
      if(!bootstrap && field==="cash_session_id" && ["sales","client_credit_entries"].includes(c.table) && (referenced.data.origin_device_id!==device.deviceId || referenced.data.status!=="open"))throw new SyncRequestError("La operación requiere un turno abierto de su propia caja.",403);
    }
  }
}
