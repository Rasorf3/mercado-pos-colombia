import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from "react";
import type { Client, ClientCreateInput, ClientUpdateInput } from "@mercado-pos/contracts";
import { DEFAULT_CLIENT_CREDIT_LIMIT_COP } from "@mercado-pos/contracts";
import { CopIntegerInput } from "./CopIntegerInput";

interface Draft {
  name: string;
  documentType: string;
  documentNumber: string;
  email: string;
  phone: string;
  address: string;
  creditLimitCop: string;
  active: boolean;
}

const EMPTY_DRAFT: Draft = {
  name: "",
  documentType: "",
  documentNumber: "",
  email: "",
  phone: "",
  address: "",
  creditLimitCop: DEFAULT_CLIENT_CREDIT_LIMIT_COP,
  active: true
};

export function ClientsScreen(): ReactElement {
  const [clients, setClients] = useState<Client[]>([]);
  const [query, setQuery] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState<Client | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadClients = useCallback(async () => {
    try {
      setClients(await window.electronAPI.clients.list({ query, includeInactive }));
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, [includeInactive, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadClients(), 100);
    return () => window.clearTimeout(timer);
  }, [loadClients]);

  const saveClient = async (draft: Draft): Promise<boolean> => {
    setBusy(true);
    setMessage("");
    const fields = {
      name: draft.name,
      documentType: nullable(draft.documentType),
      documentNumber: nullable(draft.documentNumber),
      email: nullable(draft.email),
      phone: nullable(draft.phone),
      address: nullable(draft.address),
      creditLimitCop: draft.creditLimitCop
    };
    try {
      if (editing) {
        const input: ClientUpdateInput = { ...fields, active: draft.active };
        await window.electronAPI.clients.update(editing.id, input);
        setMessage(draft.active ? "Cliente actualizado." : "Cliente desactivado.");
      } else {
        const input: ClientCreateInput = fields;
        await window.electronAPI.clients.create(input);
        setMessage("Cliente guardado en este equipo.");
      }
      setEditing(undefined);
      await loadClients();
      return true;
    } catch (error) {
      setMessage(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="clients-page" aria-labelledby="clients-title">
      <div className="page-heading">
        <div><p className="eyebrow">Compradores · operación local</p><h1 id="clients-title">Clientes</h1><p className="subheading">Perfiles opcionales para asociar a las ventas de este equipo.</p></div>
        <button className="primary-button" onClick={() => { setMessage(""); setEditing(null); }}><span aria-hidden="true">＋</span> Nuevo cliente</button>
      </div>

      <p className="client-data-note">Guarda los datos de contacto y el límite local de fiado; puedes vender sin asociar un perfil de cliente.</p>

      <div className="clients-layout">
        <div className="client-list-card">
          <div className="client-search-toolbar">
            <label className="search-box"><span className="search-icon" aria-hidden="true">⌕</span><input type="search" value={query} maxLength={120} placeholder="Buscar nombre, identificación o correo…" aria-label="Buscar clientes" onChange={(event) => setQuery(event.target.value)} /></label>
            <label className="inactive-toggle"><input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} /> Inactivos</label>
          </div>
          <div className="list-heading"><div><h2>Directorio local</h2><span>{clients.length} coincidencias (máx. 100)</span></div><span className="offline-badge"><i /> Solo este equipo</span></div>
          {clients.length === 0 ? <div className="empty-state client-empty"><span className="empty-icon" aria-hidden="true">◉</span><h3>{query ? "No hay coincidencias" : "Aún no hay clientes"}</h3><p>{query ? "Prueba con otro nombre, identificación o correo." : "Puedes registrar un cliente cuando necesites asociarlo a una venta."}</p></div> : (
            <ul className="client-list">
              {clients.map((client) => <li key={client.id}>
                <button className={`client-list-item ${editing?.id === client.id ? "selected" : ""}`} onClick={() => setEditing(client)}>
                  <span className="client-list-main"><strong>{client.name}</strong><small>{formatIdentity(client) || client.phone || client.email || "Sin identificación ni contacto"}</small><small>Saldo fiado {formatCop(client.creditBalanceCop)} · Cupo {formatCop(client.creditLimitCop)}</small></span>
                  <span className={`state-pill ${client.active ? "active" : "inactive"}`}>{client.active ? "Activo" : "Inactivo"}</span>
                </button>
              </li>)}
            </ul>
          )}
        </div>

        <aside className="client-editor">
          {editing !== undefined ? <ClientForm key={editing?.id ?? "new-client"} client={editing} busy={busy} onCancel={() => setEditing(undefined)} onSave={saveClient} /> : (
            <div className="inspector-empty"><span aria-hidden="true">◉</span><h2>Detalle del cliente</h2><p>Selecciona un perfil para editarlo o crea uno nuevo. Desactivar no elimina las referencias históricas de ventas.</p></div>
          )}
        </aside>
      </div>

      {message && <div className="toast" role="status"><span>{message}</span><button aria-label="Cerrar mensaje" onClick={() => setMessage("")}>×</button></div>}
    </section>
  );
}

function ClientForm({
  client,
  busy,
  onCancel,
  onSave
}: {
  client: Client | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: Draft) => Promise<boolean>;
}): ReactElement {
  const [draft, setDraft] = useState<Draft>(client ? {
    name: client.name,
    documentType: client.documentType ?? "",
    documentNumber: client.documentNumber ?? "",
    email: client.email ?? "",
    phone: client.phone ?? "",
    address: client.address ?? "",
    creditLimitCop: client.creditLimitCop,
    active: client.active
  } : EMPTY_DRAFT);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    await onSave(draft);
  };

  return (
    <div className="side-card client-form-card">
      <div className="inspector-heading"><div><p className="eyebrow">{client ? "Perfil local" : "Nuevo perfil"}</p><h2>{client ? "Editar cliente" : "Crear cliente"}</h2></div>{client && <span className={`state-pill ${client.active ? "active" : "inactive"}`}>{client.active ? "Activo" : "Inactivo"}</span>}</div>
      <form onSubmit={(event) => void submit(event)}>
        <label className="field full-field">Nombre o razón social<input autoFocus required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className="field">Tipo de identificación <span className="optional-label">opcional</span><input maxLength={32} value={draft.documentType} onChange={(event) => setDraft({ ...draft, documentType: event.target.value })} placeholder="Ej. CC, NIT" /></label>
        <label className="field">Número de identificación <span className="optional-label">opcional</span><input maxLength={64} value={draft.documentNumber} onChange={(event) => setDraft({ ...draft, documentNumber: event.target.value })} /></label>
        <label className="field full-field">Correo electrónico <span className="optional-label">opcional</span><input type="email" maxLength={254} value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="nombre@ejemplo.com" /></label>
        <label className="field">Teléfono o celular <span className="optional-label">opcional</span><input maxLength={32} value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} placeholder="Ej. +57 300 123 4567" /></label>
        <label className="field">Dirección <span className="optional-label">opcional</span><input maxLength={240} value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} placeholder="Dirección de entrega o contacto" /></label>
        <label className="field full-field">Límite máximo de fiado (COP)<CopIntegerInput required value={draft.creditLimitCop} onValueChange={(creditLimitCop) => setDraft({ ...draft, creditLimitCop })} /><small>Por defecto $300.000. No puede ser menor que el saldo que ya debe.</small></label>
        {client && <label className="active-check"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /><span><strong>Cliente activo</strong><small>Desactivar lo oculta de nuevas ventas, pero conserva su historial.</small></span></label>}
        <div className="form-actions"><button type="button" className="quiet-button" onClick={onCancel}>Cancelar</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "Guardando…" : client ? "Guardar cambios" : "Crear cliente"}</button></div>
      </form>
    </div>
  );
}

function formatIdentity(client: Client): string {
  return client.documentType && client.documentNumber
    ? `${client.documentType} · ${client.documentNumber}`
    : "";
}

function nullable(value: string): string | null {
  return value.trim() || null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Ocurrió un error al procesar el cliente.";
}

function formatCop(value: string): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(BigInt(value));
}
