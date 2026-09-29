import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  ClientCreateSchema,
  ClientIdSchema,
  ClientSearchSchema,
  ClientUpdateSchema
} from "@mercado-pos/contracts";
import type { ClientCreateInput, ClientSearchInput, ClientUpdateInput } from "@mercado-pos/contracts";
import { CLIENTS_CHANNELS } from "../../clientsBridge";
import { ClientsService } from "./clientsService";

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
  getWindow: () => Electron.BrowserWindow | null
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
    validateInput<ClientSearchInput>(ClientSearchSchema, input);
    return service.list(input);
  });
  handle(CLIENTS_CHANNELS.create, (_event, input) => {
    validateInput<ClientCreateInput>(ClientCreateSchema, input);
    return service.create(input);
  });
  handle(CLIENTS_CHANNELS.update, (_event, id, input) => {
    validateInput<string>(ClientIdSchema, id);
    validateInput<ClientUpdateInput>(ClientUpdateSchema, input);
    return service.update(id, input);
  });
}
