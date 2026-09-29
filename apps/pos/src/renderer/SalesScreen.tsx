import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import type { ClientCreateInput, PaymentMethod, SaleClientMatch, SaleProduct, Sale, SaleCreateInput, SaleSummary } from "@mercado-pos/contracts";
import { PAYMENT_METHOD_OPTIONS } from "@mercado-pos/contracts";
import { ReceiptActions } from "./ReceiptActions";
import { SaleDetail } from "./SaleDetail";
import { QuickClientCreateForm } from "./QuickClientCreateForm";
import {
  addSaleQuantity,
  calculateSaleAmounts,
  normalizeSalePayment,
  parseQuantityMilli,
  validateSaleStock
} from "@mercado-pos/domain";

interface Props {
  onBackToCatalog: () => void;
  showSalesHistory?: boolean;
}

interface CartLine {
  product: SaleProduct;
  quantity: string;
}

export function SalesScreen({ onBackToCatalog, showSalesHistory = true }: Props): ReactElement {
  const [products, setProducts] = useState<SaleProduct[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amountPaidCop, setAmountPaidCop] = useState("0");
  const [reference, setReference] = useState("");
  const [authorizationCode, setAuthorizationCode] = useState("");
  const [buyerSearch, setBuyerSearch] = useState("");
  const [buyerMatches, setBuyerMatches] = useState<SaleClientMatch[]>([]);
  const [selectedBuyer, setSelectedBuyer] = useState<SaleClientMatch | null>(null);
  const [creatingBuyer, setCreatingBuyer] = useState(false);
  const [recentSales, setRecentSales] = useState<SaleSummary[]>([]);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [detailSale, setDetailSale] = useState<Sale | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef(0);
  const buyerRequestRef = useRef(0);

  const calculation = useMemo(() => {
    if (cart.length === 0) return { value: null, error: "" };
    try {
      return {
        value: calculateSaleAmounts(cart.map(({ product, quantity }) => ({
          quantity,
          unitPriceCop: product.salePriceCop
        }))),
        error: ""
      };
    } catch (error) {
      return { value: null, error: errorMessage(error) };
    }
  }, [cart]);
  const totalCop = calculation.value?.totalCop.toString() ?? "0";

  useEffect(() => {
    setAmountPaidCop(method === "cash" ? "0" : totalCop);
  }, [totalCop, method]);

  const stockError = useMemo(() => {
    if (!calculation.value) return "";
    for (const { product, quantity } of cart) {
      try {
        validateSaleStock(quantity, product.stock, product.name);
      } catch (error) {
        return errorMessage(error);
      }
    }
    return "";
  }, [calculation, cart]);

  const paymentResult = useMemo(() => {
    if (!calculation.value) return { value: null, error: "" };
    try {
      return {
        value: normalizeSalePayment({
          method,
          amountPaidCop,
          ...(reference.trim() ? { reference } : {}),
          ...(authorizationCode.trim() ? { authorizationCode } : {})
        }, calculation.value.totalCop),
        error: ""
      };
    } catch (error) {
      return { value: null, error: errorMessage(error) };
    }
  }, [amountPaidCop, authorizationCode, calculation, method, reference]);

  const loadProducts = useCallback(async (search: string) => {
    const requestId = ++searchRequestRef.current;
    try {
      const result = await window.electronAPI.catalog.searchProductsForSale(search);
      if (searchRequestRef.current === requestId) setProducts(result);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProducts(query), 100);
    return () => window.clearTimeout(timer);
  }, [loadProducts, query]);

  useEffect(() => {
    const search = buyerSearch.trim();
    const requestId = ++buyerRequestRef.current;
    if (!search) {
      setBuyerMatches([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void window.electronAPI.clients.searchForSale(search)
        .then((matches) => {
          if (buyerRequestRef.current === requestId) setBuyerMatches(matches);
        })
        .catch((error: unknown) => setMessage(errorMessage(error)));
    }, 120);
    return () => window.clearTimeout(timer);
  }, [buyerSearch]);

  useEffect(() => {
    if (!showSalesHistory) return;
    void window.electronAPI.sales.listRecentSales()
      .then(setRecentSales)
      .catch((error: unknown) => setMessage(errorMessage(error)));
  }, [showSalesHistory]);

  const addProduct = (product: SaleProduct) => {
    setMessage("");
    setCompletedSale(null);
    try {
      const existing = cart.find((line) => line.product.id === product.id);
      const quantity = existing ? addSaleQuantity(existing.quantity) : "1";
      setCart((current) => existing
        ? current.map((line) => line.product.id === product.id ? { ...line, product, quantity } : line)
        : [...current, { product, quantity }]);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const scanBarcode = async () => {
    const scannedCode = query.trim();
    if (!scannedCode) return;
    searchRequestRef.current += 1;
    setMessage("");
    try {
      const result = await window.electronAPI.catalog.searchProductsForSale(scannedCode);
      setProducts(result);
      const exactMatch = result.find((product) => product.active && product.barcode === scannedCode);
      if (exactMatch) {
        addProduct(exactMatch);
        setQuery("");
      } else {
        setMessage("No se encontró un producto activo con ese código de barras.");
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  };

  const updateQuantity = (productId: string, quantity: string) => {
    setCart((current) => current.map((line) => line.product.id === productId ? { ...line, quantity } : line));
  };

  const submitSale = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !calculation.value || !paymentResult.value || stockError) return;
    const input: SaleCreateInput = {
      items: cart.map(({ product, quantity }) => ({ productId: product.id, quantity })),
      ...(selectedBuyer ? { clientId: selectedBuyer.id } : {}),
      payment: {
        method,
        amountPaidCop,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(authorizationCode.trim() ? { authorizationCode: authorizationCode.trim() } : {})
      }
    };

    setBusy(true);
    setMessage("");
    try {
      const sale = await window.electronAPI.sales.createSale(input);
      setCompletedSale(sale);
      setCart([]);
      setSelectedBuyer(null);
      setBuyerSearch("");
      setReference("");
      setAuthorizationCode("");
      setQuery("");
      setProducts(await window.electronAPI.catalog.searchProductsForSale(""));
      if (showSalesHistory) setRecentSales(await window.electronAPI.sales.listRecentSales());
      setMessage("Venta guardada localmente; no se emitió factura electrónica.");
      searchRef.current?.focus();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const due = calculation.value?.totalCop ?? 0n;
  const lineTotals = calculation.value?.lineTotalsCop ?? [];
  const showReference = method === "bank_transfer" || method === "nequi" || method === "daviplata" || method === "bre_b";
  const showAuthorization = method === "debit_card" || method === "credit_card";

  const openDetail = async (id: string) => {
    try { setDetailSale(await window.electronAPI.sales.getSale(id)); }
    catch (error) { setMessage(errorMessage(error)); }
  };

  const createBuyer = async (input: ClientCreateInput): Promise<boolean> => {
    try {
      const created = await window.electronAPI.clients.create(input);
      const match: SaleClientMatch = {
        id: created.id,
        name: created.name,
        documentType: created.documentType,
        documentNumber: created.documentNumber,
        email: created.email
      };
      setSelectedBuyer(match);
      setBuyerSearch("");
      setBuyerMatches([]);
      setMessage("Cliente creado y asociado a la venta.");
      return true;
    } catch (error) {
      setMessage(errorMessage(error));
      return false;
    }
  };

  if (detailSale) return <SaleDetail sale={detailSale} onClose={() => setDetailSale(null)} />;

  return (
    <section className="sales-page" aria-labelledby="sale-title">
      <div className="page-heading sales-heading">
        <div><p className="eyebrow">Caja · operación local</p><h1 id="sale-title">Nueva venta</h1><p className="subheading">Registra productos, existencias y un único medio de pago.</p></div>
        {showSalesHistory && <button className="quiet-button" onClick={onBackToCatalog}>← Volver al catálogo</button>}
      </div>

      <div className="invoice-pending-banner" role="note">
        <span className="pending-mark" aria-hidden="true">!</span>
        <div><strong>Venta local pendiente de facturación electrónica</strong><span>No es una factura electrónica ni ha sido emitida o aceptada por la DIAN.</span></div>
      </div>

      {completedSale && <CompletedSale sale={completedSale} onDetail={() => void openDetail(completedSale.id)} />}

      <div className="sales-layout">
        <section className="sale-products-panel">
          <div className="sale-panel-title"><div><p className="eyebrow">Paso 1</p><h2>Agregar productos</h2></div><span className="count-chip">{cart.length} {cart.length === 1 ? "producto" : "productos"}</span></div>
          <label className="search-box sale-search-box">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input ref={searchRef} autoFocus type="search" value={query} placeholder="Buscar o escanear código de barras…" aria-label="Buscar producto para la venta" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void scanBarcode(); } }} />
            <kbd>Enter</kbd>
          </label>
          <p className="scanner-hint">Lector USB: escanea y confirma con Enter para agregar el producto.</p>
          <div className="sale-product-results">
            {products.length === 0 ? <p className="sale-search-empty">{query ? "No hay productos coincidentes." : "No hay productos activos para vender."}</p> : products.map((product) => (
              <article className="sale-product-row" key={product.id}>
                <div className="sale-product-info"><strong>{product.name}</strong><span>{product.internalCode} · Disp. {product.stock} {shortUnit(product.unit)}</span></div>
                <div className="sale-product-price"><strong>{formatCop(BigInt(product.salePriceCop))}</strong><button type="button" className="add-product-button" disabled={parseQuantityMilli(product.stock) === 0n} onClick={() => addProduct(product)} aria-label={`Agregar ${product.name}`}>＋</button></div>
              </article>
            ))}
          </div>
        </section>

        <form className="sale-checkout-panel" onSubmit={(event) => void submitSale(event)}>
          <div className="sale-panel-title"><div><p className="eyebrow">Paso 2</p><h2>Resumen y pago</h2></div><button type="button" className="quiet-small" disabled={cart.length === 0} onClick={() => setCart([])}>Vaciar</button></div>
          {cart.length === 0 ? <div className="cart-empty"><span aria-hidden="true">▱</span><strong>La venta está vacía</strong><small>Agrega productos para calcular el total.</small></div> : (
            <div className="cart-lines">
              {cart.map((line, index) => (
                <article className="cart-line" key={line.product.id}>
                  <div className="cart-line-top"><div><strong>{line.product.name}</strong><small>{formatCop(BigInt(line.product.salePriceCop))} / {shortUnit(line.product.unit)}</small></div><button type="button" className="remove-line" onClick={() => setCart((current) => current.filter((item) => item.product.id !== line.product.id))} aria-label={`Quitar ${line.product.name}`}>×</button></div>
                  <div className="cart-line-bottom"><label className="quantity-field">Cantidad<input required inputMode="decimal" maxLength={24} pattern="[0-9]+([.,][0-9]{1,3})?" value={line.quantity} onChange={(event) => updateQuantity(line.product.id, event.target.value)} aria-label={`Cantidad de ${line.product.name}`} /></label><span className="cart-line-total">{lineTotals[index] === undefined ? "—" : formatCop(lineTotals[index])}</span></div>
                </article>
              ))}
            </div>
          )}

          <div className="sale-total-row"><span>Total de la venta</span><strong>{formatCop(due)}</strong></div>
          {calculation.error && <p className="form-error" role="alert">{calculation.error}</p>}
          {stockError && <p className="form-error" role="alert">{stockError}</p>}

          <div className="sale-buyer-field">
            <div className="sale-buyer-heading"><strong>Comprador</strong><span className="optional-label">opcional</span></div>
            {selectedBuyer ? <div className="selected-buyer">
              <div><strong>{selectedBuyer.name}</strong><small>{formatClientIdentity(selectedBuyer) || selectedBuyer.email || "Sin identificación ni correo"}</small></div>
              <button type="button" className="quiet-small" onClick={() => setSelectedBuyer(null)}>Quitar</button>
            </div> : <>
              {!creatingBuyer && <input className="buyer-search-input" type="search" maxLength={120} value={buyerSearch} placeholder="Busca nombre, identificación o correo" aria-label="Buscar cliente para asociar a la venta" onChange={(event) => setBuyerSearch(event.target.value)} />}
              {buyerSearch.trim() && <div className="buyer-match-list">
                {buyerMatches.length === 0 ? <p>{"Sin clientes activos coincidentes."}</p> : buyerMatches.map((client) => <button type="button" key={client.id} onClick={() => { setSelectedBuyer(client); setBuyerSearch(""); setBuyerMatches([]); }}>
                  <strong>{client.name}</strong><small>{formatClientIdentity(client) || client.email || "Sin identificación ni correo"}</small>
                </button>)}
              </div>}
              {creatingBuyer ? <QuickClientCreateForm onCancel={() => setCreatingBuyer(false)} onSave={createBuyer} /> : <button type="button" className="text-button quick-client-trigger" onClick={() => { setBuyerSearch(""); setBuyerMatches([]); setCreatingBuyer(true); }}>＋ Crear cliente y asociar</button>}
            </>}
            <small>También puedes registrar la venta sin perfil de comprador.</small>
          </div>

          <div className="payment-fields">
            <label className="field">Método de pago<select value={method} onChange={(event) => { const nextMethod = event.target.value as PaymentMethod; setMethod(nextMethod); setReference(""); setAuthorizationCode(""); setAmountPaidCop(nextMethod === "cash" ? "0" : totalCop); }}>{PAYMENT_METHOD_OPTIONS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label className="field">{method === "cash" ? "Efectivo recibido (COP)" : "Valor pagado (COP)"}<input required inputMode="numeric" pattern="[0-9]+" maxLength={19} value={amountPaidCop} readOnly={method !== "cash"} onChange={(event) => setAmountPaidCop(event.target.value)} /></label>
            {paymentResult.value?.changeCop ? <div className="change-due"><span>Cambio</span><strong>{formatCop(paymentResult.value.changeCop)}</strong></div> : null}
            {showReference && <label className="field full-payment-field">Referencia de operación <span className="optional-label">opcional</span><input maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="No ingreses claves ni datos bancarios" /></label>}
            {showAuthorization && <label className="field full-payment-field">Código de autorización <span className="optional-label">opcional</span><input maxLength={64} value={authorizationCode} onChange={(event) => setAuthorizationCode(event.target.value)} placeholder="No ingreses número de tarjeta, CVV ni PIN" /></label>}
          </div>
          {paymentResult.error && <p className="form-error" role="alert">{paymentResult.error}</p>}
          <button className="primary-button complete-sale-button" type="submit" disabled={busy || cart.length === 0 || !calculation.value || !paymentResult.value || Boolean(stockError)}>{busy ? "Guardando venta…" : "Registrar venta local"}</button>
          <p className="payment-disclaimer">Solo registra el medio y valor declarado. No procesa tarjetas ni verifica transferencias.</p>
        </form>
      </div>

      {showSalesHistory && <section className="recent-sales-panel">
        <div className="sale-panel-title"><div><p className="eyebrow">Historial en este equipo</p><h2>Ventas locales recientes</h2></div><span className="count-chip">{recentSales.length}</span></div>
        {recentSales.length === 0 ? <p className="sale-search-empty">Todavía no hay ventas locales.</p> : <div className="recent-sales-list">{recentSales.map((sale) => (
          <article className="recent-sale-row" key={sale.id}>
            <div className="recent-sale-id"><strong>Venta {sale.id.slice(0, 8)}</strong><small>{formatDate(sale.createdAt)} · Registró: {sale.createdByUsername ?? "Usuario histórico no identificado"} · {sale.buyer?.name ?? "Sin cliente asociado"}</small></div>
            <span className="payment-method-label">{methodLabel(sale.payment.method)}</span>
            <strong className="recent-sale-total">{formatCop(BigInt(sale.totalCop))}</strong>
            <span className="pending-pill">Local · pendiente de factura</span>
            <button className="text-button" type="button" onClick={() => void openDetail(sale.id)}>Ver detalle</button>
          </article>
        ))}</div>}
      </section>}
      {message && <div className="toast" role="status"><span>{message}</span><button aria-label="Cerrar mensaje" onClick={() => setMessage("")}>×</button></div>}
    </section>
  );
}

function CompletedSale({ sale, onDetail }: { sale: Sale; onDetail: () => void }): ReactElement {
  return (
    <section className="sale-completed-banner" aria-label="Venta guardada localmente">
      <div className="completed-check" aria-hidden="true">✓</div>
      <div><strong>Venta guardada localmente</strong><span>Venta {sale.id.slice(0, 8)} · {formatCop(BigInt(sale.totalCop))} · {methodLabel(sale.payment.method)} · {sale.buyer?.name ?? "Sin cliente asociado"}</span></div>
      <span className="pending-pill">No emitida ante DIAN</span>
      <button type="button" className="text-button" onClick={onDetail}>Ver detalle</button>
      <ReceiptActions key={sale.id} saleId={sale.id} />
    </section>
  );
}

function formatCop(value: bigint): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
}

function methodLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_OPTIONS.find((option) => option.id === method)?.label ?? method;
}

function formatClientIdentity(client: SaleClientMatch): string {
  return client.documentType && client.documentNumber
    ? `${client.documentType} · ${client.documentNumber}`
    : "";
}

function shortUnit(unit: SaleProduct["unit"]): string {
  return ({ unit: "und.", kg: "kg", g: "g", l: "L", ml: "ml", m: "m" })[unit];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Ocurrió un error al procesar la operación local.";
}
