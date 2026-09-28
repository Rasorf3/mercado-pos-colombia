import type { ReactElement } from "react";

export function App(): ReactElement {
  const platform = window.electronAPI.platform;

  return (
    <main className="shell">
      <section className="welcome-card" aria-labelledby="welcome-title">
        <div className="brand-mark" aria-hidden="true">
          POS
        </div>
        <p className="eyebrow">Mercado POS Colombia</p>
        <h1 id="welcome-title">La caja está lista para crecer.</h1>
        <p className="intro">
          Electron y React arrancaron correctamente. Esta pantalla es el punto
          de entrada para la futura operación offline de la caja.
        </p>
        <div className="status" role="status">
          <span className="status-dot" aria-hidden="true" />
          Entorno local activo · {platform}
        </div>
        <p className="note">
          Las ventas, la persistencia y la integración DIAN se incorporarán en
          etapas posteriores.
        </p>
      </section>
    </main>
  );
}
