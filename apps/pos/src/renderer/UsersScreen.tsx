import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from "react";
import type { AssignableUserRole, User, UserCreateInput } from "@mercado-pos/contracts";
import { roleLabel } from "@mercado-pos/domain";
import { userFacingError } from "./userFacingError";

export function UsersScreen(): ReactElement {
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [role, setRole] = useState<AssignableUserRole>("employee");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      setUsers(await window.electronAPI.auth.listUsers());
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, []);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const input: UserCreateInput = { username, password, role };
      await window.electronAPI.auth.createUser(input);
      setUsername("");
      setPassword("");
      setMessage("Usuario creado. Entrégale la contraseña inicial de forma privada; no queda visible aquí.");
      await loadUsers();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (user: User) => {
    try {
      await window.electronAPI.auth.setUserActive(user.id, !user.active);
      setMessage(user.active ? "Usuario desactivado; se rechazará su siguiente solicitud." : "Usuario activado.");
      await loadUsers();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  return <section className="users-page" aria-labelledby="users-title">
    <div className="page-heading"><div><p className="eyebrow">Acceso local · permisos por rol</p><h1 id="users-title">Usuarios</h1><p className="subheading">Admin puede crear cuentas Admin, EmpleadoJefe y Empleado. AdminMaster no se asigna desde esta caja.</p></div></div>
    <div className="users-layout">
      <section className="user-list-card"><div className="list-heading"><div><h2>Cuentas de este equipo</h2><span>{users.length} usuarios</span></div><span className="offline-badge"><i /> SQLite local</span></div>
        {users.length === 0 ? <p className="users-empty">Aún no hay cuentas adicionales.</p> : <div className="table-scroll"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último ingreso</th><th></th></tr></thead><tbody>
          {users.map((user) => <tr key={user.id}><td><strong>{user.username}</strong></td><td>{roleLabel(user.role)}</td><td><span className={`state-pill ${user.active ? "active" : "inactive"}`}>{user.active ? "Activo" : "Inactivo"}</span></td><td>{user.lastLoginAt ? formatDate(user.lastLoginAt) : "Sin ingreso"}</td><td><button className="text-button" type="button" onClick={() => void toggleActive(user)}>{user.active ? "Desactivar" : "Activar"}</button></td></tr>)}
        </tbody></table></div>}
      </section>
      <aside className="user-form-card"><h2>Crear usuario</h2><form onSubmit={(event) => void createUser(event)}>
        <label className="field">Nombre de usuario<input required minLength={3} maxLength={64} autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} /><small>3–64 caracteres: letras sin tilde, números, punto, guion o guion bajo.</small></label>
        <label className="field">Contraseña inicial<input required type="password" minLength={5} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => setCapsLockActive(event.getModifierState("CapsLock"))} onKeyUp={(event) => setCapsLockActive(event.getModifierState("CapsLock"))} onBlur={() => setCapsLockActive(false)} /><small>Mínimo 5 caracteres. No la compartas por canales públicos.</small>{capsLockActive && <small className="caps-lock-warning" role="status">Bloq Mayús está activado.</small>}</label>
        <label className="field">Rol<select value={role} onChange={(event) => setRole(event.target.value as AssignableUserRole)}><option value="employee">Empleado</option><option value="employee_manager">EmpleadoJefe</option><option value="admin">Admin</option></select></label>
        <button className="primary-button" disabled={busy}>{busy ? "Creando…" : "Crear usuario"}</button>
      </form></aside>
    </div>
    {message && <div className="toast" role="status"><span>{message}</span><button aria-label="Cerrar mensaje" onClick={() => setMessage("")}>×</button></div>}
  </section>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return userFacingError(error, "No se pudo administrar el usuario. Inténtalo de nuevo.");
}
