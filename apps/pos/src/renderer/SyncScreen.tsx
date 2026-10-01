import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import type { SyncConflict, SyncStatus } from "@mercado-pos/contracts";
import { UserErrorNotice } from "./UserErrorNotice";
import { userFacingError } from "./userFacingError";

export function SyncScreen({onOpenCatalog,onOpenClients}:{onOpenCatalog:()=>void;onOpenClients:()=>void}):ReactElement {
  const [status,setStatus]=useState<SyncStatus|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[recover,setRecover]=useState(false);
  const [serverUrl,setServerUrl]=useState(""),[merchantId,setMerchantId]=useState(""),[deviceName,setDeviceName]=useState(""),[pairingKey,setPairingKey]=useState("");
  useEffect(()=>{let active=true;void window.electronAPI.sync.status().then((s)=>{if(active){setStatus(s);setServerUrl(s.serverUrl??"");setDeviceName(s.deviceName??"");}}).catch((e)=>{if(active)setError(userFacingError(e,"No se pudo consultar la sincronización."));});return()=>{active=false;};},[]);
  const run=async(action:()=>Promise<SyncStatus>)=>{setBusy(true);setError("");try{setStatus(await action());}catch(e){setError(userFacingError(e,"No se pudo completar la sincronización. Tus ventas guardadas se conservan."));setStatus(await window.electronAPI.sync.status());}finally{setBusy(false);}};
  const setup=(e:FormEvent)=>{e.preventDefault();void run(async()=>{try{return await window.electronAPI.sync.setup({serverUrl,merchantId,deviceName,pairingKey});}finally{setPairingKey("");setRecover(false);}});};
  const incidents=status?.conflicts.filter((c)=>!c.resolved)??[];
  return <section className="sync-page" aria-labelledby="sync-title">
    <div className="page-heading"><div><p className="eyebrow">Administración de cajas</p><h1 id="sync-title">Sincronización y conciliación</h1><p className="subheading">Ventas locales conservadas en cada equipo y reunidas al recuperar la conexión.</p></div></div>
    {error&&<UserErrorNotice message={error}/>}
    {!status?<p role="status">Consultando esta caja…</p>:<>
      <div className="sync-summary"><div><span>Estado</span><strong>{!status.configured?"Sin vincular":status.connected?"Conectada":"Sin conexión / pendiente"}</strong></div><div><span>Operaciones por enviar</span><strong>{status.pending}</strong></div><div><span>Incidencias por revisar</span><strong>{incidents.length}</strong></div><div><span>Última sincronización</span><strong>{status.lastSyncAt?new Date(status.lastSyncAt).toLocaleString("es-CO"):"Todavía no registrada"}</strong></div></div>
      <p className="company-info-note" role="status">{status.message}</p>
      {status.configured&&<div className="sync-toolbar"><button className="primary-button" disabled={busy} onClick={()=>void run(()=>window.electronAPI.sync.run())}>{busy?"Sincronizando…":"Sincronizar ahora"}</button><button className="text-button" onClick={()=>setRecover(!recover)}>Recuperar credencial del mismo vínculo</button></div>}
      {(!status.configured||recover)&&<form className="company-card sync-setup" onSubmit={setup}>
        <h2>{recover?"Recuperar el vínculo de esta instalación":"Vincular esta caja al comercio"}</h2>
        <p>Vincula primero la instalación que tiene los datos. Las cajas adicionales deben partir de una base vacía. Cada computador necesita su propia instalación e identidad.</p>
        <div className="company-fields"><label className="field">Servidor<input required type="url" maxLength={300} value={serverUrl} onChange={(e)=>setServerUrl(e.target.value)} placeholder="https://servidor-del-comercio"/></label><label className="field">Identificador del comercio<input required value={merchantId} maxLength={36} onChange={(e)=>setMerchantId(e.target.value)} placeholder="UUID definido al preparar el servidor"/></label><label className="field">Nombre de esta caja<input required maxLength={64} value={deviceName} onChange={(e)=>setDeviceName(e.target.value)} placeholder="Caja 1"/></label><label className="field">Clave de vinculación<input required type="password" minLength={32} maxLength={256} autoComplete="off" value={pairingKey} onChange={(e)=>setPairingKey(e.target.value)}/><small>Se usa para autorizar el equipo y no se conserva en este formulario.</small></label></div>
        <p>Identidad de la instalación: <code>{status.deviceId}</code></p><button className="primary-button" disabled={busy}>{busy?"Vinculando…":"Vincular esta caja"}</button>
      </form>}
      {status.configured&&<><h2>Incidencias</h2><p>Un faltante no elimina las ventas ni sus pagos. Concílialo después de que todas las cajas hayan enviado sus operaciones. Los cambios de catálogo o clientes que compiten se conservan para revisión.</p>{incidents.length===0?<p className="company-empty">No hay incidencias detectadas en la última sincronización.</p>:<div className="sync-incidents">{incidents.map((c)=><ConflictCard key={c.id} conflict={c} busy={busy} onOpenRecord={c.proposed?.table==="clients"?onOpenClients:onOpenCatalog} onSubmit={(count,note)=>run(()=>c.kind==="stock_shortage"?window.electronAPI.sync.reconcileStock({productId:c.entityId,countedQuantity:count,note}):window.electronAPI.sync.reviewConflict({id:c.id,note}))}/>)}</div>}</>}
      <p className="sync-footnote">Los turnos de caja permanecen separados por equipo. Una caída permite ventas pagadas con los datos locales; los fiados y abonos compartidos requieren autorización del servidor. La sincronización no emite facturas electrónicas.</p>
    </>}
  </section>;
}

