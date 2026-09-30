import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  CloseCashSessionInputSchema,
  OpenCashSessionInputSchema,
  type CloseCashSessionInput,
  type OpenCashSessionInput
} from "@mercado-pos/contracts";
import { CASH_CHANNELS } from "../../cashBridge.ts";
import { assertTrustedMainFrame } from "../auth/ipcSecurity.ts";
import type { AuthService } from "../auth/authService.ts";
import type { CashService } from "./cashService.ts";

type Handler = (event: IpcMainInvokeEvent, input?: unknown) => unknown;

export function createCashHandlers(
  service: CashService,
  getWindow: () => BrowserWindow | null,
  auth: AuthService
): Record<string, Handler> {
  const operations: Record<string, Handler> = {
    [CASH_CHANNELS.availability]: (event) => {
      auth.requireCapability(event.sender.id, "sales:create");
      return service.availability();
    },
    [CASH_CHANNELS.overview]: (event) => {
      auth.requireCapability(event.sender.id, "cash:close");
      return service.overview();
    },
    [CASH_CHANNELS.open]: (event, input) => {
      const user = auth.requireCapability(event.sender.id, "cash:close");
      validateCashInput<OpenCashSessionInput>(OpenCashSessionInputSchema, input);
      return service.openSession(input, user.id);
    },
    [CASH_CHANNELS.close]: (event, input) => {
      const user = auth.requireCapability(event.sender.id, "cash:close");
      validateCashInput<CloseCashSessionInput>(CloseCashSessionInputSchema, input);
      return service.closeSession(input, user.id);
    }
  };

  return Object.fromEntries(Object.entries(operations).map(([channel, operation]) => [channel,
    (event: IpcMainInvokeEvent, input?: unknown) => {
      const window = getWindow();
      if (!window || window.isDestroyed()) throw new Error("La ventana de caja no está disponible.");
      assertTrustedMainFrame(event, window);
      return operation(event, input);
    }
  ]));
}

function validateCashInput<T>(schema: object, input: unknown): asserts input is T {
  if (!Value.Check(schema as TSchema, input)) throw new Error("Los datos de apertura o cierre de caja no son válidos.");
}
