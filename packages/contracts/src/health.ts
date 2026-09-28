import { Type, type Static } from "@sinclair/typebox";

export const HealthResponseSchema = Type.Object({
  status: Type.Literal("ok"),
  service: Type.Literal("api"),
  timestamp: Type.String({ format: "date-time" })
});

export type HealthResponse = Static<typeof HealthResponseSchema>;
