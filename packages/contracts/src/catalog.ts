import { Type, type Static } from "@sinclair/typebox";
import { BuyerSnapshotSchema, ClientIdSchema } from "./clients.js";

const UuidSchema = Type.String({
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
});

export const ProductUnitSchema = Type.Union([
  Type.Literal("unit"),
  Type.Literal("kg"),
  Type.Literal("g"),
  Type.Literal("l"),
  Type.Literal("ml"),
  Type.Literal("m")
]);

export const ProductWeightUnitSchema = Type.Union([
  Type.Literal("g"),
  Type.Literal("kg"),
  Type.Literal("lb")
]);

export const CopIntegerSchema = Type.String({
  pattern: "^\\d+$",
  maxLength: 19
});

export const QuantityInputSchema = Type.String({
  pattern: "^\\d+(?:[.,]\\d{1,3})?$",
  maxLength: 24
});

export const SignedQuantityInputSchema = Type.String({
  pattern: "^[+-]?\\d+(?:[.,]\\d{1,3})?$",
  maxLength: 25
});

const ProductFields = {
  name: Type.String({ minLength: 1, maxLength: 120 }),
  internalCode: Type.String({ minLength: 1, maxLength: 64 }),
  barcode: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
  costCop: CopIntegerSchema,
  salePriceCop: CopIntegerSchema,
  unit: ProductUnitSchema
};

export const ProductCreateSchema = Type.Object({
  ...ProductFields,
  weightPerUnit: Type.Optional(Type.Union([QuantityInputSchema, Type.Null()])),
  weightUnit: Type.Optional(Type.Union([ProductWeightUnitSchema, Type.Null()])),
  initialStock: QuantityInputSchema
}, { additionalProperties: false });

export const ProductUpdateSchema = Type.Object({
  ...ProductFields,
  weightPerUnit: Type.Optional(Type.Union([QuantityInputSchema, Type.Null()])),
  weightUnit: Type.Optional(Type.Union([ProductWeightUnitSchema, Type.Null()])),
  active: Type.Boolean()
}, { additionalProperties: false });

export const ProductSchema = Type.Object({
  id: UuidSchema,
  ...ProductFields,
  active: Type.Boolean(),
  stock: QuantityInputSchema,
  weightPerUnit: Type.Union([QuantityInputSchema, Type.Null()]),
  weightUnit: Type.Union([ProductWeightUnitSchema, Type.Null()]),
  createdByUsername: Type.Union([Type.String({ minLength: 3, maxLength: 64 }), Type.Null()]),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" })
}, { additionalProperties: false });

export const SaleProductSchema = Type.Object({
  id: UuidSchema,
  name: Type.String({ minLength: 1, maxLength: 120 }),
  internalCode: Type.String({ minLength: 1, maxLength: 64 }),
  barcode: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
  salePriceCop: CopIntegerSchema,
  unit: ProductUnitSchema,
  active: Type.Boolean(),
  stock: QuantityInputSchema
}, { additionalProperties: false });

export const ProductSearchSchema = Type.Object({
  query: Type.String({ maxLength: 120 }),
  includeInactive: Type.Boolean()
}, { additionalProperties: false });

export const SaleProductSearchSchema = Type.Object({
  query: Type.String({ maxLength: 120 })
}, { additionalProperties: false });

export const InventoryEntrySchema = Type.Object({
  productId: UuidSchema,
  quantity: QuantityInputSchema,
  note: Type.String({ minLength: 1, maxLength: 240 })
}, { additionalProperties: false });

export const InventoryAdjustmentSchema = Type.Object({
  productId: UuidSchema,
  delta: SignedQuantityInputSchema,
  note: Type.String({ minLength: 1, maxLength: 240 })
}, { additionalProperties: false });

export const InventoryMovementSchema = Type.Object({
  id: UuidSchema,
  productId: UuidSchema,
  type: Type.Union([
    Type.Literal("initial"),
    Type.Literal("entry"),
    Type.Literal("adjustment"),
    Type.Literal("sale_out")
  ]),
  saleId: Type.Union([UuidSchema, Type.Null()]),
  quantity: SignedQuantityInputSchema,
  stockBefore: QuantityInputSchema,
  stockAfter: QuantityInputSchema,
  note: Type.String({ maxLength: 240 }),
  createdByUsername: Type.Union([Type.String({ minLength: 3, maxLength: 64 }), Type.Null()]),
  createdAt: Type.String({ format: "date-time" })
}, { additionalProperties: false });

