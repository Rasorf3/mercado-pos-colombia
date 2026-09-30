import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";
import type { ClientCreditAccount, ClientCreditAccountSummary, PaymentMethod } from "@mercado-pos/contracts";
import { PAYMENT_METHOD_OPTIONS } from "@mercado-pos/contracts";
import { normalizeCreditPayment } from "@mercado-pos/domain";
import { CopIntegerInput } from "./CopIntegerInput";
import { UserErrorNotice } from "./UserErrorNotice";
import { userFacingError } from "./userFacingError";

export function ReceivablesScreen(): ReactElement {
  const [query, setQuery] = useState("");
  const [accounts, setAccounts] = useState<ClientCreditAccountSummary[]>([]);
  const [selected, setSelected] = useState<ClientCreditAccount | null>(null);
  const [amountCop, setAmountCop] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [authorizationCode, setAuthorizationCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadAccounts = async (search: string) => {
    const next = await window.electronAPI.receivables.listAccounts(search);
    setAccounts(next);
  };

  useEffect(() => {
    let current = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void window.electronAPI.receivables.listAccounts(query)
        .then((next) => { if (current) setAccounts(next); })
        .catch((reason: unknown) => { if (current) setError(errorMessage(reason)); })
        .finally(() => { if (current) setLoading(false); });
    }, 100);
    return () => { current = false; window.clearTimeout(timer); };
  }, [query]);

  const openAccount = async (clientId: string) => {
    setError("");
    try {
      setSelected(await window.electronAPI.receivables.getAccount(clientId));
      setAmountCop("");
      setReference("");
      setAuthorizationCode("");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const paymentCheck = useMemo(() => {
    if (!selected) return { valid: false, error: "Selecciona una cuenta de cliente." };
    try {
      normalizeCreditPayment({
        amountCop,
        method,
        ...(reference.trim() ? { reference } : {}),
        ...(authorizationCode.trim() ? { authorizationCode } : {})
      }, BigInt(selected.balanceCop));
      return { valid: true, error: "" };
    } catch (reason) {
      return { valid: false, error: errorMessage(reason) };
    }
  }, [amountCop, authorizationCode, method, reference, selected]);

  const submitPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || busy || !paymentCheck.valid) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const account = await window.electronAPI.receivables.recordPayment({
        clientId: selected.clientId,
        amountCop,
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(authorizationCode.trim() ? { authorizationCode: authorizationCode.trim() } : {})
      });
      setSelected(account);
      setAmountCop("");
      setReference("");
      setAuthorizationCode("");
      await loadAccounts(query);
      setMessage("Abono registrado en la cuenta local del cliente.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const showReference = method === "bank_transfer" || method === "nequi" || method === "daviplata" || method === "bre_b";
  const showAuthorization = method === "debit_card" || method === "credit_card";

  return <section className="receivables-page" aria-labelledby="receivables-title">
    <div className="page-heading"><div><p className="eyebrow">Cartera · operación local</p><h1 id="receivables-title">Fiados y abonos</h1><p className="subheading">Consulta saldos pendientes y registra abonos sin conexión.</p></div></div>
    <div className="receivables-note"><strong>Registro interno</strong><span>Un fiado carga el total de la venta al cliente. Cada abono se registra aparte con su medio declarado; no se procesa ni verifica automáticamente.</span></div>
    {error && <UserErrorNotice message={error} />}
    {message && <p className="receivable-success" role="status">{message}</p>}
    <div className="receivables-layout">
      <section className="receivables-list-panel" aria-label="Cuentas de clientes">
        <label className="field">Buscar cliente<input type="search" maxLength={120} value={query} placeholder="Nombre, identificación o teléfono" onChange={(event) => setQuery(event.target.value)} /></label>
        {loading ? <p role="status">Consultando saldos…</p> : accounts.length === 0
          ? <p className="sale-search-empty">{query ? "No hay clientes coincidentes." : "No hay saldos pendientes."}</p>
          : <div className="receivable-account-list">{accounts.map((account) => <button type="button" key={account.clientId} className={`receivable-account-card ${selected?.clientId === account.clientId ? "selected" : ""}`} onClick={() => void openAccount(account.clientId)}>
            <span><strong>{account.name}</strong><small>{formatIdentity(account) || account.phone || "Sin identificación ni teléfono"}</small></span>
            <span className="receivable-balance"><strong>{formatCop(account.balanceCop)}</strong><small>de {formatCop(account.creditLimitCop)}</small></span>
          </button>)}</div>}
        <small className="receivables-list-footnote">Se muestran hasta 100 cuentas; con búsqueda puedes encontrar saldos en cero.</small>
      </section>

      <section className="receivables-detail-panel" aria-label="Detalle y abono">
        {!selected ? <div className="inspector-empty"><span aria-hidden="true">$</span><h2>Cuenta del cliente</h2><p>Selecciona un cliente para ver los movimientos y registrar un abono.</p></div> : <>
          <div className="receivable-detail-heading"><div><p className="eyebrow">Cuenta local</p><h2>{selected.name}</h2><span>{formatIdentity(selected) || selected.phone || "Sin identificación ni teléfono"}</span></div><span className={`state-pill ${selected.balanceCop === "0" ? "active" : "inactive"}`}>{selected.balanceCop === "0" ? "Al día" : "Saldo pendiente"}</span></div>
          {selected.phone && <p className="receivable-contact">Teléfono: {selected.phone}</p>}
          <div className="receivable-totals"><div><span>Saldo pendiente</span><strong>{formatCop(selected.balanceCop)}</strong></div><div><span>Límite de fiado</span><strong>{formatCop(selected.creditLimitCop)}</strong></div><div><span>Cupo disponible</span><strong>{formatCop(selected.availableCreditCop)}</strong></div></div>
          {selected.balanceCop !== "0" && <form className="receivable-payment-form" onSubmit={(event) => void submitPayment(event)}>
            <h3>Registrar abono</h3>
            <label className="field">Valor del abono (COP)<CopIntegerInput required value={amountCop} onValueChange={setAmountCop} placeholder="0" /></label>
            <label className="field">Medio recibido<select value={method} onChange={(event) => { setMethod(event.target.value as PaymentMethod); setReference(""); setAuthorizationCode(""); }}>{PAYMENT_METHOD_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            {showReference && <label className="field">Referencia <span className="optional-label">opcional</span><input maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} /></label>}
            {showAuthorization && <label className="field">Código de autorización <span className="optional-label">opcional</span><input maxLength={64} value={authorizationCode} onChange={(event) => setAuthorizationCode(event.target.value)} placeholder="No ingreses tarjeta, CVV ni PIN" /></label>}
            {!paymentCheck.valid && amountCop && <small className="form-error">{paymentCheck.error}</small>}
            <button className="primary-button" type="submit" disabled={busy || !paymentCheck.valid}>{busy ? "Guardando abono…" : "Registrar abono"}</button>
          </form>}
          <div className="receivable-ledger"><h3>Movimientos recientes</h3>{selected.entries.length === 0 ? <p className="cash-muted">No hay movimientos registrados.</p> : <ul>
            {selected.entries.map((entry) => <li key={entry.id}>
              <span><strong>{entry.kind === "sale_charge" ? `Fiado · venta ${entry.saleId?.slice(0, 8) ?? ""}` : `Abono · ${entry.method ? paymentLabel(entry.method) : ""}`}</strong><small>{formatDate(entry.createdAt)} · Registró: {entry.createdByUsername ?? "usuario no identificado"}</small>{entry.reference && <small>Referencia: {entry.reference}</small>}</span>
              <strong className={entry.kind === "payment" ? "credit-payment-value" : ""}>{entry.kind === "payment" ? "−" : "+"}{formatCop(entry.amountCop)}</strong>
            </li>)}
          </ul>}</div>
          {selected.entries.length >= 100 && <small className="receivables-list-footnote">Se muestran los últimos 100 movimientos.</small>}
        </>}
      </section>
    </div>
  </section>;
}

function formatCop(value: string): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(BigInt(value));
}

function formatIdentity(client: Pick<ClientCreditAccount, "documentType" | "documentNumber"> | ClientCreditAccountSummary): string {
  return client.documentType && client.documentNumber ? `${client.documentType} · ${client.documentNumber}` : "";
}

function paymentLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_OPTIONS.find((option) => option.id === method)?.label ?? method;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return userFacingError(error, "No se pudo completar la operación de cartera. Inténtalo de nuevo.");
}