function ConflictCard({conflict:c,busy,onSubmit,onOpenRecord}:{conflict:SyncConflict;busy:boolean;onSubmit:(count:string,note:string)=>Promise<void>;onOpenRecord:()=>void}):ReactElement {
  const [count,setCount]=useState(""),[note,setNote]=useState(""),[confirmed,setConfirmed]=useState(false);
  const shortage=c.quantityMilli ? `${BigInt(c.quantityMilli)/1000n}${BigInt(c.quantityMilli)%1000n?","+(BigInt(c.quantityMilli)%1000n).toString().padStart(3,"0"):""}` : "";
  const labels:Record<string,string>={name:"Nombre propuesto",internal_code:"Código interno",barcode:"Código de barras",cost_cop:"Costo COP",sale_price_cop:"Precio COP",unit:"Unidad",active:"Activo (1 sí / 0 no)",document_type:"Tipo de identificación",document_number:"Identificación",email:"Correo",phone:"Teléfono",address:"Dirección",credit_limit_cop:"Cupo COP"};
  return <form className="company-card sync-conflict" onSubmit={(e)=>{e.preventDefault();void onSubmit(count,note);}}>
    <h3>{c.label}</h3><p>{c.message}</p>
    {c.kind==="stock_shortage"&&<>
      <p className="sync-shortage">Faltante registrado: {shortage} unidades de medida del producto.</p>
      <label className="field">Existencia física contada<input required inputMode="decimal" value={count} onChange={(e)=>setCount(e.target.value)} placeholder="Cantidad real, hasta tres decimales"/></label>
      <label className="inactive-toggle"><input required type="checkbox" checked={confirmed} onChange={(e)=>setConfirmed(e.target.checked)}/> Confirmé que las demás cajas enviaron sus ventas pendientes y realicé el conteo físico.</label>
    </>}
    {c.kind==="data_conflict"&&<>
      {c.proposed&&<details><summary>Datos propuestos que requieren revisión</summary><dl>{Object.entries(labels).filter(([key])=>key in c.proposed!.row).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{c.proposed!.row[key]??"Sin dato"}</dd></div>)}</dl></details>}
      <button type="button" className="text-button" onClick={onOpenRecord}>Abrir {c.proposed?.table==="clients"?"clientes":"catálogo"} para revisar</button>
    </>}
    <label className="field">{c.kind==="stock_shortage"?"Motivo de la conciliación":"Resultado de la revisión"}<input required minLength={3} maxLength={140} value={note} onChange={(e)=>setNote(e.target.value)}/></label>
    <button className="primary-button" disabled={busy||c.kind==="stock_shortage"&&!confirmed}>{c.kind==="stock_shortage"?"Registrar conciliación":"Marcar como revisada"}</button>
  </form>;
}
