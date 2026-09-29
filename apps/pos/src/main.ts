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

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let mainWindow: BrowserWindow | null = null;
let posDatabase: ReturnType<typeof openPosDatabase> | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: "#f6f7fb",
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
}

void app.whenReady().then(() => {
  posDatabase = openPosDatabase(join(app.getPath("userData"), "data", "catalog.sqlite"));
  const auth = new AuthService(posDatabase);
  registerAuthIpc(auth, () => mainWindow);
  registerCatalogIpc(new CatalogService(posDatabase), () => mainWindow, auth);
  registerClientsIpc(new ClientsService(posDatabase), () => mainWindow, auth);
  const sales = new SalesService(posDatabase);
  const receipts = new ReceiptService(sales, electronReceiptOutput(() => mainWindow));
  registerSalesIpc(sales, receipts, () => mainWindow, auth);
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
  posDatabase?.close();
  posDatabase = null;
});
