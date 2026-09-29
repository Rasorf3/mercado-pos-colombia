import { Type, type Static } from "@sinclair/typebox";

export const ClientIdSchema = Type.String({
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
});

const ClientFields = {
  name: Type.String({ minLength: 1, maxLength: 120 }),
  documentType: Type.Union([Type.String({ minLength: 1, maxLength: 32 }), Type.Null()]),
  documentNumber: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
  email: Type.Union([
    Type.String({ minLength: 3, maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" }),
    Type.Null()
  ])
};

export const ClientCreateSchema = Type.Object(ClientFields, { additionalProperties: false });

export const ClientUpdateSchema = Type.Object({
  ...ClientFields,
  active: Type.Boolean()
}, { additionalProperties: false });

export const ClientSchema = Type.Object({
  id: ClientIdSchema,
  ...ClientFields,
  active: Type.Boolean(),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" })
}, { additionalProperties: false });

export const ClientSearchSchema = Type.Object({
  query: Type.String({ maxLength: 120 }),
  includeInactive: Type.Boolean()
}, { additionalProperties: false });

export const BuyerSnapshotSchema = Type.Object({
  clientId: ClientIdSchema,
  name: Type.String({ minLength: 1, maxLength: 120 }),
  documentType: Type.Union([Type.String({ maxLength: 32 }), Type.Null()]),
  documentNumber: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
  email: Type.Union([Type.String({ maxLength: 254 }), Type.Null()])
}, { additionalProperties: false });

export type ClientCreateInput = Static<typeof ClientCreateSchema>;
export type ClientUpdateInput = Static<typeof ClientUpdateSchema>;
export type Client = Static<typeof ClientSchema>;
export type ClientSearchInput = Static<typeof ClientSearchSchema>;
export type BuyerSnapshot = Static<typeof BuyerSnapshotSchema>;
