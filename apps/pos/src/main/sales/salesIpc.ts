import { ipcMain } from "electron";
import type { SalesService } from "./salesService";
import type { ReceiptService } from "../receipts/receiptService";
import { createSalesHandlers } from "./salesHandlers";

export function registerSalesIpc(
  service: SalesService,
  receipts: ReceiptService,
  getWindow: () => Electron.BrowserWindow | null
): void {
  for (const [channel, handler] of Object.entries(createSalesHandlers(service, receipts, getWindow))) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
  }
}
