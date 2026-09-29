import { useEffect, useRef, useState, type ReactElement } from "react";
import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";
import { ReceiptLayoutSchema, type ReceiptLayout, type ReceiptResult } from "@mercado-pos/contracts";

const preferenceKey = "mercado-pos.receipt-layout.v1";
const layoutSchema: object = ReceiptLayoutSchema;
function isLayout(value: unknown): value is ReceiptLayout {
  return Value.Check(layoutSchema as TSchema, value);
}
function initialLayout(): ReceiptLayout {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(preferenceKey) ?? "null");
    if (isLayout(saved)) return saved;
  } catch { /* A missing/disabled local preference must not prevent printing. */ }
  return { paperWidthMm: 80, marginMm: 3, pageHeightMm: 200 };
}

export function ReceiptActions({ saleId }: { saleId: string }): ReactElement {
  const [layout, setLayout] = useState<ReceiptLayout>(initialLayout);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReceiptResult | null>(null);
  const pending = useRef(false);
  const valid = isLayout(layout);

  useEffect(() => {
    if (valid) {
      try { localStorage.setItem(preferenceKey, JSON.stringify(layout)); } catch { /* Optional preference. */ }
    }
  }, [layout, valid]);

  const output = async (action: "print" | "pdf") => {
    if (pending.current || !valid) return;
    pending.current = true;
    setBusy(true);
    setResult(null);
    try {
      const request = { saleId, layout };
      setResult(await (action === "print"
        ? window.electronAPI.sales.printReceipt(request)
        : window.electronAPI.sales.exportReceiptPdf(request)));
    } catch {
      setResult({ status: "error", message: "No se pudo solicitar el comprobante. Vuelve a abrir el detalle e inténtalo de nuevo." });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return <div className="receipt-actions" aria-label="Comprobante local">
    <div className="receipt-buttons">
      <label>Papel <select disabled={busy} value={layout.paperWidthMm} onChange={(event) => setLayout({ ...layout, paperWidthMm: Number(event.target.value) as 58 | 80 })}>
        <option value={58}>58 mm</option><option value={80}>80 mm</option>
      </select></label>
      <button type="button" className="primary-button" disabled={busy || !valid} onClick={() => void output("print")}>Imprimir comprobante</button>
      <button type="button" className="quiet-button" disabled={busy || !valid} onClick={() => void output("pdf")}>Guardar PDF</button>
    </div>
    <details className="receipt-settings"><summary>Ajustes de papel y márgenes</summary>
      <div className="receipt-buttons">
        <label>Margen por lado (mm) <input type="number" min={2} max={8} step={1} disabled={busy} value={layout.marginMm} onChange={(event) => setLayout({ ...layout, marginMm: Number(event.target.value) })} /></label>
        <label>Largo por página (mm) <input type="number" min={100} max={400} step={1} disabled={busy} value={layout.pageHeightMm} onChange={(event) => setLayout({ ...layout, pageHeightMm: Number(event.target.value) })} /></label>
      </div>
      <p>Elige el mismo papel en el diálogo de impresión, escala 100 %. El controlador puede imponer un área imprimible menor o cambiar el tamaño. Las ventas largas continúan en más páginas.</p>
      {!valid && <p role="alert">Usa márgenes enteros de 2 a 8 mm y largo de 100 a 400 mm.</p>}
    </details>
    {busy && <p role="status">Preparando comprobante; completa o cancela el diálogo abierto.</p>}
    {result && <p className={result.status === "error" ? "receipt-error" : ""} role={result.status === "error" ? "alert" : "status"}>{result.message}</p>}
  </div>;
}
