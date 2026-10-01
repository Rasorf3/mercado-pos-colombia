import { useEffect, useState, type ReactElement } from "react";
import type { SyncStatus } from "@mercado-pos/contracts";
export function SyncStatusBar({onOpen}:{onOpen?:()=>void}):ReactElement|null {
  const [status,setStatus]=useState<SyncStatus|null>(null);
  useEffect(()=>{let active=true;const refresh=()=>void window.electronAPI.sync.status().then((s)=>{if(active)setStatus(s);}).catch(()=>{});refresh();const timer=window.setInterval(refresh,5000);return()=>{active=false;window.clearInterval(timer);};},[]);
  if(!status?.configured)return null;
  return <div className={`sync-status-bar ${status.connected?"connected":"disconnected"}`} role="status"><span>{status.deviceName} · {status.connected?"Servidor conectado":"Operando con datos locales"} · {status.pending} operaciones pendientes</span>{onOpen&&<button className="text-button" onClick={onOpen}>Sincronización{status.conflicts.some((c)=>!c.resolved)?" · Revisar incidencias":""}</button>}</div>;
}
