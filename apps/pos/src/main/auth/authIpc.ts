import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  BootstrapAdminInputSchema,
  LoginInputSchema,
  SetUserActiveInputSchema,
  UserCreateInputSchema,
  UserIdSchema,
  type BootstrapAdminInput,
  type LoginInput,
  type UserCreateInput
} from "@mercado-pos/contracts";
import { AUTH_CHANNELS } from "../../authBridge";
import { AuthService } from "./authService";
import { assertTrustedMainFrame } from "./ipcSecurity";

export function validateAuthInput<T>(schema: object, input: unknown): asserts input is T {
  if (!Value.Check(schema as TSchema, input)) throw new Error("Los datos de acceso no son válidos.");
}

export function registerAuthIpc(service: AuthService, getWindow: () => Electron.BrowserWindow | null): void {
  const handle = (channel: string, callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const window = getWindow();
      if (!window || window.isDestroyed()) throw new Error("La ventana de caja no está disponible.");
      assertTrustedMainFrame(event, window);
      return callback(event, ...args);
    });
  };

  handle(AUTH_CHANNELS.state, (event) => service.state(event.sender.id));
  handle(AUTH_CHANNELS.bootstrapAdmin, (event, input) => {
    validateAuthInput<BootstrapAdminInput>(BootstrapAdminInputSchema, input);
    return service.bootstrapAdmin(input, event.sender.id);
  });
  handle(AUTH_CHANNELS.login, (event, input) => {
    validateAuthInput<LoginInput>(LoginInputSchema, input);
    return service.login(input, event.sender.id);
  });
  handle(AUTH_CHANNELS.logout, (event) => service.logout(event.sender.id));
  handle(AUTH_CHANNELS.listUsers, (event) => {
    service.requireCapability(event.sender.id, "users:manage");
    return service.listUsers();
  });
  handle(AUTH_CHANNELS.createUser, async (event, input) => {
    service.requireCapability(event.sender.id, "users:manage");
    validateAuthInput<UserCreateInput>(UserCreateInputSchema, input);
    return service.createUser(input);
  });
  handle(AUTH_CHANNELS.setUserActive, (event, id, input) => {
    const actingUser = service.requireCapability(event.sender.id, "users:manage");
    validateAuthInput<string>(UserIdSchema, id);
    validateAuthInput<{ active: boolean }>(SetUserActiveInputSchema, input);
    return service.setUserActive(id, input.active, actingUser.id);
  });
}

export function trustedSessionUser(
  service: AuthService,
  event: IpcMainInvokeEvent,
  window: Electron.BrowserWindow | null,
  capability: import("@mercado-pos/domain").Capability
) {
  if (!window || window.isDestroyed()) throw new Error("La ventana de caja no está disponible.");
  assertTrustedMainFrame(event, window);
  return service.requireCapability(event.sender.id, capability);
}
