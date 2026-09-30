import type {
  CashAvailability,
  CashOverview,
  CashSession,
  CloseCashSessionInput,
  OpenCashSessionInput
} from "@mercado-pos/contracts";

export const CASH_CHANNELS = {
  availability: "cash:availability",
  overview: "cash:overview",
  open: "cash:open",
  close: "cash:close"
} as const;

export interface CashBridge {
  availability(): Promise<CashAvailability>;
  overview(): Promise<CashOverview>;
  open(input: OpenCashSessionInput): Promise<CashSession>;
  close(input: CloseCashSessionInput): Promise<CashSession>;
}