export const PAYMENT_METHOD_OPTIONS = [
  { id: "cash", label: "Efectivo" },
  { id: "debit_card", label: "Tarjeta débito" },
  { id: "credit_card", label: "Tarjeta crédito" },
  { id: "bank_transfer", label: "Transferencia bancaria" },
  { id: "nequi", label: "Nequi" },
  { id: "daviplata", label: "DaviPlata" },
  { id: "bre_b", label: "Bre-B" }
] as const;

export const PaymentMethodSchema = Type.Union([
  Type.Literal("cash"),
  Type.Literal("debit_card"),
  Type.Literal("credit_card"),
  Type.Literal("bank_transfer"),
  Type.Literal("nequi"),
  Type.Literal("daviplata"),
  Type.Literal("bre_b")
]);

export const SaleStatusSchema = Type.Literal("local_pending_invoice");

export const SaleLineInputSchema = Type.Object({
  productId: UuidSchema,
  quantity: QuantityInputSchema
}, { additionalProperties: false });

export const SalePaymentInputSchema = Type.Object({
  method: PaymentMethodSchema,
  amountPaidCop: CopIntegerSchema,
  reference: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  authorizationCode: Type.Optional(Type.String({ minLength: 1, maxLength: 64 }))
}, { additionalProperties: false });

export const SaleCreateSchema = Type.Object({
  items: Type.Array(SaleLineInputSchema, { minItems: 1, maxItems: 100 }),
  payment: SalePaymentInputSchema,
  clientId: Type.Optional(ClientIdSchema)
}, { additionalProperties: false });

export const SalePaymentSchema = Type.Object({
  method: PaymentMethodSchema,
  amountPaidCop: CopIntegerSchema,
  changeCop: CopIntegerSchema,
  reference: Type.Union([Type.String({ maxLength: 120 }), Type.Null()]),
  authorizationCode: Type.Union([Type.String({ maxLength: 64 }), Type.Null()])
}, { additionalProperties: false });

export const SaleLineSchema = Type.Object({
  productId: UuidSchema,
  productName: Type.String({ minLength: 1, maxLength: 120 }),
  unit: ProductUnitSchema,
  quantity: QuantityInputSchema,
  unitPriceCop: CopIntegerSchema,
  lineTotalCop: CopIntegerSchema
}, { additionalProperties: false });

export const SaleSchema = Type.Object({
  id: UuidSchema,
  status: SaleStatusSchema,
  totalCop: CopIntegerSchema,
  createdByUsername: Type.Union([Type.String({ minLength: 3, maxLength: 64 }), Type.Null()]),
  items: Type.Array(SaleLineSchema, { minItems: 1, maxItems: 100 }),
  payment: SalePaymentSchema,
  buyer: Type.Union([BuyerSnapshotSchema, Type.Null()]),
  createdAt: Type.String({ format: "date-time" })
}, { additionalProperties: false });

export const SaleSummarySchema = Type.Object({
  id: UuidSchema,
  status: SaleStatusSchema,
  totalCop: CopIntegerSchema,
  createdByUsername: Type.Union([Type.String({ minLength: 3, maxLength: 64 }), Type.Null()]),
  payment: SalePaymentSchema,
  buyer: Type.Union([BuyerSnapshotSchema, Type.Null()]),
  createdAt: Type.String({ format: "date-time" })
}, { additionalProperties: false });

export type ProductUnit = Static<typeof ProductUnitSchema>;
export type ProductWeightUnit = Static<typeof ProductWeightUnitSchema>;
export type ProductCreateInput = Static<typeof ProductCreateSchema>;
export type ProductUpdateInput = Static<typeof ProductUpdateSchema>;
export type Product = Static<typeof ProductSchema>;
export type SaleProduct = Static<typeof SaleProductSchema>;
export type ProductSearchInput = Static<typeof ProductSearchSchema>;
export type SaleProductSearchInput = Static<typeof SaleProductSearchSchema>;
export type InventoryEntryInput = Static<typeof InventoryEntrySchema>;
export type InventoryAdjustmentInput = Static<typeof InventoryAdjustmentSchema>;
export type InventoryMovement = Static<typeof InventoryMovementSchema>;
export type PaymentMethod = Static<typeof PaymentMethodSchema>;
export type SaleStatus = Static<typeof SaleStatusSchema>;
export type { BuyerSnapshot } from "./clients.js";
export type SaleLineInput = Static<typeof SaleLineInputSchema>;
export type SalePaymentInput = Static<typeof SalePaymentInputSchema>;
export type SaleCreateInput = Static<typeof SaleCreateSchema>;
export type SalePayment = Static<typeof SalePaymentSchema>;
export type SaleLine = Static<typeof SaleLineSchema>;
export type Sale = Static<typeof SaleSchema>;
export type SaleSummary = Static<typeof SaleSummarySchema>;
