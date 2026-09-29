import type {
  InventoryAdjustmentInput,
  InventoryEntryInput,
  InventoryMovement,
  Product,
  ProductCreateInput,
  ProductSearchInput,
  ProductUpdateInput
} from "@mercado-pos/contracts";

export const CATALOG_CHANNELS = {
  listProducts: "catalog:list-products",
  createProduct: "catalog:create-product",
  updateProduct: "catalog:update-product",
  listMovements: "catalog:list-movements",
  recordEntry: "catalog:record-entry",
  recordAdjustment: "catalog:record-adjustment"
} as const;

export interface CatalogBridge {
  listProducts(input: ProductSearchInput): Promise<Product[]>;
  createProduct(input: ProductCreateInput): Promise<Product>;
  updateProduct(id: string, input: ProductUpdateInput): Promise<Product>;
  listMovements(productId: string): Promise<InventoryMovement[]>;
  recordEntry(input: InventoryEntryInput): Promise<InventoryMovement>;
  recordAdjustment(input: InventoryAdjustmentInput): Promise<InventoryMovement>;
}
