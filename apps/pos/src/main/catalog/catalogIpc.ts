import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { Type, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  InventoryAdjustmentSchema,
  InventoryEntrySchema,
  ProductCreateSchema,
  ProductSearchSchema,
  SaleProductSearchSchema,
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
import { AuthService } from "../auth/authService";
import { trustedSessionUser } from "../auth/authIpc";

function validateInput<T>(schema: object, input: unknown): asserts input is T {
  // Workspace contracts resolve TypeBox's ESM typings while this Electron package uses CJS typings.
  if (!Value.Check(schema as TSchema, input)) {
    throw new Error("Los datos enviados no son válidos.");
  }
}

export function registerCatalogIpc(
  service: CatalogService,
  getWindow: () => Electron.BrowserWindow | null,
  auth: AuthService
): void {
  const handle = (channel: string, callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const window = getWindow();
      if (!window) {
        throw new Error("La ventana de caja no está disponible.");
      }
      return callback(event, ...args);
    });
  };

  handle(CATALOG_CHANNELS.searchProductsForSale, (event, query) => {
    trustedSessionUser(auth, event, getWindow(), "catalog:sale-read");
    validateInput<string>(Type.String({ maxLength: 120 }), query);
    validateInput<{ query: string }>(SaleProductSearchSchema, { query });
    return service.listProductsForSale(query);
  });
  handle(CATALOG_CHANNELS.listProducts, (_event, input) => {
    trustedSessionUser(auth, _event, getWindow(), "catalog:read");
    validateInput<ProductSearchInput>(ProductSearchSchema, input);
    return service.listProducts(input);
  });
  handle(CATALOG_CHANNELS.createProduct, (_event, input) => {
    const user = trustedSessionUser(auth, _event, getWindow(), "catalog:manage");
    validateInput<ProductCreateInput>(ProductCreateSchema, input);
    return service.createProduct(input, user.id);
  });
  handle(CATALOG_CHANNELS.updateProduct, (_event, id, input) => {
    const user = trustedSessionUser(auth, _event, getWindow(), "catalog:manage");
    validateInput<string>(Type.String({ minLength: 1, maxLength: 64 }), id);
    validateInput<ProductUpdateInput>(ProductUpdateSchema, input);
    return service.updateProduct(id, input, user.id);
  });
  handle(CATALOG_CHANNELS.listMovements, (_event, productId) => {
    trustedSessionUser(auth, _event, getWindow(), "inventory:read");
    validateInput<string>(Type.String({ minLength: 1, maxLength: 64 }), productId);
    return service.listMovements(productId);
  });
  handle(CATALOG_CHANNELS.recordEntry, (_event, input) => {
    const user = trustedSessionUser(auth, _event, getWindow(), "inventory:manage");
    validateInput<InventoryEntryInput>(InventoryEntrySchema, input);
    return service.recordEntry(input, user.id);
  });
  handle(CATALOG_CHANNELS.recordAdjustment, (_event, input) => {
    const user = trustedSessionUser(auth, _event, getWindow(), "inventory:manage");
    validateInput<InventoryAdjustmentInput>(InventoryAdjustmentSchema, input);
    return service.recordAdjustment(input, user.id);
  });
}
