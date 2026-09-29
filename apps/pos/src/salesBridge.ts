import type { ReceiptRequest, ReceiptResult, Sale, SaleCreateInput, SaleSummary, SalesListInput, SalesPage } from "@mercado-pos/contracts";

export const SALES_CHANNELS = {
  createSale: "sales:create",
  listRecentSales: "sales:list-recent",
  listSales: "sales:list",
  getSale: "sales:get",
  printReceipt: "sales:print-receipt",
  exportReceiptPdf: "sales:export-receipt-pdf"
} as const;

export interface SalesBridge {
  createSale(input: SaleCreateInput): Promise<Sale>;
  listRecentSales(): Promise<SaleSummary[]>;
  listSales(input: SalesListInput): Promise<SalesPage>;
  getSale(id: string): Promise<Sale>;
  printReceipt(input: ReceiptRequest): Promise<ReceiptResult>;
  exportReceiptPdf(input: ReceiptRequest): Promise<ReceiptResult>;
}
