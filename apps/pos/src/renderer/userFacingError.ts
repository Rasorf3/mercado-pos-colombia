const REMOTE_ERROR = /^Error invoking remote method '[^'\r\n]+': Error: ([^\r\n]+)$/;
const BUSINESS_MESSAGE = /^(?:Abre|Completa|Debe|Debes|Demasiados|El|Elige|Es|Esta|Este|Existencia|Falta|Ingresa|La|Las|Los|No|Para|Selecciona|Solicitud|Solo|Un|Una|Uno|Usa|Usuario|Ya)\b/u;
const TECHNICAL_DETAILS = /(?:\b(?:SQLITE|TypeError|ReferenceError|SyntaxError|RangeError|Cannot|undefined|module|webpack|ipcRenderer|ipcMain|handler|method|registered|remote|channel|invoke|invoking|node:internal|stack)\b|[A-Z]:\\|(?:\.ts|\.js)(?::\d+)?\b|https?:\/\/)/i;

/** Presenta errores de negocio sin mostrar nombres de canales IPC ni fallos internos. */
export function userFacingError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const raw = error.message.trim();
  const remote = REMOTE_ERROR.exec(raw);
  if (raw.startsWith("Error invoking remote method") && !remote) return fallback;
  const message = (remote?.[1] ?? raw).trim();
  if (!message || message.length > 240 || !BUSINESS_MESSAGE.test(message) || TECHNICAL_DETAILS.test(message)) {
    return fallback;
  }
  return message;
}
