import type { SyncSetup, SyncStatus } from "@mercado-pos/contracts";
export const SYNC_CHANNELS={status:"sync:status",setup:"sync:setup",run:"sync:run",reconcileStock:"sync:reconcile-stock",reviewConflict:"sync:review-conflict"} as const;
export interface SyncBridge {
  status():Promise<SyncStatus>;
  setup(input:SyncSetup):Promise<SyncStatus>;
  run():Promise<SyncStatus>;
  reconcileStock(input:{productId:string;countedQuantity:string;note:string}):Promise<SyncStatus>;
  reviewConflict(input:{id:string;note:string}):Promise<SyncStatus>;
}
