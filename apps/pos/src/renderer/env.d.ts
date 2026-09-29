export {};
import type { CatalogBridge } from "../catalogBridge";
import type { ClientsBridge } from "../clientsBridge";
import type { SalesBridge } from "../salesBridge";

declare global {
  interface Window {
    electronAPI: {
      platform: NodeJS.Platform;
      catalog: CatalogBridge;
      clients: ClientsBridge;
      sales: SalesBridge;
    };
  }
}
