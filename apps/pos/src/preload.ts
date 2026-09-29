import { contextBridge, ipcRenderer } from "electron";
import { CATALOG_CHANNELS, type CatalogBridge } from "./catalogBridge";
import { CLIENTS_CHANNELS, type ClientsBridge } from "./clientsBridge";
import { SALES_CHANNELS, type SalesBridge } from "./salesBridge";

const catalog: CatalogBridge = {
  listProducts: (input) => ipcRenderer.invoke(CATALOG_CHANNELS.listProducts, input),
  createProduct: (input) => ipcRenderer.invoke(CATALOG_CHANNELS.createProduct, input),
  updateProduct: (id, input) => ipcRenderer.invoke(CATALOG_CHANNELS.updateProduct, id, input),
  listMovements: (productId) => ipcRenderer.invoke(CATALOG_CHANNELS.listMovements, productId),
  recordEntry: (input) => ipcRenderer.invoke(CATALOG_CHANNELS.recordEntry, input),
  recordAdjustment: (input) => ipcRenderer.invoke(CATALOG_CHANNELS.recordAdjustment, input)
};

const sales: SalesBridge = {
  createSale: (input) => ipcRenderer.invoke(SALES_CHANNELS.createSale, input),
  listRecentSales: () => ipcRenderer.invoke(SALES_CHANNELS.listRecentSales),
  listSales: (input) => ipcRenderer.invoke(SALES_CHANNELS.listSales, input),
  getSale: (id) => ipcRenderer.invoke(SALES_CHANNELS.getSale, id),
  printReceipt: (input) => ipcRenderer.invoke(SALES_CHANNELS.printReceipt, input),
  exportReceiptPdf: (input) => ipcRenderer.invoke(SALES_CHANNELS.exportReceiptPdf, input)
};

const clients: ClientsBridge = {
  list: (input) => ipcRenderer.invoke(CLIENTS_CHANNELS.list, input),
  create: (input) => ipcRenderer.invoke(CLIENTS_CHANNELS.create, input),
  update: (id, input) => ipcRenderer.invoke(CLIENTS_CHANNELS.update, id, input)
};

contextBridge.exposeInMainWorld("electronAPI", { platform: process.platform, catalog, sales, clients });
