import Fastify, { type FastifyInstance } from "fastify";
import { HealthResponseSchema } from "@mercado-pos/contracts";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get(
    "/health",
    {
      schema: {
        response: {
          200: HealthResponseSchema
        }
      }
    },
    async () => ({
      status: "ok" as const,
      service: "api" as const,
      timestamp: new Date().toISOString()
    })
  );

  return app;
}
