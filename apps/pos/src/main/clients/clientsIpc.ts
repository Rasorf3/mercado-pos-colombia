import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { Type } from "@sinclair/typebox";
import { type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  ClientCreateSchema,
  ClientIdSchema,
  ClientSearchSchema,
  ClientCreditLimitUpdateSchema,
  SaleClientSearchSchema,
  ClientUpdateSchema
} from "@mercado-pos/contracts";
import type { ClientCreateInput, ClientCreditLimitUpdate, ClientSearchInput, ClientUpdateInput } from "@mercado-pos/contracts";
import { CLIENTS_CHANNELS } from "../../clientsBridge";
import { ClientsService } from "./clientsService";
import { AuthService } from "../auth/authService";
import { trustedSessionUser } from "../auth/authIpc";

function validateInput<T>(schema: object, input: unknown): asserts input is T {
  if (!Value.Check(schema as TSchema, input)) {
    throw new Error("Los datos del cliente no son válidos.");
  }
}

function assertTrustedMainFrame(event: IpcMainInvokeEvent, window: Electron.BrowserWindow): void {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error("Solicitud no autorizada.");
  }
}

export function registerClientsIpc(
  service: ClientsService,
  getWindow: () => Electron.BrowserWindow | null,
  auth: AuthService
): void {
  const handle = (channel: string, callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const window = getWindow();
      if (!window) throw new Error("La ventana de caja no está disponible.");
      assertTrustedMainFrame(event, window);
      return callback(event, ...args);
    });
  };

  handle(CLIENTS_CHANNELS.list, (_event, input) => {
    trustedSessionUser(auth, _event, getWindow(), "clients:read");
    validateInput<ClientSearchInput>(ClientSearchSchema, input);
    return service.list(input);
  });
  handle(CLIENTS_CHANNELS.create, (_event, input) => {
    const user = trustedSessionUser(auth, _event, getWindow(), "clients:create");
    validateInput<ClientCreateInput>(ClientCreateSchema, input);
    return service.create(input, user.id);
  });
  handle(CLIENTS_CHANNELS.searchForSale, (_event, query) => {
    trustedSessionUser(auth, _event, getWindow(), "clients:lookup-for-sale");
    validateInput<string>(Type.String({ minLength: 1, maxLength: 120 }), query);
    validateInput<{ query: string }>(SaleClientSearchSchema, { query });
    return service.listForSale(query);
  });
  handle(CLIENTS_CHANNELS.update, (_event, id, input) => {
    const user = trustedSessionUser(auth, _event, getWindow(), "clients:manage");
    validateInput<string>(ClientIdSchema, id);
    validateInput<ClientUpdateInput>(ClientUpdateSchema, input);
    return service.update(id, input, user.id);
  });
  handle(CLIENTS_CHANNELS.setCreditLimit, (_event, id, input) => {
    const user = trustedSessionUser(auth, _event, getWindow(), "clients:credit-manage");
    validateInput<string>(ClientIdSchema, id);
    validateInput<ClientCreditLimitUpdate>(ClientCreditLimitUpdateSchema, input);
    return service.setCreditLimit(id, input.creditLimitCop, user.id);
  });
}
