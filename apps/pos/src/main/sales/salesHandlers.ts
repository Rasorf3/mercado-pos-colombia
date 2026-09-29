import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import {
  ReceiptRequestSchema, SaleCreateSchema, SaleIdSchema, SalesListSchema,
  type ReceiptRequest, type SaleCreateInput, type SalesListInput
} from "@mercado-pos/contracts";
import { SALES_CHANNELS } from "../../salesBridge.ts";
import type { SalesService } from "./salesService.ts";
import type { ReceiptService } from "../receipts/receiptService.ts";
import { validateSalesRequest } from "./salesRequests.ts";

export function createSalesHandlers(
  service: SalesService, receipts: ReceiptService, getWindow: () => BrowserWindow | null
): Record<string, (event: IpcMainInvokeEvent, input?: unknown) => unknown> {
  const operations: Record<string, (input?: unknown) => unknown> = {
    [SALES_CHANNELS.createSale]: (input) => {
      validateSalesRequest<SaleCreateInput>(SaleCreateSchema, input);
      return service.createSale(input);
    },
    [SALES_CHANNELS.listRecentSales]: () => service.listRecentSales(),
    [SALES_CHANNELS.listSales]: (input) => {
      validateSalesRequest<SalesListInput>(SalesListSchema, input);
      return service.listSales(input);
    },
    [SALES_CHANNELS.getSale]: (id) => {
      validateSalesRequest<string>(SaleIdSchema, id);
      return service.getSale(id);
    },
    [SALES_CHANNELS.printReceipt]: (input) => {
      validateSalesRequest<ReceiptRequest>(ReceiptRequestSchema, input);
      return receipts.print(input);
    },
    [SALES_CHANNELS.exportReceiptPdf]: (input) => {
      validateSalesRequest<ReceiptRequest>(ReceiptRequestSchema, input);
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
      return operation(input);
    }
  ]));
}
