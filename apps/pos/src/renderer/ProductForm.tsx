import { useState, type FormEvent, type ReactElement } from "react";
import type { Product, ProductCreateInput, ProductDiscount, ProductPromotion, ProductUpdateInput } from "@mercado-pos/contracts";

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
  const [weightPerUnit, setWeightPerUnit] = useState(product?.weightPerUnit ?? "");
  const [weightUnit, setWeightUnit] = useState<NonNullable<Product["weightUnit"]>>(product?.weightUnit ?? "kg");
  const [initialStock, setInitialStock] = useState("0");
  const [active, setActive] = useState(product?.active ?? true);
  const [promotionEnabled, setPromotionEnabled] = useState(product?.promotion !== null && product?.promotion !== undefined);
  const [promotionType, setPromotionType] = useState<ProductDiscount["type"]>(product?.promotion?.discount.type ?? "percentage");
  const [promotionValue, setPromotionValue] = useState(product?.promotion
    ? product.promotion.discount.type === "percentage" ? product.promotion.discount.value : product.promotion.discount.valueCop
    : "");
  const [promotionStartsOn, setPromotionStartsOn] = useState(product?.promotion?.startsOn ?? "");
  const [promotionEndsOn, setPromotionEndsOn] = useState(product?.promotion?.endsOn ?? "");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const packageWeightEnabled = unit === "unit" && weightPerUnit.trim() !== "";
    let promotion: ProductPromotion | null = null;
    if (promotionEnabled) {
      promotion = {
        discount: promotionType === "percentage"
          ? { type: "percentage", value: promotionValue }
          : { type: "fixed", valueCop: promotionValue },
        startsOn: promotionStartsOn,
        endsOn: promotionEndsOn
      };
    }
    const fields = {
      name, internalCode, barcode: barcode.trim() || null, costCop, salePriceCop, unit,
      weightPerUnit: packageWeightEnabled ? weightPerUnit : null,
      weightUnit: packageWeightEnabled ? weightUnit : null,
      promotion
    };
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
        {unit === "unit" && <>
          <label className="field">Peso por unidad/empaque <span className="optional-label">opcional</span><input inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={weightPerUnit} onChange={(event) => setWeightPerUnit(event.target.value)} placeholder="Ej. 2.5" /><small>Permite mostrar el peso estimado de la existencia.</small></label>
          <label className="field">Unidad del peso<select value={weightUnit} onChange={(event) => setWeightUnit(event.target.value as NonNullable<Product["weightUnit"]>)}><option value="g">Gramos (g)</option><option value="kg">Kilogramos (kg)</option><option value="lb">Libras (lb)</option></select></label>
        </>}
        <fieldset className="promotion-editor">
          <legend>Descuento programado</legend>
          <label className="active-check"><input type="checkbox" checked={promotionEnabled} onChange={(event) => setPromotionEnabled(event.target.checked)} /><span><strong>Activar promoción</strong><small>Se aplicará automáticamente en caja durante las fechas indicadas; el cajero podrá ajustarla para esa venta.</small></span></label>
          {promotionEnabled && <>
            <label className="field">Tipo de descuento<select value={promotionType} onChange={(event) => setPromotionType(event.target.value as ProductDiscount["type"])}><option value="percentage">Porcentaje (%)</option><option value="fixed">Valor fijo (COP por unidad)</option></select></label>
            <label className="field">{promotionType === "percentage" ? "Porcentaje de descuento" : "Descuento por unidad (COP)"}<input required inputMode={promotionType === "percentage" ? "decimal" : "numeric"} pattern={promotionType === "percentage" ? "(?:100(?:[.,]0{1,2})?|(?:0|[1-9][0-9]?)(?:[.,][0-9]{1,2})?)" : "[0-9]+"} maxLength={promotionType === "percentage" ? 6 : 19} value={promotionValue} onChange={(event) => setPromotionValue(event.target.value)} placeholder={promotionType === "percentage" ? "Ej. 10 o 10,5" : "Ej. 500"} /></label>
            <label className="field">Vigente desde<input required type="date" value={promotionStartsOn} onChange={(event) => setPromotionStartsOn(event.target.value)} /></label>
            <label className="field">Vigente hasta<input required type="date" min={promotionStartsOn || undefined} value={promotionEndsOn} onChange={(event) => setPromotionEndsOn(event.target.value)} /></label>
            <small className="promotion-date-note">Las fechas incluyen ambos días según el calendario de Colombia.</small>
          </>}
        </fieldset>
        {product ? (
          <label className="active-check"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span><strong>Producto activo</strong><small>Los productos inactivos no aparecen en la búsqueda normal.</small></span></label>
        ) : (
          <label className="field full-field">Existencia inicial ({unit === "unit" ? "unidades" : unit})<input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={initialStock} onChange={(event) => setInitialStock(event.target.value)} placeholder="0" /><small>Hasta tres decimales. Quedará registrado como movimiento inicial.</small></label>
        )}
        <div className="form-actions"><button className="quiet-button" type="button" onClick={onCancel}>Cancelar</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "Guardando…" : product ? "Guardar cambios" : "Crear producto"}</button></div>
      </form>
    </section>
  );
}
