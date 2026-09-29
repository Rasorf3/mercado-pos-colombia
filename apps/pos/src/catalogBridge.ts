import type {
  InventoryAdjustmentInput,
  InventoryEntryInput,
  InventoryMovement,
  Product,
  ProductCreateInput,
  ProductSearchInput,
  SaleProduct,
  ProductUpdateInput
} from "@mercado-pos/contracts";

export const CATALOG_CHANNELS = {
  searchProductsForSale: "catalog:search-products-for-sale",
  listProducts: "catalog:list-products",
  createProduct: "catalog:create-product",
  updateProduct: "catalog:update-product",
  listMovements: "catalog:list-movements",
  recordEntry: "catalog:record-entry",
  recordAdjustment: "catalog:record-adjustment"
} as const;

export interface CatalogBridge {
  searchProductsForSale(query: string): Promise<SaleProduct[]>;
  listProducts(input: ProductSearchInput): Promise<Product[]>;
  createProduct(input: ProductCreateInput): Promise<Product>;
  updateProduct(id: string, input: ProductUpdateInput): Promise<Product>;
  listMovements(productId: string): Promise<InventoryMovement[]>;
  recordEntry(input: InventoryEntryInput): Promise<InventoryMovement>;
  recordAdjustment(input: InventoryAdjustmentInput): Promise<InventoryMovement>;
}
