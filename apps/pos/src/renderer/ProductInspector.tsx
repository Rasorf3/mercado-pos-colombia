import { useState, type FormEvent, type ReactElement } from "react";
import type { InventoryAdjustmentInput, InventoryEntryInput, InventoryMovement, Product } from "@mercado-pos/contracts";
import { calculateStockWeight, formatBogotaDate } from "@mercado-pos/domain";

interface Props {
  product: Product;
  movements: InventoryMovement[];
  busy: boolean;
  onEdit: () => void;
  onRecordEntry: (input: InventoryEntryInput) => Promise<boolean>;
  onRecordAdjustment: (input: InventoryAdjustmentInput) => Promise<boolean>;
}

export function ProductInspector({ product, movements, busy, onEdit, onRecordEntry, onRecordAdjustment }: Props): ReactElement {
  const [movementType, setMovementType] = useState<"entry" | "adjustment">("entry");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const today = formatBogotaDate();
  const promotionIsActive = product.promotion !== null
    && today >= product.promotion.startsOn && today <= product.promotion.endsOn;

  const submitMovement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = movementType === "entry"
      ? await onRecordEntry({ productId: product.id, quantity, note })
      : await onRecordAdjustment({ productId: product.id, delta: quantity, note });
    if (saved) { setQuantity(""); setNote(""); }
  };

  return (
    <section className="side-card inspector-card" aria-labelledby="selected-product-title">
      <div className="side-card-heading"><div><p className="eyebrow">Ficha de producto</p><h2 id="selected-product-title">{product.name}</h2></div><button className="icon-button edit-icon" onClick={onEdit} aria-label="Editar producto">✎</button></div>
      <div className="detail-codes"><span className={`state-pill ${product.active ? "active" : "inactive"}`}>{product.active ? "Activo" : "Inactivo"}</span><span>{product.internalCode}</span></div>
      {product.barcode && <p className="barcode-detail"><span aria-hidden="true">▥</span> {product.barcode}</p>}
      <p className="product-audit-by"><strong>Agregó al catálogo:</strong> {product.createdByUsername ?? "Usuario histórico no identificado"}</p>

      <div className="stock-summary">
        <div><span>Existencia actual</span><strong>{product.stock}<small> {unitShort(product.unit)}</small></strong></div>
        {product.weightPerUnit && product.weightUnit && <div><span>Peso total estimado</span><strong>{calculateStockWeight(product.stock, product.weightPerUnit, product.weightUnit)}</strong><small>{product.weightPerUnit} {product.weightUnit} por unidad</small></div>}
        <div><span>Precio de venta</span><strong>{formatCop(product.salePriceCop)}</strong></div>
        <div><span>Costo</span><strong>{formatCop(product.costCop)}</strong></div>
      </div>
      {product.promotion && <div className="promotion-summary">
        <strong>{promotionIsActive ? "Promoción vigente" : "Promoción programada"}</strong>
        <span>{product.promotion.discount.type === "percentage" ? `${product.promotion.discount.value}% de descuento` : `${formatCop(product.promotion.discount.valueCop)} menos por unidad`}</span>
        <small>Del {product.promotion.startsOn} al {product.promotion.endsOn}. La venta guardará una copia del descuento aplicado.</small>
      </div>}

      <div className="movement-editor">
        <div className="section-title"><div><h3>Actualizar existencias</h3><p>Cada cambio queda en el historial.</p></div></div>
        <div className="movement-tabs" role="tablist" aria-label="Tipo de movimiento">
          <button type="button" role="tab" aria-selected={movementType === "entry"} className={movementType === "entry" ? "current" : ""} onClick={() => setMovementType("entry")}>Entrada</button>
          <button type="button" role="tab" aria-selected={movementType === "adjustment"} className={movementType === "adjustment" ? "current" : ""} onClick={() => setMovementType("adjustment")}>Ajuste</button>
        </div>
        <form className="movement-form" onSubmit={(event) => void submitMovement(event)}>
          <label className="field">{movementType === "entry" ? `Cantidad (${unitShort(product.unit)})` : `Ajuste (${unitShort(product.unit)}, usa - para restar)`}<input required inputMode="decimal" pattern={movementType === "entry" ? "[0-9]+([.,][0-9]{1,3})?" : "[+-]?[0-9]+([.,][0-9]{1,3})?"} value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder={movementType === "entry" ? "0.000" : "+0.000 / -0.000"} /></label>
          <label className="field">Motivo<input required maxLength={240} value={note} onChange={(event) => setNote(event.target.value)} placeholder={movementType === "entry" ? "Ej. Compra de mercancía" : "Ej. Conteo físico"} /></label>
          <button className="secondary-button" type="submit" disabled={busy}>{busy ? "Registrando…" : movementType === "entry" ? "＋ Registrar entrada" : "Registrar ajuste"}</button>
        </form>
      </div>

      <div className="history-section">
        <div className="section-title"><div><h3>Movimientos recientes</h3><p>Registro local trazable</p></div><span className="history-count">{movements.length}</span></div>
        {movements.length === 0 ? <p className="history-empty">Todavía no hay movimientos.</p> : (
          <ol className="movement-list">{movements.slice(0, 8).map((movement) => (
            <li key={movement.id}>
              <span className={`movement-symbol ${movement.type}`}>{movement.type === "entry" ? "+" : movement.type === "sale_out" ? "−" : movement.type === "adjustment" ? "±" : "·"}</span>
              <span className="movement-description"><strong>{movementLabel(movement.type)}</strong><small>{movement.note} · {formatDate(movement.createdAt)} · {movement.createdByUsername ?? "Usuario histórico no identificado"}</small></span>
              <span className="movement-quantity">{movement.quantity}<small>{unitShort(product.unit)}</small></span>
            </li>
          ))}</ol>
        )}
      </div>
    </section>
  );
}

function formatCop(value: string): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(BigInt(value));
}

function unitShort(unit: Product["unit"]): string {
  return ({ unit: "und.", kg: "kg", g: "g", l: "L", ml: "ml", m: "m" })[unit];
}

function movementLabel(type: InventoryMovement["type"]): string {
  return ({ initial: "Existencia inicial", entry: "Entrada", adjustment: "Ajuste", sale_out: "Venta local" })[type];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
