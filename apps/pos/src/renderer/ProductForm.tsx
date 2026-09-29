import { useState, type FormEvent, type ReactElement } from "react";
import type { Product, ProductCreateInput, ProductUpdateInput } from "@mercado-pos/contracts";

interface Props {
  product: Product | null;
  busy: boolean;
  onCancel: () => void;
  onCreate: (input: ProductCreateInput) => Promise<boolean>;
  onUpdate: (id: string, input: ProductUpdateInput) => Promise<boolean>;
}

const units: Array<{ value: Product["unit"]; label: string }> = [
  { value: "unit", label: "Unidad" }, { value: "kg", label: "Kilogramo (kg)" },
  { value: "g", label: "Gramo (g)" }, { value: "l", label: "Litro (L)" },
  { value: "ml", label: "Mililitro (ml)" }, { value: "m", label: "Metro (m)" }
];

export function ProductForm({ product, busy, onCancel, onCreate, onUpdate }: Props): ReactElement {
  const [name, setName] = useState(product?.name ?? "");
  const [internalCode, setInternalCode] = useState(product?.internalCode ?? "");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [costCop, setCostCop] = useState(product?.costCop ?? "");
  const [salePriceCop, setSalePriceCop] = useState(product?.salePriceCop ?? "");
  const [unit, setUnit] = useState<Product["unit"]>(product?.unit ?? "unit");
  const [initialStock, setInitialStock] = useState("0");
  const [active, setActive] = useState(product?.active ?? true);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = { name, internalCode, barcode: barcode.trim() || null, costCop, salePriceCop, unit };
    if (product) await onUpdate(product.id, { ...fields, active });
    else await onCreate({ ...fields, initialStock });
  };

  return (
    <section className="side-card form-card" aria-labelledby="product-form-title">
      <div className="side-card-heading"><div><p className="eyebrow">{product ? "Editar ficha" : "Nuevo registro"}</p><h2 id="product-form-title">{product ? "Producto" : "Crear producto"}</h2></div><button className="icon-button" type="button" onClick={onCancel} aria-label="Cerrar formulario">×</button></div>
      <form onSubmit={(event) => void submit(event)}>
        <label className="field full-field">Nombre del producto<input required maxLength={120} autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Arroz blanco" /></label>
        <label className="field">Código interno<input required maxLength={64} value={internalCode} onChange={(event) => setInternalCode(event.target.value)} placeholder="Ej. ARO-001" /></label>
        <label className="field">Código de barras <span className="optional-label">opcional</span><input maxLength={64} value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="Conserva ceros iniciales" /></label>
        <label className="field">Costo (COP)<input required inputMode="numeric" pattern="[0-9]+" value={costCop} onChange={(event) => setCostCop(event.target.value)} placeholder="0" /></label>
        <label className="field">Precio de venta (COP)<input required inputMode="numeric" pattern="[0-9]+" value={salePriceCop} onChange={(event) => setSalePriceCop(event.target.value)} placeholder="0" /></label>
        <label className="field">Unidad de medida<select value={unit} onChange={(event) => setUnit(event.target.value as Product["unit"])}>{units.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {product ? (
          <label className="active-check"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span><strong>Producto activo</strong><small>Los productos inactivos no aparecen en la búsqueda normal.</small></span></label>
        ) : (
          <label className="field full-field">Existencia inicial<input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={initialStock} onChange={(event) => setInitialStock(event.target.value)} placeholder="0" /><small>Hasta tres decimales. Quedará registrado como movimiento inicial.</small></label>
        )}
        <div className="form-actions"><button className="quiet-button" type="button" onClick={onCancel}>Cancelar</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "Guardando…" : product ? "Guardar cambios" : "Crear producto"}</button></div>
      </form>
    </section>
  );
}
