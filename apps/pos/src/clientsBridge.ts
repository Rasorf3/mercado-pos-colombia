import type { Client, ClientCreateInput, ClientCreditLimitUpdate, ClientSearchInput, ClientUpdateInput, SaleClientMatch } from "@mercado-pos/contracts";

export const CLIENTS_CHANNELS = {
  list: "clients:list",
  create: "clients:create",
  update: "clients:update",
  searchForSale: "clients:search-for-sale",
  setCreditLimit: "clients:set-credit-limit"
} as const;

export interface ClientsBridge {
  searchForSale(query: string): Promise<SaleClientMatch[]>;
  list(input: ClientSearchInput): Promise<Client[]>;
  create(input: ClientCreateInput): Promise<Client>;
  update(id: string, input: ClientUpdateInput): Promise<Client>;
  setCreditLimit(id: string, input: ClientCreditLimitUpdate): Promise<Client>;
}
