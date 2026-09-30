import Database from "better-sqlite3";
import type { CompanyProfile, CompanyProfileInput } from "@mercado-pos/contracts";
import { normalizeCompanyProfile } from "@mercado-pos/domain";

interface CompanyRow {
  business_name: string;
  legal_name: string | null;
  nit: string | null;
  verification_digit: string | null;
  address: string | null;
  city: string | null;
  department: string | null;
  phone: string | null;
  secondary_phone: string | null;
  email: string | null;
  updated_at: string;
  updated_by_username: string | null;
}

export class CompanyService {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  get(): CompanyProfile | null {
    const row = this.database.prepare(`
      SELECT p.business_name, p.legal_name, p.nit, p.verification_digit,
             p.address, p.city, p.department, p.phone, p.secondary_phone,
             p.email, p.updated_at, u.username AS updated_by_username
      FROM company_profile p
      LEFT JOIN pos_users u ON u.id = p.updated_by_user_id
      WHERE p.id = 1
    `).get() as CompanyRow | undefined;
    return row ? toCompanyProfile(row) : null;
  }

  save(input: CompanyProfileInput, userId: string): CompanyProfile {
    const company = normalizeCompanyProfile(input);
    const saveProfile = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO company_profile (
          id, business_name, legal_name, nit, verification_digit, address, city,
          department, phone, secondary_phone, email, updated_by_user_id, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          business_name = excluded.business_name,
          legal_name = excluded.legal_name,
          nit = excluded.nit,
          verification_digit = excluded.verification_digit,
          address = excluded.address,
          city = excluded.city,
          department = excluded.department,
          phone = excluded.phone,
          secondary_phone = excluded.secondary_phone,
          email = excluded.email,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = excluded.updated_at
      `).run(
        company.businessName, company.legalName, company.nit, company.verificationDigit,
        company.address, company.city, company.department, company.phone,
        company.secondaryPhone, company.email, userId, new Date().toISOString()
      );
      return this.get()!;
    });
    return saveProfile.immediate();
  }
}

function toCompanyProfile(row: CompanyRow): CompanyProfile {
  return {
    businessName: row.business_name,
    legalName: row.legal_name,
    nit: row.nit,
    verificationDigit: row.verification_digit,
    address: row.address,
    city: row.city,
    department: row.department,
    phone: row.phone,
    secondaryPhone: row.secondary_phone,
    email: row.email,
    updatedAt: row.updated_at,
    updatedByUsername: row.updated_by_username
  };
}
