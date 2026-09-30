import { contextBridge, ipcRenderer } from "electron";
import { CATALOG_CHANNELS, type CatalogBridge } from "./catalogBridge";
import { CLIENTS_CHANNELS, type ClientsBridge } from "./clientsBridge";
import { SALES_CHANNELS, type SalesBridge } from "./salesBridge";
import { AUTH_CHANNELS, type AuthBridge } from "./authBridge";
import { CASH_CHANNELS, type CashBridge } from "./cashBridge";
import { RECEIVABLES_CHANNELS, type ReceivablesBridge } from "./receivablesBridge";
import { COMPANY_CHANNELS, type CompanyBridge } from "./companyBridge";

const catalog: CatalogBridge = {
  searchProductsForSale: (query) => ipcRenderer.invoke(CATALOG_CHANNELS.searchProductsForSale, query),
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
  searchForSale: (query) => ipcRenderer.invoke(CLIENTS_CHANNELS.searchForSale, query),
  list: (input) => ipcRenderer.invoke(CLIENTS_CHANNELS.list, input),
  create: (input) => ipcRenderer.invoke(CLIENTS_CHANNELS.create, input),
  update: (id, input) => ipcRenderer.invoke(CLIENTS_CHANNELS.update, id, input),
  setCreditLimit: (id, input) => ipcRenderer.invoke(CLIENTS_CHANNELS.setCreditLimit, id, input)
};

const auth: AuthBridge = {
  state: () => ipcRenderer.invoke(AUTH_CHANNELS.state),
  bootstrapAdmin: (input) => ipcRenderer.invoke(AUTH_CHANNELS.bootstrapAdmin, input),
  login: (input) => ipcRenderer.invoke(AUTH_CHANNELS.login, input),
  logout: () => ipcRenderer.invoke(AUTH_CHANNELS.logout),
  listUsers: () => ipcRenderer.invoke(AUTH_CHANNELS.listUsers),
  createUser: (input) => ipcRenderer.invoke(AUTH_CHANNELS.createUser, input),
  setUserActive: (id, active) => ipcRenderer.invoke(AUTH_CHANNELS.setUserActive, id, { active })
};

const cash: CashBridge = {
  availability: () => ipcRenderer.invoke(CASH_CHANNELS.availability),
  overview: () => ipcRenderer.invoke(CASH_CHANNELS.overview),
  open: (input) => ipcRenderer.invoke(CASH_CHANNELS.open, input),
  close: (input) => ipcRenderer.invoke(CASH_CHANNELS.close, input)
};

const receivables: ReceivablesBridge = {
  listAccounts: (query) => ipcRenderer.invoke(RECEIVABLES_CHANNELS.listAccounts, { query }),
  getAccount: (clientId) => ipcRenderer.invoke(RECEIVABLES_CHANNELS.getAccount, clientId),
  recordPayment: (input) => ipcRenderer.invoke(RECEIVABLES_CHANNELS.recordPayment, input)
};

const company: CompanyBridge = {
  get: () => ipcRenderer.invoke(COMPANY_CHANNELS.get),
  save: (input) => ipcRenderer.invoke(COMPANY_CHANNELS.save, input)
};

contextBridge.exposeInMainWorld("electronAPI", { platform: process.platform, auth, catalog, sales, clients, cash, receivables, company });
