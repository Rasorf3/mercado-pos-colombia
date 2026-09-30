import { Type, type Static } from "@sinclair/typebox";

const OptionalText = (maxLength: number) => Type.Union([
  Type.String({ minLength: 1, maxLength }),
  Type.Null()
]);

export const CompanyProfileInputSchema = Type.Object({
  businessName: Type.String({ minLength: 1, maxLength: 120 }),
  legalName: OptionalText(160),
  nit: OptionalText(32),
  verificationDigit: Type.Union([Type.String({ pattern: "^[0-9]$" }), Type.Null()]),
  address: OptionalText(240),
  city: OptionalText(100),
  department: OptionalText(100),
  phone: OptionalText(32),
  secondaryPhone: OptionalText(32),
  email: Type.Union([
    Type.String({ minLength: 3, maxLength: 254, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" }),
    Type.Null()
  ])
}, { additionalProperties: false });

export const CompanyProfileSchema = Type.Object({
  ...CompanyProfileInputSchema.properties,
  updatedAt: Type.String({ format: "date-time" }),
  updatedByUsername: Type.Union([Type.String({ minLength: 3, maxLength: 64 }), Type.Null()])
}, { additionalProperties: false });

export type CompanyProfileInput = Static<typeof CompanyProfileInputSchema>;
export type CompanyProfile = Static<typeof CompanyProfileSchema>;
