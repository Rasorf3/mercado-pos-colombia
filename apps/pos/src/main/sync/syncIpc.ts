import { ipcMain } from "electron";
import { Value } from "@sinclair/typebox/value";
import { StockReconciliationSchema, SyncSetupSchema, UserIdSchema } from "@mercado-pos/contracts";
import { roleCan } from "@mercado-pos/domain";
import { SYNC_CHANNELS } from "../../syncBridge.ts";
import { trustedSessionUser } from "../auth/authIpc.ts";
import type { AuthService } from "../auth/authService.ts";
import type { SyncService } from "./syncService.ts";
import type { SyncSetup } from "@mercado-pos/contracts";

export function registerSyncIpc(service:SyncService,getWindow:()=>Electron.BrowserWindow|null,auth:AuthService):void {
  for(const channel of Object.values(SYNC_CHANNELS))ipcMain.removeHandler(channel);
  ipcMain.handle(SYNC_CHANNELS.status,(event)=>{const user=trustedSessionUser(auth,event,getWindow(),"sync:status");return service.status(roleCan(user.role,"sync:manage"));});
  ipcMain.handle(SYNC_CHANNELS.setup,(event,input:unknown)=>{trustedSessionUser(auth,event,getWindow(),"sync:manage");if(!Value.Check(SyncSetupSchema as never,input))throw new Error("Revisa los datos para vincular esta caja.");return service.setup(input as SyncSetup);});
  ipcMain.handle(SYNC_CHANNELS.run,async(event)=>{trustedSessionUser(auth,event,getWindow(),"sync:manage");await service.synchronize();return service.status();});
  ipcMain.handle(SYNC_CHANNELS.reconcileStock,(event,input:unknown)=>{const user=trustedSessionUser(auth,event,getWindow(),"sync:manage");if(!Value.Check(StockReconciliationSchema as never,input))throw new Error("Ingresa el producto, el conteo físico y el motivo.");const data=input as {productId:string;countedQuantity:string;note:string};return service.reconcileStock(user,data.productId,data.countedQuantity,data.note);});
  ipcMain.handle(SYNC_CHANNELS.reviewConflict,(event,input:unknown)=>{
    const user=trustedSessionUser(auth,event,getWindow(),"sync:manage");
    if(!input || typeof input!=="object" || Object.keys(input).sort().join(",")!=="id,note")throw new Error("Revisa la incidencia y el motivo de revisión.");
    const data=input as {id:string;note:string};
    if(!Value.Check(UserIdSchema as never,data.id) || typeof data.note!=="string" || data.note.trim().length<3 || data.note.length>240)throw new Error("Revisa la incidencia y el motivo de revisión.");
    return service.reviewConflict(user,data.id,data.note.trim());
  });
}
