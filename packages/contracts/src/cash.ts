import { Type, type Static } from "@sinclair/typebox";
import { CopIntegerSchema, PaymentMethodSchema } from "./catalog.js";

const CashSessionIdSchema = Type.String({
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
});

const SignedCopIntegerSchema = Type.String({ pattern: "^-?\\d{1,19}$", maxLength: 20 });
const IsoTimestampSchema = Type.String({
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$"
});

export const OpenCashSessionInputSchema = Type.Object({
  openingCashCop: CopIntegerSchema
}, { additionalProperties: false });

export const CloseCashSessionInputSchema = Type.Object({
  countedCashCop: CopIntegerSchema
}, { additionalProperties: false });

export const CashAvailabilitySchema = Type.Object({
  isOpen: Type.Boolean(),
  openedAt: Type.Union([IsoTimestampSchema, Type.Null()]),
  openedByUsername: Type.Union([Type.String({ minLength: 3, maxLength: 64 }), Type.Null()])
}, { additionalProperties: false });

export const CashPaymentTotalSchema = Type.Object({
  method: PaymentMethodSchema,
  amountCop: CopIntegerSchema,
  salesCount: Type.Integer({ minimum: 1 })
}, { additionalProperties: false });

export const CashSessionSchema = Type.Object({
  id: CashSessionIdSchema,
  status: Type.Union([Type.Literal("open"), Type.Literal("closed")]),
  openingCashCop: CopIntegerSchema,
  openedAt: IsoTimestampSchema,
  openedByUsername: Type.Union([Type.String({ minLength: 3, maxLength: 64 }), Type.Null()]),
  closedAt: Type.Union([IsoTimestampSchema, Type.Null()]),
  closedByUsername: Type.Union([Type.String({ minLength: 3, maxLength: 64 }), Type.Null()]),
  salesCount: Type.Integer({ minimum: 0 }),
  totalSalesCop: CopIntegerSchema,
  cashSalesCop: CopIntegerSchema,
  expectedCashCop: CopIntegerSchema,
  countedCashCop: Type.Union([CopIntegerSchema, Type.Null()]),
  varianceCashCop: Type.Union([SignedCopIntegerSchema, Type.Null()]),
  paymentTotals: Type.Array(CashPaymentTotalSchema)
}, { additionalProperties: false });

export const CashOverviewSchema = Type.Object({
  activeSession: Type.Union([CashSessionSchema, Type.Null()]),
  recentSessions: Type.Array(CashSessionSchema, { maxItems: 20 })
}, { additionalProperties: false });

export type OpenCashSessionInput = Static<typeof OpenCashSessionInputSchema>;
export type CloseCashSessionInput = Static<typeof CloseCashSessionInputSchema>;
export type CashAvailability = Static<typeof CashAvailabilitySchema>;
export type CashPaymentTotal = Static<typeof CashPaymentTotalSchema>;
export type CashSession = Static<typeof CashSessionSchema>;
export type CashOverview = Static<typeof CashOverviewSchema>;
