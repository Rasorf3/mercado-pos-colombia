import { Type, type Static } from "@sinclair/typebox";
import { AssignableUserRoleSchema, UserIdSchema } from "./auth.js";

export interface SyncTableSpec {
  keys: readonly string[];
  text: readonly string[];
  integers: readonly string[];
  nullable: readonly string[];
  mutable?: boolean;
}

// This is the complete replication whitelist. Credentials and company settings are excluded.
export const SYNC_TABLES = {
  products: { keys: ["id"], mutable: true,
    text: ["id", "name", "internal_code", "barcode", "unit", "created_at", "updated_at", "weight_unit", "promotion_discount_type", "promotion_starts_on", "promotion_ends_on", "created_by_user_id", "updated_by_user_id"],
    integers: ["cost_cop", "sale_price_cop", "active", "weight_per_unit_milli", "promotion_discount_value"],
    nullable: ["barcode", "weight_unit", "weight_per_unit_milli", "promotion_discount_type", "promotion_discount_value", "promotion_starts_on", "promotion_ends_on", "created_by_user_id", "updated_by_user_id"] },
  clients: { keys: ["id"], mutable: true,
    text: ["id", "name", "document_type", "document_number", "email", "phone", "address", "created_at", "updated_at", "created_by_user_id", "updated_by_user_id"],
    integers: ["active", "credit_limit_cop"], nullable: ["document_type", "document_number", "email", "phone", "address", "created_by_user_id", "updated_by_user_id"] },
  cash_sessions: { keys: ["id"], mutable: true,
    text: ["id", "status", "opened_at", "opened_by_user_id", "closed_at", "closed_by_user_id", "origin_device_id"],
    integers: ["opening_cash_cop", "expected_cash_cop", "counted_cash_cop", "variance_cash_cop", "sales_count", "total_sales_cop", "cash_sales_cop", "credit_payments_cop", "cash_credit_payments_cop"],
    nullable: ["closed_at", "closed_by_user_id", "expected_cash_cop", "counted_cash_cop", "variance_cash_cop", "sales_count", "total_sales_cop", "cash_sales_cop"] },
  sales: { keys: ["id"], text: ["id", "status", "created_at", "created_by_user_id", "cash_session_id", "settlement_type"], integers: ["total_cop"], nullable: ["created_by_user_id", "cash_session_id"] },
  sale_buyer_snapshots: { keys: ["sale_id"], text: ["sale_id", "client_id", "buyer_name", "document_type", "document_number", "email", "phone", "address", "created_at"], integers: [], nullable: ["client_id", "buyer_name", "document_type", "document_number", "email", "phone", "address"] },
  sale_items: { keys: ["id"], text: ["id", "sale_id", "product_id", "product_name", "unit", "discount_type"], integers: ["quantity_milli", "unit_price_cop", "line_total_cop", "discount_value", "discount_total_cop"], nullable: ["discount_type", "discount_value"] },
  sale_payments: { keys: ["id"], text: ["id", "sale_id", "method_id", "reference", "authorization_code", "created_at"], integers: ["amount_paid_cop", "change_cop"], nullable: ["reference", "authorization_code"] },
  inventory_movements: { keys: ["id"], text: ["id", "product_id", "sale_id", "type", "note", "created_at", "created_by_user_id"], integers: ["quantity_milli", "stock_before_milli", "stock_after_milli"], nullable: ["sale_id", "created_by_user_id"] },
  client_credit_entries: { keys: ["id"], text: ["id", "client_id", "entry_type", "sale_id", "cash_session_id", "method_id", "reference", "authorization_code", "created_by_user_id", "created_at"], integers: ["amount_cop"], nullable: ["sale_id", "cash_session_id", "method_id", "reference", "authorization_code", "created_by_user_id"] },
  client_credit_limit_events: { keys: ["id"], text: ["id", "client_id", "changed_by_user_id", "created_at"], integers: ["previous_limit_cop", "new_limit_cop"], nullable: ["changed_by_user_id"] },
  cash_session_payment_totals: { keys: ["cash_session_id", "method_id"], text: ["cash_session_id", "method_id"], integers: ["total_cop", "sales_count"], nullable: [] },
  cash_session_credit_payment_totals: { keys: ["cash_session_id", "method_id"], text: ["cash_session_id", "method_id"], integers: ["total_cop", "payments_count"], nullable: [] }
} satisfies Record<string, SyncTableSpec>;

