import { useState, type FormEvent, type ReactElement } from "react";
import type { ClientCreateInput } from "@mercado-pos/contracts";
import { DEFAULT_CLIENT_CREDIT_LIMIT_COP } from "@mercado-pos/contracts";
import { CopIntegerInput } from "./CopIntegerInput";

export function QuickClientCreateForm({ onCancel, onSave }: {
  onCancel: () => void;
  onSave: (input: ClientCreateInput) => Promise<boolean>;
}): ReactElement {
  const [name, setName] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [creditLimitCop, setCreditLimitCop] = useState(DEFAULT_CLIENT_CREDIT_LIMIT_COP);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const saved = await onSave({
      name,
      documentType: documentType.trim() || null,
      documentNumber: documentNumber.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      address: address.trim() || null,
      creditLimitCop
    });
    setBusy(false);
    if (saved) onCancel();
  };

  return <form className="quick-client-form" onSubmit={(event) => void submit(event)}>
    <strong>Nuevo comprador</strong>
    <label className="field">Nombre o razón social<input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <div className="quick-client-fields">
      <label className="field">Tipo ID<input maxLength={32} value={documentType} onChange={(event) => setDocumentType(event.target.value)} placeholder="CC, NIT…" /></label>
      <label className="field">Número ID<input maxLength={64} value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} /></label>
    </div>
    <label className="field">Correo opcional<input type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label className="field">Teléfono o celular opcional<input maxLength={32} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
    <label className="field">Dirección opcional<input maxLength={240} value={address} onChange={(event) => setAddress(event.target.value)} /></label>
    <label className="field">Límite de fiado (COP)<CopIntegerInput required value={creditLimitCop} onValueChange={setCreditLimitCop} /><small>Predeterminado: $300.000.</small></label>
    <div className="form-actions"><button type="button" className="quiet-button" onClick={onCancel}>Cancelar</button><button className="primary-button" disabled={busy}>{busy ? "Guardando…" : "Guardar y asociar"}</button></div>
  </form>;
}
