import type { Client, ClientCreateInput, ClientSearchInput, ClientUpdateInput } from "@mercado-pos/contracts";

export const CLIENTS_CHANNELS = {
  list: "clients:list",
  create: "clients:create",
  update: "clients:update"
} as const;

export interface ClientsBridge {
  list(input: ClientSearchInput): Promise<Client[]>;
  create(input: ClientCreateInput): Promise<Client>;
  update(id: string, input: ClientUpdateInput): Promise<Client>;
}
