import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from "react";
import type {
  AuthState,
  InventoryAdjustmentInput,
  InventoryEntryInput,
  InventoryMovement,
  Product,
  ProductCreateInput,
  ProductSearchInput,
  ProductUpdateInput,
  UserRole
} from "@mercado-pos/contracts";
import { calculateStockWeight, roleCan } from "@mercado-pos/domain";
import { ProductForm } from "./ProductForm";
import { ProductInspector } from "./ProductInspector";
import { SalesScreen } from "./SalesScreen";
import { ClientsScreen } from "./ClientsScreen";
import { SalesHistoryScreen } from "./SalesHistoryScreen";
import { UsersScreen } from "./UsersScreen";
import { LoginScreen } from "./LoginScreen";
import { CashScreen } from "./CashScreen";
import { ReceivablesScreen } from "./ReceivablesScreen";
import { CompanyScreen } from "./CompanyScreen";
import { userFacingError } from "./userFacingError";
import "./salesHistory.css";

const FONT_SIZE_STEPS = [100, 110, 120, 130, 140, 150] as const;
const FONT_SIZE_STORAGE_KEY = "mercado-pos-font-size";
type Page = "catalog" | "sales" | "clients" | "history" | "users" | "cash" | "receivables" | "company";

export function App(): ReactElement {
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const [activePage, setActivePage] = useState<Page>("catalog");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fontScale, setFontScale] = useState(readFontScale);
  const searchRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const movementRequestRef = useRef(0);
  const platform = window.electronAPI.platform;
  const selectedProduct = products.find((product) => product.id === selectedId) ?? null;

  useEffect(() => {
    try {
      window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontScale));
    } catch {
      // La preferencia se aplica durante esta sesión aunque el almacenamiento no esté disponible.
    }
  }, [fontScale]);

  useEffect(() => {
    void window.electronAPI.auth.state()
      .then((state) => {
        setAuthState(state);
        if (state.user) setActivePage(defaultPage(state.user.role));
      })
      .catch((error: unknown) => setMessage(errorMessage(error)))
      .finally(() => setAuthLoading(false));
  }, []);

  const loadProducts = useCallback(async (input: ProductSearchInput) => {
    const requestId = ++requestRef.current;
    try {
      const result = await window.electronAPI.catalog.listProducts(input);
      if (requestRef.current === requestId) {
        setProducts(result);
        if (selectedId && !result.some((product) => product.id === selectedId)) {
          movementRequestRef.current += 1;
          setSelectedId(null);
          setMovements([]);
        }
      }
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, [selectedId]);

  useEffect(() => {
    if (!authState?.user || !roleCan(authState.user.role, "catalog:read")) return;
    if (activePage !== "catalog") return;
    const timer = window.setTimeout(() => {
      void loadProducts({ query: search, includeInactive });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [activePage, authState?.user, includeInactive, loadProducts, search]);

  const selectProduct = async (product: Product) => {
    const requestId = ++movementRequestRef.current;
    setSelectedId(product.id);
    setSearch("");
    try {
      const result = await window.electronAPI.catalog.listMovements(product.id);
      if (movementRequestRef.current === requestId) setMovements(result);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      searchRef.current?.focus();
    }
  };

  const searchBarcode = async () => {
    const scannedCode = search.trim();
    if (!scannedCode) return;
    requestRef.current += 1;
    setMessage("");
    try {
      const result = await window.electronAPI.catalog.listProducts({ query: scannedCode, includeInactive: false });
      setProducts(result);
      const exact = result.find((product) => product.barcode === scannedCode && product.active);
      if (exact) {
        await selectProduct(exact);
        setMessage(`Producto encontrado: ${exact.name}`);
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

  const saveNewProduct = async (input: ProductCreateInput): Promise<boolean> => {
    setBusy(true);
    try {
      const created = await window.electronAPI.catalog.createProduct(input);
      setEditing(undefined);
      setSearch("");
      setIncludeInactive(false);
      setProducts(await window.electronAPI.catalog.listProducts({ query: "", includeInactive: false }));
      setSelectedId(created.id);
      setMovements(await window.electronAPI.catalog.listMovements(created.id));
      searchRef.current?.focus();
      setMessage("Producto creado y existencia inicial registrada.");
      return true;
    } catch (error) {
      setMessage(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveProductChanges = async (id: string, input: ProductUpdateInput): Promise<boolean> => {
    setBusy(true);
    try {
      const updated = await window.electronAPI.catalog.updateProduct(id, input);
      const nextProducts = await window.electronAPI.catalog.listProducts({ query: search, includeInactive });
      setProducts(nextProducts);
      if (nextProducts.some((product) => product.id === id)) setSelectedId(id);
      else {
        setSelectedId(null);
        setMovements([]);
      }
      setEditing(undefined);
      setMessage(updated.active ? "Producto actualizado." : "Producto desactivado.");
      searchRef.current?.focus();
      return true;
    } catch (error) {
      setMessage(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const recordEntry = async (input: InventoryEntryInput): Promise<boolean> => {
    setBusy(true);
    try {
      await window.electronAPI.catalog.recordEntry(input);
      await refreshProductAndMovements(input.productId);
      setMessage("Entrada de inventario registrada.");
      return true;
    } catch (error) {
      setMessage(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const recordAdjustment = async (input: InventoryAdjustmentInput): Promise<boolean> => {
    setBusy(true);
    try {
      await window.electronAPI.catalog.recordAdjustment(input);
      await refreshProductAndMovements(input.productId);
      setMessage("Ajuste de inventario registrado.");
      return true;
    } catch (error) {
      setMessage(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const refreshProductAndMovements = async (productId: string) => {
    const [nextProducts, nextMovements] = await Promise.all([
      window.electronAPI.catalog.listProducts({ query: search, includeInactive }),
      window.electronAPI.catalog.listMovements(productId)
    ]);
    setProducts(nextProducts);
    setMovements(nextMovements);
  };

  const availablePages = authState?.user ? pagesForRole(authState.user.role) : [];
  const handleAuthenticated = (state: AuthState) => {
    setAuthState(state);
    if (state.user) setActivePage(defaultPage(state.user.role));
  };
  const logout = async () => {
    await window.electronAPI.auth.logout();
    setAuthState({ needsBootstrap: false, user: null });
    setEditing(undefined);
    setProducts([]);
  };

  if (authLoading) return <main className="auth-screen"><p role="status">Cargando acceso seguro…</p></main>;
  if (!authState || authState.needsBootstrap || !authState.user) {
    return <LoginScreen needsBootstrap={authState?.needsBootstrap ?? false} onAuthenticated={handleAuthenticated} fontScale={fontScale / 100} />;
  }

  return (
    <main className="app-shell" style={{ "--font-scale": fontScale / 100 } as CSSProperties}>
      <header className="topbar">
        <a className="brand" href="#catalog" aria-label="Mercado POS inicio">
          <span className="brand-icon" aria-hidden="true">M</span>
          <span><strong>mercado</strong><small>punto de venta</small></span>
        </a>
        <nav className="top-nav" aria-label="Secciones de caja">
          {availablePages.map(({ id, label }) => <button key={id} className={activePage === id ? "current" : ""} onClick={() => setActivePage(id)}>{label}</button>)}
        </nav>
        <div className="font-size-control" role="group" aria-label="Tamaño de letra">
          <span aria-hidden="true">Texto</span>
          <button
            type="button"
            aria-label="Reducir tamaño de letra"
            title="Reducir tamaño de letra"
            disabled={fontScale === FONT_SIZE_STEPS[0]}
            onClick={() => setFontScale((current) => FONT_SIZE_STEPS[Math.max(0, FONT_SIZE_STEPS.indexOf(current) - 1)])}
          >A−</button>
          <output aria-live="polite" aria-atomic="true">{fontScale}%</output>
          <button
            type="button"
            aria-label="Aumentar tamaño de letra"
            title="Aumentar tamaño de letra"
            disabled={fontScale === FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 1]}
            onClick={() => setFontScale((current) => FONT_SIZE_STEPS[Math.min(FONT_SIZE_STEPS.length - 1, FONT_SIZE_STEPS.indexOf(current) + 1)])}
          >A+</button>
          <button
            className="font-size-reset"
            type="button"
            aria-label="Restablecer tamaño de letra"
            title="Restablecer tamaño de letra"
            disabled={fontScale === 100}
            onClick={() => setFontScale(100)}
          >↺</button>
        </div>
        <div className="local-status"><span className="status-light" /> {authState.user.username} · {roleLabel(authState.user.role)} <button className="logout-button" type="button" onClick={() => void logout()}>Salir</button> <span className="status-divider">·</span> {platform}</div>
      </header>

      {activePage === "company" ? <CompanyScreen onManageUsers={() => setActivePage("users")} /> : activePage === "cash" ? <CashScreen /> : activePage === "receivables" ? <ReceivablesScreen /> : activePage === "users" ? <UsersScreen /> : activePage === "history" ? <SalesHistoryScreen /> : activePage === "clients" ? <ClientsScreen /> : activePage === "sales" ? <SalesScreen showSalesHistory={roleCan(authState.user.role, "sales:history")} onBackToCatalog={() => setActivePage(roleCan(authState.user!.role, "catalog:read") ? "catalog" : "sales")} /> : <>
      <section className="page-heading">
        <div><p className="eyebrow">Administración de productos</p><h1>Catálogo e inventario</h1><p className="subheading">Tus productos y existencias, disponibles incluso sin internet.</p></div>
        <button className="primary-button" onClick={() => { setMessage(""); setEditing(null); }}><span aria-hidden="true">＋</span> Nuevo producto</button>
      </section>

      <section className="catalog-layout" id="catalog">
        <div className="catalog-column">
          <div className="search-toolbar">
            <label className="search-box">
              <span className="search-icon" aria-hidden="true">⌕</span>
              <input ref={searchRef} autoFocus type="search" value={search} placeholder="Buscar producto, código o escanear barras…" aria-label="Buscar producto o escanear código de barras" onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchBarcode(); } }} />
              <kbd>Enter</kbd>
            </label>
            <label className="inactive-toggle"><input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} /> Inactivos</label>
          </div>
          <p className="scanner-hint"><span aria-hidden="true">⌁</span> Lector USB: deja este campo enfocado, escanea el código y confirma con Enter.</p>

          <div className="product-list-card">
            <div className="list-heading"><div><h2>Productos</h2><span>{products.length} en esta búsqueda</span></div><span className="offline-badge"><i /> Guardado en este equipo</span></div>
            {products.length === 0 ? (
              <div className="empty-state"><span className="empty-icon" aria-hidden="true">▤</span><h3>{search ? "No hay coincidencias" : "Aún no hay productos"}</h3><p>{search ? "Prueba con otro nombre, código interno o código de barras." : "Crea el primer producto para comenzar a llevar tus existencias."}</p>{!search && <button className="text-button" onClick={() => setEditing(null)}>Crear primer producto <span aria-hidden="true">→</span></button>}</div>
            ) : (
              <div className="table-scroll"><table>
                <thead><tr><th>Producto</th><th>Código</th><th>Existencia</th><th>Precio</th><th>Estado</th></tr></thead>
                <tbody>{products.map((product) => (
                  <tr key={product.id} className={selectedId === product.id ? "selected-row" : ""} onClick={() => { setEditing(undefined); void selectProduct(product); }} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setEditing(undefined); void selectProduct(product); } }}>
                    <td><strong className="product-name">{product.name}</strong><small>{product.barcode ? `Barras · ${product.barcode}` : "Sin código de barras"}</small><small>Agregó: {product.createdByUsername ?? "Usuario histórico no identificado"}</small></td>
                    <td className="code-cell">{product.internalCode}</td>
                    <td><strong>{product.stock}</strong><small>{unitLabel(product.unit)}</small>{product.weightPerUnit && product.weightUnit && <small>{calculateStockWeight(product.stock, product.weightPerUnit, product.weightUnit)} total</small>}</td>
                    <td className="money-cell">{formatCop(product.salePriceCop)}</td>
                    <td><span className={`state-pill ${product.active ? "active" : "inactive"}`}>{product.active ? "Activo" : "Inactivo"}</span></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </div>

        <aside className="inspector-column">
          {editing !== undefined ? <ProductForm key={editing?.id ?? "new-product"} product={editing ?? null} busy={busy} onCancel={() => { setEditing(undefined); window.setTimeout(() => searchRef.current?.focus(), 0); }} onCreate={saveNewProduct} onUpdate={saveProductChanges} />
            : selectedProduct ? <ProductInspector product={selectedProduct} movements={movements} busy={busy} onEdit={() => setEditing(selectedProduct)} onRecordEntry={recordEntry} onRecordAdjustment={recordAdjustment} />
              : <div className="inspector-empty"><span aria-hidden="true">◉</span><h2>Detalle del producto</h2><p>Selecciona un producto para revisar sus movimientos o administrar sus existencias.</p></div>}
        </aside>
      </section>

      {message && <div className="toast" role="status"><span>{message}</span><button aria-label="Cerrar mensaje" onClick={() => setMessage("")}>×</button></div>}
      </>}

      <footer className="app-footer"><span>Mercado POS Colombia</span><span>{activePage === "company" ? "Perfil del comercio · Guardado en este equipo" : activePage === "cash" ? "Caja local · Apertura y cierre de turnos" : activePage === "receivables" ? "Cartera local · Fiados y abonos" : activePage === "catalog" ? "Catálogo local · Sin conexión requerida" : activePage === "clients" ? "Clientes locales · Perfiles opcionales" : activePage === "users" ? "Usuarios locales · Contraseñas con hash" : activePage === "history" ? "Historial local · Datos de este equipo" : "Venta local · Pendiente de facturación electrónica"}</span></footer>
    </main>
  );
}

function pagesForRole(role: UserRole): { id: Page; label: string }[] {
  const pages: { id: Page; label: string; capability: Parameters<typeof roleCan>[1] }[] = [
    { id: "catalog", label: "Catálogo", capability: "catalog:read" },
    { id: "sales", label: "Nueva venta", capability: "sales:create" },
    { id: "clients", label: "Clientes", capability: "clients:read" },
    { id: "history", label: "Historial", capability: "sales:history" },
    { id: "cash", label: "Caja", capability: "cash:close" },
    { id: "receivables", label: "Fiados", capability: "credit:read" },
    { id: "users", label: "Usuarios", capability: "users:manage" },
    { id: "company", label: "Mi empresa", capability: "company:manage" }
  ];
  return pages.filter((page) => roleCan(role, page.capability)).map(({ id, label }) => ({ id, label }));
}

function defaultPage(role: UserRole): Page {
  if (roleCan(role, "sales:create")) return "sales";
  if (roleCan(role, "catalog:read")) return "catalog";
  return "history";
}

function roleLabel(role: UserRole): string {
  return ({ admin_master: "AdminMaster", admin: "Admin", employee_manager: "EmpleadoJefe", employee: "Empleado" })[role];
}

function readFontScale(): (typeof FONT_SIZE_STEPS)[number] {
  try {
    const stored = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    const value = Number(stored);
    return FONT_SIZE_STEPS.find((step) => step === value) ?? 100;
  } catch {
    return 100;
  }
}

function formatCop(value: string): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(BigInt(value));
}

function unitLabel(unit: Product["unit"]): string {
  return ({ unit: "unidad", kg: "kg", g: "g", l: "L", ml: "ml", m: "m" })[unit];
}

function errorMessage(error: unknown): string {
  return userFacingError(error, "No se pudo completar la operación. Inténtalo de nuevo.");
}
