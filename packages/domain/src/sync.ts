import { SYNC_TABLES, type SyncOperation, type SyncRow, type SyncTable, type SyncTableSpec } from "@mercado-pos/contracts";
import { calculateSaleAmounts, normalizeSalePayment } from "./sales.js";
import { discountFromStored } from "./discounts.js";
import { formatQuantityMilli, MAX_SQLITE_INTEGER, normalizeProductDraft } from "./catalog.js";
import { normalizeClientDraft } from "./clients.js";
import { roleCan, type Capability } from "./access.js";

export function syncRowKey(table: SyncTable, row: SyncRow): string {
  return SYNC_TABLES[table].keys.map((key) => row[key]).join(":");
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function inventoryBalance(deltas: Iterable<string>): { signed: bigint; available: bigint; shortage: bigint } {
  let signed = 0n;
  for (const delta of deltas) signed += BigInt(delta);
  if (signed > MAX_SQLITE_INTEGER || signed < -MAX_SQLITE_INTEGER) throw new Error("La existencia acumulada excede el límite permitido.");
  return { signed, available: signed < 0n ? 0n : signed, shortage: signed < 0n ? -signed : 0n };
}

const permitted: Record<SyncOperation["kind"], readonly SyncTable[]> = {
  bootstrap: Object.keys(SYNC_TABLES) as SyncTable[],
  product: ["products", "inventory_movements"], inventory: ["inventory_movements"],
  client: ["clients", "client_credit_limit_events"], credit_limit: ["clients", "client_credit_limit_events"],
  sale: ["sales", "sale_items", "sale_buyer_snapshots", "sale_payments", "inventory_movements", "client_credit_entries"],
  cash: ["cash_sessions", "cash_session_payment_totals", "cash_session_credit_payment_totals"],
  credit_payment: ["client_credit_entries"]
};
const capabilities: Record<SyncOperation["kind"], Capability> = {
  bootstrap: "sync:manage", product: "catalog:manage", inventory: "inventory:manage", client: "clients:create",
  credit_limit: "clients:credit-manage", sale: "sales:create", cash: "cash:close", credit_payment: "credit:collect"
};

export function validateSyncOperation(operation: SyncOperation): void {
  if (operation.kind !== "bootstrap" && (!operation.actor || !roleCan(operation.actor.role, capabilities[operation.kind]))) throw new Error("No tienes permiso para sincronizar esta operación.");
  if (!Number.isFinite(Date.parse(operation.createdAt))) throw new Error("La fecha de la operación no es válida.");
  const seen = new Set<string>();
  for (const change of operation.changes) {
    if (!permitted[operation.kind].includes(change.table)) throw new Error("La operación contiene datos no autorizados.");
    if (change.key !== syncRowKey(change.table, change.row) || seen.has(`${change.table}:${change.key}`)) throw new Error("Identificador repetido o inválido en la operación.");
    seen.add(`${change.table}:${change.key}`);
    const spec: SyncTableSpec = SYNC_TABLES[change.table];
    for (const field of spec.integers) {
      const value = change.row[field];
      if (value !== null && (BigInt(value) > MAX_SQLITE_INTEGER || BigInt(value) < -MAX_SQLITE_INTEGER)) throw new Error("Un importe o cantidad excede el límite permitido.");
    }
    const r = change.row;
    if ((change.table==="products" || change.table==="clients") && !["0","1"].includes(r.active!)) throw new Error("El estado activo no es válido.");
    if (change.table === "products") normalizeProductDraft({ name: r.name!, internalCode: r.internal_code!, barcode: r.barcode, costCop: r.cost_cop!, salePriceCop: r.sale_price_cop!, unit: r.unit as never, weightPerUnit: r.weight_per_unit_milli === null ? null : formatQuantityMilli(BigInt(r.weight_per_unit_milli!)), weightUnit: r.weight_unit as never, promotion: r.promotion_discount_type === null ? null : { discount: discountFromStored(r.promotion_discount_type, BigInt(r.promotion_discount_value!))!, startsOn: r.promotion_starts_on!, endsOn: r.promotion_ends_on! } });
    if (change.table === "clients") normalizeClientDraft({ name: r.name!, documentType: r.document_type, documentNumber: r.document_number, email: r.email, phone: r.phone, address: r.address, creditLimitCop: r.credit_limit_cop! });
    if (change.table === "inventory_movements") {
      const before = BigInt(r.stock_before_milli!), after = BigInt(r.stock_after_milli!), delta = BigInt(r.quantity_milli!);
      if (before < 0n || after < 0n || before + delta !== after || !r.note?.trim()) throw new Error("El movimiento de inventario no es válido.");
      if (!(["initial", "entry", "adjustment", "sale_out"].includes(r.type!)) || (r.type === "initial" && (before !== 0n || delta < 0n)) || (r.type === "entry" && delta <= 0n) || (r.type === "adjustment" && delta === 0n) || (r.type === "sale_out" && (delta >= 0n || !r.sale_id))) throw new Error("El tipo o la cantidad del movimiento no son válidos.");
      if(r.type!=="sale_out" && r.sale_id!==null || operation.kind==="inventory" && !["entry","adjustment"].includes(r.type!) || operation.kind==="product" && r.type!=="initial") throw new Error("El movimiento no corresponde a esta operación.");
    }
    if(change.table==="client_credit_entries") {
      if(BigInt(r.amount_cop!)<=0n)throw new Error("El importe de cartera debe ser positivo.");
      if(r.entry_type==="payment") {
        if(r.sale_id!==null || r.method_id==="cash" && !r.cash_session_id)throw new Error("El abono no tiene una vinculación válida a caja.");
        normalizeSalePayment({method:r.method_id as never,amountPaidCop:r.amount_cop!,reference:r.reference??undefined,authorizationCode:r.authorization_code??undefined},BigInt(r.amount_cop!));
      } else if(r.entry_type!=="sale_charge" || !r.sale_id || r.method_id!==null || r.cash_session_id!==null || r.reference!==null || r.authorization_code!==null)throw new Error("El cargo de fiado no es válido.");
      if(operation.kind==="credit_payment" && r.entry_type!=="payment")throw new Error("La operación no corresponde a un abono.");
    }
  }
  if(operation.kind==="sale") {
    const sales=operation.changes.filter((c)=>c.table==="sales");
    if(sales.length!==1 || !sales[0].row.cash_session_id || operation.changes.some((c)=>c.table!=="sales" && c.row.sale_id!==sales[0].key)) throw new Error("La operación debe contener una venta completa vinculada a caja.");
  }
  for (const { row: sale } of operation.changes.filter((c) => c.table === "sales")) {
    const related = (table: SyncTable) => operation.changes.filter((c) => c.table === table && c.row.sale_id === sale.id).map((c) => c.row);
    const items = related("sale_items"), buyers = related("sale_buyer_snapshots"), payments = related("sale_payments"), charges = related("client_credit_entries");
    const amounts = calculateSaleAmounts(items.map((r) => ({ quantity: formatQuantityMilli(BigInt(r.quantity_milli!)), unitPriceCop: r.unit_price_cop!, discount: r.discount_type === null ? null : discountFromStored(r.discount_type, BigInt(r.discount_value!)) })));
    if (!items.length || buyers.length !== 1 || sale.status !== "local_pending_invoice" || BigInt(sale.total_cop!) !== amounts.totalCop) throw new Error("La instantánea de venta está incompleta o su total es inválido.");
    items.forEach((r, index) => {
      if (BigInt(r.line_total_cop!) !== amounts.lineTotalsCop[index] || BigInt(r.discount_total_cop!) !== amounts.lineDiscountsCop[index]) throw new Error("Los importes de la línea no son válidos.");
      const movement = related("inventory_movements").filter((m) => m.product_id === r.product_id);
      if (movement.length !== 1 || movement[0].type !== "sale_out" || BigInt(movement[0].quantity_milli!) !== -BigInt(r.quantity_milli!)) throw new Error("La venta no contiene su movimiento de stock.");
    });
    if (sale.settlement_type === "paid") {
      if (payments.length !== 1 || charges.length) throw new Error("La venta pagada debe tener un único pago.");
      const p = payments[0];
      const normalized = normalizeSalePayment({ method: p.method_id as never, amountPaidCop: p.amount_paid_cop!, reference: p.reference ?? undefined, authorizationCode: p.authorization_code ?? undefined }, amounts.totalCop);
      if (normalized.changeCop !== BigInt(p.change_cop!)) throw new Error("El cambio del pago es inválido.");
    } else if (sale.settlement_type !== "on_account" || payments.length || charges.length !== 1 || charges[0].entry_type !== "sale_charge" || charges[0].client_id !== buyers[0].client_id || BigInt(charges[0].amount_cop!) !== amounts.totalCop || amounts.totalCop <= 0n) throw new Error("El cargo de fiado no coincide con la venta.");
  }
}
