export {};
import type { CatalogBridge } from "../catalogBridge";
import type { ClientsBridge } from "../clientsBridge";
import type { SalesBridge } from "../salesBridge";
import type { AuthBridge } from "../authBridge";

declare global {
  interface Window {
    electronAPI: {
      platform: NodeJS.Platform;
      auth: AuthBridge;
      catalog: CatalogBridge;
      clients: ClientsBridge;
      sales: SalesBridge;
    };
  }
}
