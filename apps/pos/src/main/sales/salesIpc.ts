import { ipcMain } from "electron";
import type { SalesService } from "./salesService";
import type { ReceiptService } from "../receipts/receiptService";
import { createSalesHandlers } from "./salesHandlers";
import type { AuthService } from "../auth/authService";

export function registerSalesIpc(
  service: SalesService,
  receipts: ReceiptService,
  getWindow: () => Electron.BrowserWindow | null,
  auth: AuthService
): void {
  for (const [channel, handler] of Object.entries(createSalesHandlers(service, receipts, getWindow, auth))) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
  }
}
