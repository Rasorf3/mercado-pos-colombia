import type { ClientCreditAccount, ClientCreditAccountSummary, CreditPaymentInput } from "@mercado-pos/contracts";

export const RECEIVABLES_CHANNELS = {
  listAccounts: "receivables:list-accounts",
  getAccount: "receivables:get-account",
  recordPayment: "receivables:record-payment"
} as const;

export interface ReceivablesBridge {
  listAccounts(query: string): Promise<ClientCreditAccountSummary[]>;
  getAccount(clientId: string): Promise<ClientCreditAccount>;
  recordPayment(input: CreditPaymentInput): Promise<ClientCreditAccount>;
}
