import { BrowserWindow, dialog, session } from "electron";
import { writeFile } from "node:fs/promises";
import type { ReceiptLayout, ReceiptResult } from "@mercado-pos/contracts";
import type { ReceiptDocument, ReceiptOutput } from "./receiptService.ts";

export function electronReceiptOutput(getWindow: () => BrowserWindow | null): ReceiptOutput {
  const owner = () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) throw new Error("La ventana de caja no está disponible.");
    return window;
  };
  return {
    printerCount: async () => (await owner().webContents.getPrintersAsync()).length,
    open: (html, layout) => openReceiptDocument(owner(), html, layout),
    selectPdfPath: async (defaultPath) => {
      const result = await dialog.showSaveDialog(owner(), {
        title: "Guardar comprobante local en PDF", defaultPath,
        filters: [{ name: "Documento PDF", extensions: ["pdf"] }]
      });
      if (result.canceled || !result.filePath) return null;
      return result.filePath;
    },
    writePdf: async (path, data) => { await writeFile(path, data); }
  };
}

export async function openReceiptDocument(
  parent: BrowserWindow, html: string, layout: ReceiptLayout
): Promise<ReceiptDocument> {
  const receiptSession = session.fromPartition("local-receipts");
  receiptSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  receiptSession.setPermissionCheckHandler(() => false);
  receiptSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "file://*/*"] },
    (_details, callback) => callback({ cancel: true }));
  const window = new BrowserWindow({
    show: false, parent, width: 400, height: 700,
    webPreferences: {
      session: receiptSession, contextIsolation: true, nodeIntegration: false,
      sandbox: true, javascript: false, webSecurity: true, devTools: false
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  const close = () => { if (!window.isDestroyed()) window.destroy(); };
  const onParentClosed = () => close();
  parent.once("closed", onParentClosed);
  window.once("closed", () => parent.removeListener("closed", onParentClosed));
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  } catch (error) {
    close();
    throw error;
  }
  return {
    close,
    pdf: () => window.webContents.printToPDF({
      printBackground: false, displayHeaderFooter: false, scale: 1,
      pageSize: { width: layout.paperWidthMm / 25.4, height: layout.pageHeightMm / 25.4 },
      margins: {
        top: layout.marginMm / 25.4, bottom: layout.marginMm / 25.4,
        left: layout.marginMm / 25.4, right: layout.marginMm / 25.4
      }
    }),
    print: () => new Promise<ReceiptResult>((resolve, reject) => {
      const onClosed = () => resolve({ status: "cancelled", message: "Impresión cancelada al cerrar la ventana." });
      window.once("closed", onClosed);
      try {
        window.webContents.print({
          silent: false, printBackground: false, color: false,
          // print uses microns for page size and pixels for margins; printToPDF uses inches.
          pageSize: { width: layout.paperWidthMm * 1000, height: layout.pageHeightMm * 1000 },
          margins: { marginType: "custom", top: Math.round(layout.marginMm * 96 / 25.4),
            bottom: Math.round(layout.marginMm * 96 / 25.4), left: Math.round(layout.marginMm * 96 / 25.4), right: Math.round(layout.marginMm * 96 / 25.4) },
          scaleFactor: 100
        }, (success, reason) => {
          window.removeListener("closed", onClosed);
          if (success) resolve({ status: "printed", message: "Comprobante enviado al sistema de impresión. Comprueba la salida en la impresora." });
          else if (/cancel/i.test(reason)) resolve({ status: "cancelled", message: "Impresión cancelada." });
          else resolve({ status: "error", message: "La impresión falló. Revisa la impresora, el tamaño de papel y los márgenes del controlador." });
        });
      } catch (error) {
        window.removeListener("closed", onClosed);
        reject(error);
      }
    })
  };
}
