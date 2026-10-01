import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { Value } from "@sinclair/typebox/value";
import {
  ClientIdSchema,
  CreditPaymentInputSchema,
  ReceivablesSearchSchema,
  type CreditPaymentInput,
  type ReceivablesSearchInput
} from "@mercado-pos/contracts";
import { RECEIVABLES_CHANNELS } from "../../receivablesBridge.ts";
import type { ReceivablesService } from "./receivablesService.ts";
import type { AuthService } from "../auth/authService.ts";
import type { SyncService } from "../sync/syncService.ts";

export function registerReceivablesIpc(
  service: ReceivablesService,
  getWindow: () => Electron.BrowserWindow | null,
  auth: AuthService,
  sync?: SyncService
): void {
  const operations: Record<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown> = {
    [RECEIVABLES_CHANNELS.listAccounts]: (event, input) => {
      auth.requireCapability(event.sender.id, "credit:read");
      validate(ReceivablesSearchSchema, input);
      return service.listAccounts(input as ReceivablesSearchInput);
    },
    [RECEIVABLES_CHANNELS.getAccount]: (event, clientId) => {
      auth.requireCapability(event.sender.id, "credit:read");
      validate(ClientIdSchema, clientId);
      return service.getAccount(clientId as string);
    },
    [RECEIVABLES_CHANNELS.recordPayment]: (event, input) => {
      const user = auth.requireCapability(event.sender.id, "credit:collect");
      validate(CreditPaymentInputSchema, input);
      const payment=input as CreditPaymentInput;
      if(sync)return sync.withCredit(user,payment.clientId,()=> (-BigInt(payment.amountCop)).toString(),()=>service.recordPayment(payment,user.id));
      return service.recordPayment(input as CreditPaymentInput, user.id);
    }
  };

  for (const [channel, operation] of Object.entries(operations)) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event, ...args) => {
      const window = getWindow();
      if (!window || window.isDestroyed() || event.sender !== window.webContents ||
          !event.senderFrame || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error("Solicitud no autorizada.");
      }
      return operation(event, ...args);
    });
  }
}

function validate(schema: object, input: unknown): void {
  if (!Value.Check(schema as never, input)) throw new Error("Los datos de cartera no son válidos.");
}
