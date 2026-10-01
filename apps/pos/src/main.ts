import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { registerCatalogIpc } from "./main/catalog/catalogIpc";
import { CatalogService } from "./main/catalog/catalogService";
import { registerClientsIpc } from "./main/clients/clientsIpc";
import { ClientsService } from "./main/clients/clientsService";
import { openPosDatabase } from "./main/database/database";
import { registerSalesIpc } from "./main/sales/salesIpc";
import { SalesService } from "./main/sales/salesService";
import { ReceiptService } from "./main/receipts/receiptService";
import { electronReceiptOutput } from "./main/receipts/electronReceiptOutput";
import { AuthService } from "./main/auth/authService";
import { registerAuthIpc } from "./main/auth/authIpc";
import { CashService } from "./main/cash/cashService";
import { registerCashIpc } from "./main/cash/cashIpc";
import { ReceivablesService } from "./main/receivables/receivablesService";
import { registerReceivablesIpc } from "./main/receivables/receivablesIpc";
import { CompanyService } from "./main/company/companyService";
import { registerCompanyIpc } from "./main/company/companyIpc";
import { SyncService } from "./main/sync/syncService";
import { encryptedCredentialVault } from "./main/sync/credentialVault";
import { registerSyncIpc } from "./main/sync/syncIpc";

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let mainWindow: BrowserWindow | null = null;
let posDatabase: ReturnType<typeof openPosDatabase> | null = null;
let sync: SyncService | null = null;

const hasSingleInstance=app.requestSingleInstanceLock();
if(!hasSingleInstance) app.quit();
app.on("second-instance",()=>{if(mainWindow?.isMinimized())mainWindow.restore();mainWindow?.focus();});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    show: false,
    backgroundColor: "#f6f7fb",
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.once("ready-to-show", () => {
    mainWindow?.maximize();
    mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
}

void app.whenReady().then(() => {
  if(!hasSingleInstance)return;
  posDatabase = openPosDatabase(join(app.getPath("userData"), "data", "catalog.sqlite"));
  const auth = new AuthService(posDatabase);
  sync=new SyncService(posDatabase,encryptedCredentialVault(join(app.getPath("userData"),"sync","device-credential.bin")));
  registerSyncIpc(sync,()=>mainWindow,auth);
  sync.start();
  registerCashIpc(new CashService(posDatabase), () => mainWindow, auth);
  registerAuthIpc(auth, () => mainWindow);
  registerCatalogIpc(new CatalogService(posDatabase), () => mainWindow, auth);
  registerClientsIpc(new ClientsService(posDatabase), () => mainWindow, auth, sync);
  registerReceivablesIpc(new ReceivablesService(posDatabase), () => mainWindow, auth, sync);
  registerCompanyIpc(new CompanyService(posDatabase), () => mainWindow, auth);
  const sales = new SalesService(posDatabase);
  const receipts = new ReceiptService(sales, electronReceiptOutput(() => mainWindow));
  registerSalesIpc(sales, receipts, () => mainWindow, auth, sync);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  sync?.stop();
  posDatabase?.close();
  posDatabase = null;
});
