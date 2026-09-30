import type { CompanyProfile, CompanyProfileInput } from "@mercado-pos/contracts";

export const COMPANY_CHANNELS = {
  get: "company:get-profile",
  save: "company:save-profile"
} as const;

export interface CompanyBridge {
  get(): Promise<CompanyProfile | null>;
  save(input: CompanyProfileInput): Promise<CompanyProfile>;
}
