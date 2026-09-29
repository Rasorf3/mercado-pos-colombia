import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { Type, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  InventoryAdjustmentSchema,
  InventoryEntrySchema,
  ProductCreateSchema,
  ProductSearchSchema,
  ProductUpdateSchema
} from "@mercado-pos/contracts";
import type {
  InventoryAdjustmentInput,
  InventoryEntryInput,
  ProductCreateInput,
  ProductSearchInput,
  ProductUpdateInput
} from "@mercado-pos/contracts";
import { CATALOG_CHANNELS } from "../../catalogBridge";
import { CatalogService } from "./catalogService";

function validateInput<T>(schema: object, input: unknown): asserts input is T {
  // Workspace contracts resolve TypeBox's ESM typings while this Electron package uses CJS typings.
  if (!Value.Check(schema as TSchema, input)) {
    throw new Error("Los datos enviados no son válidos.");
  }
}

function assertTrustedMainFrame(event: IpcMainInvokeEvent, window: Electron.BrowserWindow): void {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error("Solicitud no autorizada.");
  }
}

export function registerCatalogIpc(
  service: CatalogService,
  getWindow: () => Electron.BrowserWindow | null
): void {
  const handle = (channel: string, callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const window = getWindow();
      if (!window) {
        throw new Error("La ventana de caja no está disponible.");
      }
      assertTrustedMainFrame(event, window);
      return callback(event, ...args);
    });
  };

  handle(CATALOG_CHANNELS.listProducts, (_event, input) => {
    validateInput<ProductSearchInput>(ProductSearchSchema, input);
    return service.listProducts(input);
  });
  handle(CATALOG_CHANNELS.createProduct, (_event, input) => {
    validateInput<ProductCreateInput>(ProductCreateSchema, input);
    return service.createProduct(input);
  });
  handle(CATALOG_CHANNELS.updateProduct, (_event, id, input) => {
    validateInput<string>(Type.String({ minLength: 1, maxLength: 64 }), id);
    validateInput<ProductUpdateInput>(ProductUpdateSchema, input);
    return service.updateProduct(id, input);
  });
  handle(CATALOG_CHANNELS.listMovements, (_event, productId) => {
    validateInput<string>(Type.String({ minLength: 1, maxLength: 64 }), productId);
    return service.listMovements(productId);
  });
  handle(CATALOG_CHANNELS.recordEntry, (_event, input) => {
    validateInput<InventoryEntryInput>(InventoryEntrySchema, input);
    return service.recordEntry(input);
  });
  handle(CATALOG_CHANNELS.recordAdjustment, (_event, input) => {
    validateInput<InventoryAdjustmentInput>(InventoryAdjustmentSchema, input);
    return service.recordAdjustment(input);
  });
}
