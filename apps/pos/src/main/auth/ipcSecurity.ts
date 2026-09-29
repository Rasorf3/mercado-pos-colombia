import type { IpcMainInvokeEvent } from "electron";

export function assertTrustedMainFrame(event: IpcMainInvokeEvent, window: Electron.BrowserWindow): void {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error("Solicitud no autorizada.");
  }
}
