import { ipcMain } from "electron";
import { Value } from "@sinclair/typebox/value";
import { CompanyProfileInputSchema, type CompanyProfileInput } from "@mercado-pos/contracts";
import { COMPANY_CHANNELS } from "../../companyBridge.ts";
import type { AuthService } from "../auth/authService.ts";
import { trustedSessionUser } from "../auth/authIpc.ts";
import type { CompanyService } from "./companyService.ts";

export function registerCompanyIpc(
  service: CompanyService,
  getWindow: () => Electron.BrowserWindow | null,
  auth: AuthService
): void {
  ipcMain.removeHandler(COMPANY_CHANNELS.get);
  ipcMain.handle(COMPANY_CHANNELS.get, (event) => {
    trustedSessionUser(auth, event, getWindow(), "company:manage");
    return service.get();
  });

  ipcMain.removeHandler(COMPANY_CHANNELS.save);
  ipcMain.handle(COMPANY_CHANNELS.save, (event, input: unknown) => {
    const user = trustedSessionUser(auth, event, getWindow(), "company:manage");
    if (!Value.Check(CompanyProfileInputSchema as never, input)) {
      throw new Error("Los datos del comercio no son válidos.");
    }
    return service.save(input as CompanyProfileInput, user.id);
  });
}
