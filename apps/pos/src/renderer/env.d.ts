export {};
import type { CatalogBridge } from "../catalogBridge";
import type { ClientsBridge } from "../clientsBridge";
import type { SalesBridge } from "../salesBridge";
import type { AuthBridge } from "../authBridge";
import type { CashBridge } from "../cashBridge";
import type { ReceivablesBridge } from "../receivablesBridge";
import type { CompanyBridge } from "../companyBridge";

declare global {
  interface Window {
    electronAPI: {
      platform: NodeJS.Platform;
      auth: AuthBridge;
      catalog: CatalogBridge;
      clients: ClientsBridge;
      sales: SalesBridge;
      cash: CashBridge;
      receivables: ReceivablesBridge;
      company: CompanyBridge;
    };
  }
}
