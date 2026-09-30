import { Type, type Static } from "@sinclair/typebox";
import { PaymentMethodSchema } from "./catalog.js";
import { ClientIdSchema } from "./clients.js";

const CopIntegerSchema = Type.String({ pattern: "^\\d+$", maxLength: 19 });

export const ReceivablesSearchSchema = Type.Object({
  query: Type.String({ maxLength: 120 })
}, { additionalProperties: false });

export const CreditPaymentInputSchema = Type.Object({
  clientId: ClientIdSchema,
  amountCop: CopIntegerSchema,
  method: PaymentMethodSchema,
  reference: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  authorizationCode: Type.Optional(Type.String({ minLength: 1, maxLength: 64 }))
}, { additionalProperties: false });

export const ClientCreditAccountSummarySchema = Type.Object({
  clientId: ClientIdSchema,
  name: Type.String({ minLength: 1, maxLength: 120 }),
  documentType: Type.Union([Type.String({ maxLength: 32 }), Type.Null()]),
  documentNumber: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
  phone: Type.Union([Type.String({ maxLength: 32 }), Type.Null()]),
  creditLimitCop: CopIntegerSchema,
  balanceCop: CopIntegerSchema,
  availableCreditCop: CopIntegerSchema
}, { additionalProperties: false });

export const ClientCreditEntrySchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  kind: Type.Union([Type.Literal("sale_charge"), Type.Literal("payment")]),
  saleId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  amountCop: CopIntegerSchema,
  method: Type.Union([PaymentMethodSchema, Type.Null()]),
  reference: Type.Union([Type.String({ maxLength: 120 }), Type.Null()]),
  authorizationCode: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
  createdByUsername: Type.Union([Type.String({ minLength: 3, maxLength: 64 }), Type.Null()]),
  createdAt: Type.String({ format: "date-time" })
}, { additionalProperties: false });

export const ClientCreditAccountSchema = Type.Object({
  ...ClientCreditAccountSummarySchema.properties,
  address: Type.Union([Type.String({ maxLength: 240 }), Type.Null()]),
  active: Type.Boolean(),
  entries: Type.Array(ClientCreditEntrySchema, { maxItems: 100 })
}, { additionalProperties: false });

export type ReceivablesSearchInput = Static<typeof ReceivablesSearchSchema>;
export type CreditPaymentInput = Static<typeof CreditPaymentInputSchema>;
export type ClientCreditAccountSummary = Static<typeof ClientCreditAccountSummarySchema>;
export type ClientCreditEntry = Static<typeof ClientCreditEntrySchema>;
export type ClientCreditAccount = Static<typeof ClientCreditAccountSchema>;
