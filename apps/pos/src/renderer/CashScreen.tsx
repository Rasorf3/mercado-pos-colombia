import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import type { CashOverview, CashSession } from "@mercado-pos/contracts";
import { PAYMENT_METHOD_OPTIONS } from "@mercado-pos/contracts";
import { parseCopInteger } from "@mercado-pos/domain";
import { CopIntegerInput } from "./CopIntegerInput";

export function CashScreen(): ReactElement {
  const [overview, setOverview] = useState<CashOverview | null>(null);
  const [openingCashCop, setOpeningCashCop] = useState("0");
  const [countedCashCop, setCountedCashCop] = useState("0");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    void window.electronAPI.cash.overview()
      .then((result) => { if (mounted) setOverview(result); })
      .catch((reason: unknown) => { if (mounted) setError(errorMessage(reason)); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const openSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const session = await window.electronAPI.cash.open({ openingCashCop });
      setOverview((current) => ({ activeSession: session, recentSessions: current?.recentSessions ?? [] }));
      setOpeningCashCop("0");
      setMessage("Turno de caja abierto. Las nuevas ventas quedarán asociadas a este turno.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const closeSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const session = await window.electronAPI.cash.close({ countedCashCop });
      setOverview((current) => ({ activeSession: null, recentSessions: [session, ...(current?.recentSessions ?? [])].slice(0, 20) }));
      setCountedCashCop("0");
      setMessage("Cierre de caja guardado. El turno quedó bloqueado para nuevas ventas.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <main className="cash-page"><p role="status">Consultando los turnos de caja…</p></main>;
  if (!overview) return <main className="cash-page"><div className="form-error" role="alert">{error || "No se pudo consultar la caja local."}</div></main>;

  const active = overview.activeSession;
  const variancePreview = active ? calculateVariance(countedCashCop, active.expectedCashCop) : null;

  return <section className="cash-page" aria-labelledby="cash-title">
    <div className="page-heading">
      <div><p className="eyebrow">Control local · sin conexión</p><h1 id="cash-title">Apertura y cierre de caja</h1><p className="subheading">Cada venta queda vinculada al turno que estaba abierto al registrarla.</p></div>
    </div>

    <div className="cash-control-note" role="note">
      <strong>Cómo se calcula el efectivo esperado</strong>
      <span>Fondo inicial + ventas en efectivo netas del cambio + abonos de fiados recibidos en efectivo. En esta versión aún no se registran retiros ni otros ingresos manuales.</span>
    </div>

    {error && <div className="cash-message error" role="alert">{error}</div>}
    {message && <div className="cash-message success" role="status">{message}</div>}

    {active ? <>
      <section className="cash-panel" aria-label="Turno de caja abierto">
        <div className="cash-panel-heading"><div><p className="eyebrow">Turno activo</p><h2>Caja abierta</h2><span>Abrió {active.openedByUsername ?? "usuario histórico no identificado"} · {formatDate(active.openedAt)}</span></div><span className="cash-status-pill open">Abierta</span></div>
        <div className="cash-metrics">
          <CashMetric label="Fondo inicial" amount={active.openingCashCop} />
          <CashMetric label="Ventas registradas" amount={active.totalSalesCop} detail={`${active.salesCount} ${active.salesCount === 1 ? "venta" : "ventas"}`} />
          <CashMetric label="Ventas en efectivo" amount={active.cashSalesCop} />
          <CashMetric label="Abonos recibidos" amount={active.creditPaymentsCop} detail={`En efectivo: ${formatCop(active.cashCreditPaymentsCop)}`} />
          <CashMetric label="Efectivo esperado" amount={active.expectedCashCop} emphasis />
        </div>
        <PaymentTotals session={active} />
        <CreditPaymentTotals session={active} />
      </section>

      <form className="cash-panel cash-close-form" onSubmit={(event) => void closeSession(event)}>
        <div><p className="eyebrow">Finalizar turno</p><h2>Contar el efectivo disponible</h2><p className="cash-muted">Cuenta físicamente el efectivo del cajón. El sistema guardará el valor esperado, el conteo real y la diferencia.</p></div>
        <div className="cash-close-entry">
          <label className="cash-amount-field">Efectivo contado (COP)
            <CopIntegerInput required value={countedCashCop} onValueChange={setCountedCashCop} onFocus={(event) => { if (event.currentTarget.value === "0") setCountedCashCop(""); }} />
          </label>
          <div className="cash-variance-preview"><span>Diferencia estimada</span><strong className={variancePreview === null ? "" : variancePreview === 0n ? "balanced" : variancePreview > 0n ? "surplus" : "shortage"}>{variancePreview === null ? "—" : signedCop(variancePreview)}</strong></div>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Guardando cierre…" : "Guardar cierre de caja"}</button>
        </div>
        <small className="cash-muted">Puedes guardar el cierre aunque exista una diferencia; esta quedará visible en el historial del turno.</small>
      </form>
    </> : <form className="cash-panel cash-open-form" onSubmit={(event) => void openSession(event)}>
      <div className="cash-panel-heading"><div><p className="eyebrow">Inicio de turno</p><h2>No hay una caja abierta</h2><span>Ingresa cuánto efectivo queda como fondo inicial en el cajón.</span></div><span className="cash-status-pill closed">Cerrada</span></div>
      <div className="cash-open-entry">
        <label className="cash-amount-field">Fondo inicial en efectivo (COP)
          <CopIntegerInput required value={openingCashCop} onValueChange={setOpeningCashCop} onFocus={(event) => { if (event.currentTarget.value === "0") setOpeningCashCop(""); }} />
        </label>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Abriendo caja…" : "Abrir caja"}</button>
      </div>
      <p className="cash-muted">Al abrirla, Empleado y EmpleadoJefe podrán registrar ventas. Solo Admin o EmpleadoJefe pueden abrir o cerrar turnos.</p>
    </form>}

    <section className="cash-panel cash-history-panel">
      <div className="cash-panel-heading"><div><p className="eyebrow">Registro local</p><h2>Turnos cerrados recientemente</h2></div><span className="count-chip">{overview.recentSessions.length}</span></div>
      {overview.recentSessions.length === 0 ? <p className="cash-muted">Todavía no hay cierres de caja registrados.</p> : <div className="cash-history-list">
        {overview.recentSessions.map((session) => <ClosedSession key={session.id} session={session} />)}
      </div>}
    </section>
  </section>;
}

function CashMetric({ label, amount, detail, emphasis = false }: { label: string; amount: string; detail?: string; emphasis?: boolean }): ReactElement {
  return <article className={`cash-metric ${emphasis ? "emphasis" : ""}`}><span>{label}</span><strong>{formatCop(amount)}</strong>{detail && <small>{detail}</small>}</article>;
}

function PaymentTotals({ session }: { session: CashSession }): ReactElement {
  return <div className="cash-payment-breakdown"><h3>Ventas por medio de pago</h3>
    {session.paymentTotals.length === 0 ? <p className="cash-muted">Aún no hay ventas en este turno.</p> : <ul>{session.paymentTotals.map((payment) => <li key={payment.method}><span>{paymentLabel(payment.method)} · {payment.salesCount} {payment.salesCount === 1 ? "venta" : "ventas"}</span><strong>{formatCop(payment.amountCop)}</strong></li>)}</ul>}
  </div>;
}

function CreditPaymentTotals({ session }: { session: CashSession }): ReactElement {
  return <div className="cash-payment-breakdown"><h3>Abonos de fiados por medio de pago</h3>
    {session.creditPaymentTotals.length === 0 ? <p className="cash-muted">Aún no hay abonos asociados a este turno.</p> : <ul>{session.creditPaymentTotals.map((payment) => <li key={payment.method}><span>{paymentLabel(payment.method)} · {payment.paymentsCount} {payment.paymentsCount === 1 ? "abono" : "abonos"}</span><strong>{formatCop(payment.amountCop)}</strong></li>)}</ul>}
  </div>;
}

function ClosedSession({ session }: { session: CashSession }): ReactElement {
  const variance = BigInt(session.varianceCashCop ?? "0");
  return <article className="cash-history-entry">
    <div className="cash-history-heading"><div><strong>Turno {session.id.slice(0, 8)}</strong><span>{formatDate(session.openedAt)} · {session.openedByUsername ?? "Usuario no identificado"}</span></div><span className="cash-status-pill closed">Cerrada</span></div>
    <div className="cash-history-values">
      <span>Fondo inicial <strong>{formatCop(session.openingCashCop)}</strong></span>
      <span>Ventas <strong>{session.salesCount} · {formatCop(session.totalSalesCop)}</strong></span>
      <span>Abonos recibidos <strong>{formatCop(session.creditPaymentsCop)}</strong></span>
      <span>Efectivo esperado <strong>{formatCop(session.expectedCashCop)}</strong></span>
      <span>Efectivo contado <strong>{formatCop(session.countedCashCop ?? "0")}</strong></span>
      <span>Diferencia <strong className={variance === 0n ? "balanced" : variance > 0n ? "surplus" : "shortage"}>{signedCop(variance)}</strong></span>
    </div>
    <PaymentTotals session={session} />
    <CreditPaymentTotals session={session} />
    <small className="cash-muted">Cerró {session.closedByUsername ?? "usuario no identificado"} · {session.closedAt ? formatDate(session.closedAt) : "fecha no registrada"}</small>
  </article>;
}

function calculateVariance(counted: string, expected: string): bigint | null {
  try {
    return parseCopInteger(counted) - BigInt(expected);
  } catch {
    return null;
  }
}

function formatCop(value: string): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(BigInt(value));
}

function signedCop(value: bigint): string {
  const prefix = value > 0n ? "+" : value < 0n ? "−" : "";
  const absolute = value < 0n ? -value : value;
  return `${prefix}${formatCop(absolute.toString())}`;
}

function paymentLabel(method: CashSession["paymentTotals"][number]["method"]): string {
  return PAYMENT_METHOD_OPTIONS.find((option) => option.id === method)?.label ?? method;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Ocurrió un error al procesar la caja local.";
}