export type SyncTable = keyof typeof SYNC_TABLES;
export type SyncRow = Record<string, string | null>;
const nullableUuid = Type.Union([UserIdSchema, Type.Null()]);
export const SyncActorSchema = Type.Object({ id: UserIdSchema, username: Type.String({ minLength: 3, maxLength: 64 }), role: AssignableUserRoleSchema }, { additionalProperties: false });
const changeSchemas = Object.entries(SYNC_TABLES).map(([table, rawSpec]) => {
  const spec: SyncTableSpec = rawSpec;
  const fields = Object.fromEntries([...spec.text, ...spec.integers].map((name) => {
    const value = spec.integers.includes(name)
      ? Type.String({ pattern: "^-?(?:0|[1-9][0-9]*)$", maxLength: 20 })
      : name === "id" || (name.endsWith("_id") && name!=="method_id") ? UserIdSchema : Type.String({ maxLength: 500 });
    return [name, spec.nullable.includes(name) ? Type.Union([value, Type.Null()]) : value];
  }));
  return Type.Object({ table: Type.Literal(table), key: Type.String({ minLength: 1, maxLength: 80 }), baseId: nullableUuid, headId: Type.Optional(UserIdSchema), row: Type.Object(fields, { additionalProperties: false }) }, { additionalProperties: false });
});

export const SyncOperationSchema = Type.Object({
  id: UserIdSchema,
  kind: Type.Union(["bootstrap", "product", "inventory", "client", "sale", "cash", "credit_payment", "credit_limit"].map((kind) => Type.Literal(kind))),
  actor: Type.Union([SyncActorSchema, Type.Null()]),
  actors: Type.Array(Type.Object({ id: UserIdSchema, username: Type.String({ minLength: 3, maxLength: 64 }) }, { additionalProperties: false }), { maxItems: 1000 }),
  createdAt: Type.String({ maxLength: 30 }),
  creditReservationId: nullableUuid,
  changes: Type.Array(Type.Union(changeSchemas), { minItems: 1, maxItems: 5000 })
}, { additionalProperties: false });

export interface SyncChange { table: SyncTable; key: string; baseId: string | null; headId?: string; row: SyncRow }
export interface SyncOperation { id: string; kind: "bootstrap" | "product" | "inventory" | "client" | "sale" | "cash" | "credit_payment" | "credit_limit"; actor: Static<typeof SyncActorSchema> | null; actors: Array<{ id: string; username: string }>; createdAt: string; creditReservationId: string | null; changes: SyncChange[] }
export interface SyncEvent { sequence: string; deviceId: string; operation: SyncOperation }
export interface SyncConflict { id: string; kind: "stock_shortage" | "data_conflict"; entityId: string; label: string; quantityMilli: string | null; message: string; resolved: boolean; proposed?:SyncChange }
export const SyncConflictSchema=Type.Object({id:Type.String({minLength:1,maxLength:80}),kind:Type.Union([Type.Literal("stock_shortage"),Type.Literal("data_conflict")]),entityId:UserIdSchema,label:Type.String({maxLength:500}),quantityMilli:Type.Union([Type.String({pattern:"^[1-9][0-9]*$",maxLength:20}),Type.Null()]),message:Type.String({maxLength:500}),resolved:Type.Boolean(),proposed:Type.Optional(Type.Union(changeSchemas))},{additionalProperties:false});
export interface SyncStatus { configured: boolean; deviceId: string; deviceName: string | null; serverUrl: string | null; connected: boolean; pending: number; lastSyncAt: string | null; message: string; conflicts: SyncConflict[] }

export const SyncEnrollmentSchema = Type.Object({ merchantId: UserIdSchema, deviceId: UserIdSchema, deviceName: Type.String({ minLength: 1, maxLength: 64 }), pairingKey: Type.String({ minLength: 32, maxLength: 256 }), hasLocalData: Type.Boolean() }, { additionalProperties: false });
export const SyncSetupSchema = Type.Object({ serverUrl: Type.String({ minLength: 10, maxLength: 300 }), merchantId: UserIdSchema, deviceName: Type.String({ minLength: 1, maxLength: 64 }), pairingKey: Type.String({ minLength: 32, maxLength: 256 }) }, { additionalProperties: false });
export type SyncSetup = Static<typeof SyncSetupSchema>;
export const CreditReservationSchema = Type.Object({ id: UserIdSchema, clientId: UserIdSchema, deltaCop: Type.String({ pattern: "^-?[1-9][0-9]*$", maxLength: 20 }), actor: SyncActorSchema }, { additionalProperties: false });
export type CreditReservation = Static<typeof CreditReservationSchema>;
export const StockReconciliationSchema = Type.Object({ productId: UserIdSchema, countedQuantity: Type.String({ pattern: "^[0-9]+(?:[.,][0-9]{1,3})?$", maxLength: 24 }), note: Type.String({ minLength: 3, maxLength: 140 }) }, { additionalProperties: false });
