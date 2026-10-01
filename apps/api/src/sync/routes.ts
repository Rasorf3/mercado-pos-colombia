import type { FastifyInstance, FastifyRequest } from "fastify";
import { CreditReservationSchema, SyncEnrollmentSchema, SyncOperationSchema, SyncActorSchema, UserIdSchema, type CreditReservation, type SyncOperation } from "@mercado-pos/contracts";
import { SyncRequestError, type DeviceIdentity, type SyncStore } from "./syncStore.js";

export function registerSyncRoutes(app:FastifyInstance,store:SyncStore):void {
  const identity=async(request:FastifyRequest):Promise<DeviceIdentity>=>{
    const header=request.headers.authorization;
    if (!header || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) throw new SyncRequestError("Esta operación requiere una caja vinculada.",401);
    return store.authenticate(header.slice(7));
  };
  app.post("/sync/enroll",{schema:{body:SyncEnrollmentSchema}},async(request)=>store.enroll(request.body as Parameters<SyncStore["enroll"]>[0]));
  app.post("/sync/operations",{schema:{body:SyncOperationSchema}},async(request)=>store.push(await identity(request),request.body as SyncOperation));
  app.get("/sync/events",{schema:{querystring:{type:"object",properties:{after:{type:"string",pattern:"^(0|[1-9][0-9]*)$",maxLength:19}},required:["after"],additionalProperties:false}}},async(request)=>store.pull(await identity(request),(request.query as {after:string}).after));
  app.get("/sync/conflicts",async(request)=>({conflicts:await store.conflicts(await identity(request))}));
  app.post("/sync/credit-reservations",{schema:{body:CreditReservationSchema}},async(request)=>store.reserveCredit(await identity(request),request.body as CreditReservation));
  app.delete("/sync/credit-reservations/:id",{schema:{params:{type:"object",properties:{id:UserIdSchema},required:["id"],additionalProperties:false}}},async(request)=>{await store.cancelCredit(await identity(request),(request.params as {id:string}).id);return {cancelled:true};});
  app.post("/sync/conflicts/:id/review",{schema:{params:{type:"object",properties:{id:UserIdSchema},required:["id"],additionalProperties:false},body:{type:"object",properties:{actor:SyncActorSchema,note:{type:"string",minLength:3,maxLength:240}},required:["actor","note"],additionalProperties:false}}},async(request)=>{const body=request.body as {actor:SyncOperation["actor"];note:string};await store.reviewConflict(await identity(request),(request.params as {id:string}).id,body.actor,body.note);return {reviewed:true};});
}
