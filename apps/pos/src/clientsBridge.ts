import type { Client, ClientCreateInput, ClientSearchInput, ClientUpdateInput, SaleClientMatch } from "@mercado-pos/contracts";

export const CLIENTS_CHANNELS = {
  list: "clients:list",
  create: "clients:create",
  update: "clients:update",
  searchForSale: "clients:search-for-sale"
} as const;

export interface ClientsBridge {
  searchForSale(query: string): Promise<SaleClientMatch[]>;
  list(input: ClientSearchInput): Promise<Client[]>;
  create(input: ClientCreateInput): Promise<Client>;
  update(id: string, input: ClientUpdateInput): Promise<Client>;
}
