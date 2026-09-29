import { useState, type FormEvent, type ReactElement } from "react";
import type { CSSProperties } from "react";
import type { AuthState, BootstrapAdminInput, LoginInput } from "@mercado-pos/contracts";

export function LoginScreen({ needsBootstrap, onAuthenticated, fontScale }: {
  needsBootstrap: boolean;
  onAuthenticated: (state: AuthState) => void;
  fontScale: number;
}): ReactElement {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const input = { username, password };
      const user = needsBootstrap
        ? await window.electronAPI.auth.bootstrapAdmin(input as BootstrapAdminInput)
        : await window.electronAPI.auth.login(input as LoginInput);
      onAuthenticated({ needsBootstrap: false, user });
      setPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo iniciar sesión.");
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-screen" style={{ "--font-scale": fontScale } as CSSProperties}>
    <form className="auth-card" onSubmit={(event) => void submit(event)}>
      <span className="brand-icon" aria-hidden="true">M</span>
      <p className="eyebrow">Mercado POS Colombia</p>
      <h1>{needsBootstrap ? "Configura la caja" : "Iniciar sesión"}</h1>
      <p className="subheading">{needsBootstrap ? "Crea el primer usuario Admin. Esta configuración se realiza una sola vez en este equipo." : "Ingresa con tu usuario para acceder a las funciones asignadas."}</p>
      <label className="field">Usuario<input autoComplete="username" autoFocus minLength={3} maxLength={64} required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
      <label className="field">Contraseña<input type="password" autoComplete={needsBootstrap ? "new-password" : "current-password"} minLength={needsBootstrap ? 5 : 1} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => setCapsLockActive(event.getModifierState("CapsLock"))} onKeyUp={(event) => setCapsLockActive(event.getModifierState("CapsLock"))} onBlur={() => setCapsLockActive(false)} /></label>
      {capsLockActive && <small className="caps-lock-warning" role="status">Bloq Mayús está activado.</small>}
      {needsBootstrap && <p className="auth-hint">Usa al menos 5 caracteres. La contraseña se guarda como hash seguro, nunca en texto legible.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button auth-submit" disabled={busy}>{busy ? "Verificando…" : needsBootstrap ? "Crear Admin y continuar" : "Ingresar"}</button>
    </form>
  </main>;
}
