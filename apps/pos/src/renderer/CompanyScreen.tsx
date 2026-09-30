import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import type { CompanyProfile, CompanyProfileInput, User } from "@mercado-pos/contracts";
import { normalizeCompanyProfile, roleLabel } from "@mercado-pos/domain";
import { UserErrorNotice } from "./UserErrorNotice";
import { userFacingError } from "./userFacingError";

const EMPTY_PROFILE: CompanyProfileInput = {
  businessName: "",
  legalName: null,
  nit: null,
  verificationDigit: null,
  address: null,
  city: null,
  department: null,
  phone: null,
  secondaryPhone: null,
  email: null
};

type EditableField = Exclude<keyof CompanyProfileInput, "businessName">;

export function CompanyScreen({ onManageUsers }: { onManageUsers: () => void }): ReactElement {
  const [draft, setDraft] = useState<CompanyProfileInput>(EMPTY_PROFILE);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([window.electronAPI.company.get(), window.electronAPI.auth.listUsers()])
      .then(([stored, accounts]) => {
        if (!active) return;
        setProfile(stored);
        setUsers(accounts);
        if (stored) setDraft({
          businessName: stored.businessName,
          legalName: stored.legalName,
          nit: stored.nit,
          verificationDigit: stored.verificationDigit,
          address: stored.address,
          city: stored.city,
          department: stored.department,
          phone: stored.phone,
          secondaryPhone: stored.secondaryPhone,
          email: stored.email
        });
      })
      .catch((reason: unknown) => { if (active) setError(userFacingError(reason, "No se pudo consultar la información del comercio.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const updateField = (field: EditableField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value || null }));
    setSuccess("");
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const input = normalizeCompanyProfile(draft);
      const stored = await window.electronAPI.company.save(input);
      setProfile(stored);
      setDraft(input);
      setSuccess("Información del comercio guardada en este equipo.");
    } catch (reason) {
      setError(userFacingError(reason, "No se pudo guardar la información del comercio."));
    } finally {
      setSaving(false);
    }
  };

  return <section className="company-page" aria-labelledby="company-title">
    <div className="page-heading"><div><p className="eyebrow">Configuración local · solo Admin</p><h1 id="company-title">Mi empresa</h1><p className="subheading">Identidad y contacto del comercio, administrados en este equipo.</p></div></div>
    <div className="company-info-note" role="note">Estos datos son informativos y locales. Guardarlos no habilita facturación electrónica, no verifica el NIT y no cambia los comprobantes ni ventas anteriores.</div>
    {error && <UserErrorNotice message={error} />}
    {success && <p className="company-success" role="status">{success}</p>}
    {loading ? <p role="status">Cargando información del comercio…</p> : <div className="company-layout">
      <form className="company-card company-form" onSubmit={(event) => void save(event)}>
        <div className="company-section-title"><div><h2>Datos del comercio</h2><p>Completa solo la información que conozcas y puedas confirmar.</p></div><span className="offline-badge"><i /> SQLite local</span></div>
        <div className="company-fields">
          <label className="field">Nombre del comercio <span aria-hidden="true">*</span><input required maxLength={120} value={draft.businessName} onChange={(event) => { setDraft((current) => ({ ...current, businessName: event.target.value })); setSuccess(""); }} placeholder="Ej. Mercado del Barrio" /></label>
          <label className="field">Razón social <span className="optional-label">opcional</span><input maxLength={160} value={draft.legalName ?? ""} onChange={(event) => updateField("legalName", event.target.value)} /></label>
          <label className="field">NIT <span className="optional-label">opcional</span><input maxLength={32} value={draft.nit ?? ""} onChange={(event) => updateField("nit", event.target.value)} placeholder="Conserva ceros iniciales" /><small>Se guarda como texto; no se valida ante la DIAN.</small></label>
          <label className="field">Dígito de verificación <span className="optional-label">opcional</span><input inputMode="numeric" pattern="[0-9]" maxLength={1} value={draft.verificationDigit ?? ""} onChange={(event) => updateField("verificationDigit", event.target.value)} /></label>
          <label className="field company-field-wide">Dirección <span className="optional-label">opcional</span><input maxLength={240} value={draft.address ?? ""} onChange={(event) => updateField("address", event.target.value)} /></label>
          <label className="field">Ciudad o municipio <span className="optional-label">opcional</span><input maxLength={100} value={draft.city ?? ""} onChange={(event) => updateField("city", event.target.value)} /></label>
          <label className="field">Departamento <span className="optional-label">opcional</span><input maxLength={100} value={draft.department ?? ""} onChange={(event) => updateField("department", event.target.value)} /></label>
          <label className="field">Teléfono principal <span className="optional-label">opcional</span><input type="tel" maxLength={32} value={draft.phone ?? ""} onChange={(event) => updateField("phone", event.target.value)} /></label>
          <label className="field">Otro teléfono <span className="optional-label">opcional</span><input type="tel" maxLength={32} value={draft.secondaryPhone ?? ""} onChange={(event) => updateField("secondaryPhone", event.target.value)} /></label>
          <label className="field company-field-wide">Correo de contacto <span className="optional-label">opcional</span><input type="email" maxLength={254} value={draft.email ?? ""} onChange={(event) => updateField("email", event.target.value)} /></label>
        </div>
        <div className="company-form-footer"><button className="primary-button" disabled={saving}>{saving ? "Guardando…" : "Guardar información"}</button><small>{profile ? `Última actualización: ${formatDate(profile.updatedAt)} · ${profile.updatedByUsername ?? "usuario no identificado"}` : "Aún no hay un perfil guardado."}</small></div>
      </form>

      <aside className="company-card company-team" aria-labelledby="company-team-title">
        <div className="company-section-title"><div><h2 id="company-team-title">Empleados y accesos</h2><p>Se usan las cuentas del POS; no se duplica un directorio de personas.</p></div></div>
        <div className="company-team-summary"><strong>{users.filter((user) => user.active).length}</strong><span>cuentas activas en este equipo</span></div>
        {users.length === 0 ? <p className="company-empty">Todavía no hay cuentas para mostrar.</p> : <ul className="company-user-list">{users.map((user) => <li key={user.id}><span><strong>{user.username}</strong><small>{roleLabel(user.role)}</small></span><span className={`state-pill ${user.active ? "active" : "inactive"}`}>{user.active ? "Activo" : "Inactivo"}</span></li>)}</ul>}
        <button type="button" className="secondary-button" onClick={onManageUsers}>Administrar usuarios y empleados</button>
        <p className="company-team-note">Estas cuentas son locales; aún no se comparten entre computadores.</p>
      </aside>
    </div>}
  </section>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
