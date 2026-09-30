import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import type { Sale, SalesListInput, SalesPage } from "@mercado-pos/contracts";
import { paymentLabel, saleDate, saleMoney } from "../salesPresentation";
import { SaleDetail } from "./SaleDetail";

export function SalesHistoryScreen(): ReactElement {
  const [query, setQuery] = useState<SalesListInput>({ page: 1, pageSize: 20 });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [buyerQuery, setBuyerQuery] = useState("");
  const [result, setResult] = useState<SalesPage | null>(null);
  const [selected, setSelected] = useState<Sale | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const detailRequest = useRef(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void window.electronAPI.sales.listSales(query).then((page) => {
      if (current) setResult(page);
    }).catch((reason: unknown) => {
      if (current) { setError(reason instanceof Error ? reason.message : "No se pudo leer el historial."); setResult(null); }
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [query]);

  useEffect(() => () => { detailRequest.current += 1; }, []);

  const open = async (id: string) => {
    const request = ++detailRequest.current;
    setOpening(true);
    setError("");
    try {
      const sale = await window.electronAPI.sales.getSale(id);
      if (request === detailRequest.current) setSelected(sale);
    } catch { if (request === detailRequest.current) setError("No se pudo abrir la venta guardada."); }
    finally { if (request === detailRequest.current) setOpening(false); }
  };

  const filter = (event: FormEvent) => {
    event.preventDefault();
    setQuery({
      page: 1,
      pageSize: query.pageSize,
      ...(from ? { dateFrom: from } : {}),
      ...(to ? { dateTo: to } : {}),
      ...(buyerQuery.trim() ? { buyerQuery: buyerQuery.trim() } : {})
    });
  };

  if (selected) return <SaleDetail sale={selected} onClose={() => setSelected(null)} />;
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  return <section aria-labelledby="history-title">
    <div className="page-heading"><div><p className="eyebrow">Operaciones guardadas en este equipo</p><h1 id="history-title">Historial de ventas</h1><p className="subheading">Consulta y reimprime tus comprobantes sin conexión.</p></div></div>
    <div className="history-card">
      <form className="history-filters" onSubmit={filter}>
        <label>Desde <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Hasta <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label>Cliente <input type="search" maxLength={120} value={buyerQuery} placeholder="Nombre, identificación o teléfono" onChange={(event) => setBuyerQuery(event.target.value)} /></label>
        <button type="submit" className="primary-button" disabled={loading}>Filtrar</button>
        <button type="button" className="quiet-button" onClick={() => { setFrom(""); setTo(""); setBuyerQuery(""); setQuery({ page: 1, pageSize: query.pageSize }); }}>Limpiar filtros</button>
        <label>Por página <select value={query.pageSize} onChange={(event) => setQuery({ ...query, page: 1, pageSize: Number(event.target.value) })}>
          <option value={20}>20</option><option value={50}>50</option><option value={100}>100</option>
        </select></label>
      </form>
      <p className="history-note">Fechas inclusivas del calendario de Colombia (UTC−5). Facturación electrónica pendiente.</p>
      {error && <p className="receipt-error" role="alert">{error}</p>}
      {loading ? <p role="status">Cargando ventas…</p> : result?.sales.length ? <>
        <div className="table-scroll"><table className="history-table">
          <thead><tr><th>Identificador interno</th><th>Fecha (UTC−5)</th><th>Registró</th><th>Total</th><th>Método de pago</th><th>Estado</th><th>Detalle</th></tr></thead>
          <tbody>{result.sales.map((sale) => <tr key={sale.id}>
            <td className="sale-internal-id">{sale.id}</td><td>{saleDate(sale.createdAt)}</td>
            <td>{sale.createdByUsername ?? "Usuario histórico no identificado"}</td>
            <td>{saleMoney(sale.totalCop)}</td><td>{sale.payment ? paymentLabel(sale.payment.method) : "Fiado"}</td>
            <td>Local · facturación electrónica pendiente</td>
            <td><button className="text-button" disabled={opening} onClick={() => void open(sale.id)}>Abrir</button></td>
          </tr>)}</tbody>
        </table></div>
      </> : !error && <p className="sale-search-empty">No hay ventas en este período.</p>}
      <div className="history-pagination">
        <button className="quiet-button" disabled={loading || query.page <= 1} onClick={() => setQuery({ ...query, page: query.page - 1 })}>Anterior</button>
        <span>Página {query.page} de {pages} · {result?.total ?? 0} ventas</span>
        <button className="quiet-button" disabled={loading || query.page >= pages} onClick={() => setQuery({ ...query, page: query.page + 1 })}>Siguiente</button>
      </div>
    </div>
  </section>;
}
