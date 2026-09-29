import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import {
  ReceiptRequestSchema, SaleCreateSchema, SaleIdSchema, SalesListSchema,
  type ReceiptRequest, type SaleCreateInput, type SalesListInput
} from "@mercado-pos/contracts";
import { SALES_CHANNELS } from "../../salesBridge.ts";
import type { SalesService } from "./salesService.ts";
import type { ReceiptService } from "../receipts/receiptService.ts";
import type { AuthService } from "../auth/authService.ts";
import { assertTrustedMainFrame } from "../auth/ipcSecurity.ts";
import { roleCan } from "@mercado-pos/domain";
import { validateSalesRequest } from "./salesRequests.ts";

export function createSalesHandlers(
  service: SalesService, receipts: ReceiptService, getWindow: () => BrowserWindow | null, auth: AuthService
): Record<string, (event: IpcMainInvokeEvent, input?: unknown) => unknown> {
  const operations: Record<string, (event: IpcMainInvokeEvent, input?: unknown) => unknown> = {
    [SALES_CHANNELS.createSale]: (event, input) => {
      const user = auth.requireCapability(event.sender.id, "sales:create");
      validateSalesRequest<SaleCreateInput>(SaleCreateSchema, input);
      return service.createSale(input, user.id);
    },
    [SALES_CHANNELS.listRecentSales]: (event) => {
      auth.requireCapability(event.sender.id, "sales:history");
      return service.listRecentSales();
    },
    [SALES_CHANNELS.listSales]: (event, input) => {
      auth.requireCapability(event.sender.id, "sales:history");
      validateSalesRequest<SalesListInput>(SalesListSchema, input);
      return service.listSales(input);
    },
    [SALES_CHANNELS.getSale]: (event, id) => {
      authorizeSaleRead(auth, service, event.sender.id, id);
      validateSalesRequest<string>(SaleIdSchema, id);
      return service.getSale(id);
    },
    [SALES_CHANNELS.printReceipt]: (event, input) => {
      validateSalesRequest<ReceiptRequest>(ReceiptRequestSchema, input);
      authorizeSaleRead(auth, service, event.sender.id, input.saleId);
      return receipts.print(input);
    },
    [SALES_CHANNELS.exportReceiptPdf]: (event, input) => {
      validateSalesRequest<ReceiptRequest>(ReceiptRequestSchema, input);
      authorizeSaleRead(auth, service, event.sender.id, input.saleId);
      return receipts.exportPdf(input);
    }
  };
  return Object.fromEntries(Object.entries(operations).map(([channel, operation]) => [channel,
    (event: IpcMainInvokeEvent, input?: unknown) => {
      const window = getWindow();
      if (!window || window.isDestroyed() || event.sender !== window.webContents ||
          !event.senderFrame || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error("Solicitud no autorizada.");
      }
      return operation(event, input);
    }
  ]));
}

function authorizeSaleRead(auth: AuthService, service: SalesService, sessionId: number, saleId: unknown): void {
  const user = auth.requireUser(sessionId);
  if (roleCan(user.role, "sales:history")) return;
  if (!roleCan(user.role, "sales:create") || typeof saleId !== "string" || service.getSaleCreatorId(saleId) !== user.id) {
    throw new Error("No tienes permiso para consultar esta venta.");
  }
}
