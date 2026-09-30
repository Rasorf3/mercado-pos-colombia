import type { ReactElement } from "react";

export function UserErrorNotice({ message, title = "No se pudo completar la acción" }: {
  message: string;
  title?: string;
}): ReactElement {
  return <div className="user-error-notice" role="alert">
    <span className="user-error-icon" aria-hidden="true">!</span>
    <div><strong>{title}</strong><p>{message}</p></div>
  </div>;
}
