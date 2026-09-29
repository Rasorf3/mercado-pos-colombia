import { Type, type Static } from "@sinclair/typebox";

export const SaleIdSchema = Type.String({
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
});

const CalendarDateSchema = Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" });

export const SalesListSchema = Type.Object({
  page: Type.Integer({ minimum: 1, maximum: 1000000 }),
  pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
  dateFrom: Type.Optional(CalendarDateSchema),
  dateTo: Type.Optional(CalendarDateSchema)
}, { additionalProperties: false });

export const ReceiptLayoutSchema = Type.Object({
  paperWidthMm: Type.Union([Type.Literal(58), Type.Literal(80)]),
  marginMm: Type.Integer({ minimum: 2, maximum: 8 }),
  pageHeightMm: Type.Integer({ minimum: 100, maximum: 400 })
}, { additionalProperties: false });

export const ReceiptRequestSchema = Type.Object({
  saleId: SaleIdSchema,
  layout: ReceiptLayoutSchema
}, { additionalProperties: false });

export type SalesListInput = Static<typeof SalesListSchema>;
export type ReceiptLayout = Static<typeof ReceiptLayoutSchema>;
export type ReceiptRequest = Static<typeof ReceiptRequestSchema>;
export interface SalesPage {
  sales: import("./catalog.js").SaleSummary[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ReceiptResult {
  status: "printed" | "saved" | "cancelled" | "error";
  message: string;
}
