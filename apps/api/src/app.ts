import Fastify, { type FastifyInstance } from "fastify";
import { HealthResponseSchema } from "@mercado-pos/contracts";
import { registerSyncRoutes } from "./sync/routes.js";
import { SyncRequestError, type SyncStore } from "./sync/syncStore.js";

export function buildApp(options: {sync?:SyncStore} = {}): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit:8*1024*1024, ajv:{customOptions:{removeAdditional:false,coerceTypes:false}} });
  app.setErrorHandler((error,_request,reply)=>{
    if(error instanceof SyncRequestError) return reply.code(error.statusCode).send({message:error.message});
    if(error && typeof error==="object" && "validation" in error) return reply.code(400).send({message:"La solicitud no tiene un formato válido."});
    return reply.code(500).send({message:"No se pudo completar la operación en el servidor. Puedes reintentar."});
  });
  if(options.sync) registerSyncRoutes(app,options.sync);

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
