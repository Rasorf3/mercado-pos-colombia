import { ipcMain } from "electron";
import type { CashService } from "./cashService";
import { createCashHandlers } from "./cashHandlers";
import type { AuthService } from "../auth/authService";

export function registerCashIpc(
  service: CashService,
  getWindow: () => Electron.BrowserWindow | null,
  auth: AuthService
): void {
  for (const [channel, handler] of Object.entries(createCashHandlers(service, getWindow, auth))) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
  }
}
