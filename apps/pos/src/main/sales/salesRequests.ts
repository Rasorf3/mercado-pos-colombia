import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { SalesListSchema, type SalesListInput } from "@mercado-pos/contracts";

export function validateSalesRequest<T>(schema: object, input: unknown): asserts input is T {
  if (!Value.Check(schema as TSchema, input)) throw new Error("La solicitud de venta no es válida.");
}

// Date filters use calendar days in Colombia (UTC-05), independently of the PC timezone.
export function salesDateBounds(input: unknown): { from?: string; until?: string } {
  validateSalesRequest<SalesListInput>(SalesListSchema, input);
  for (const day of [input.dateFrom, input.dateTo]) {
    if (day === undefined) continue;
    const date = new Date(`${day}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day ||
        day < "0001-01-01" || day > "9998-12-31") {
      throw new Error("La fecha del historial no es válida.");
    }
  }
  if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) {
    throw new Error("La fecha inicial no puede ser posterior a la final.");
  }
  return {
    from: input.dateFrom ? new Date(`${input.dateFrom}T00:00:00-05:00`).toISOString() : undefined,
    until: input.dateTo ? new Date(new Date(`${input.dateTo}T00:00:00-05:00`).getTime() + 86400000).toISOString() : undefined
  };
}
