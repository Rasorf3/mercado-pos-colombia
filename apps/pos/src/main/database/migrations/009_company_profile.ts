import type Database from "better-sqlite3";

export const COMPANY_PROFILE_MIGRATION = {
  version: 9,
  apply(database: Database.Database): void {
    database.exec(`
      CREATE TABLE company_profile (
        id INTEGER PRIMARY KEY NOT NULL CHECK(id = 1),
        business_name TEXT NOT NULL CHECK(length(trim(business_name)) BETWEEN 1 AND 120),
        legal_name TEXT CHECK(legal_name IS NULL OR length(trim(legal_name)) BETWEEN 1 AND 160),
        nit TEXT CHECK(nit IS NULL OR length(trim(nit)) BETWEEN 1 AND 32),
        verification_digit TEXT CHECK(verification_digit IS NULL OR verification_digit GLOB '[0-9]'),
        address TEXT CHECK(address IS NULL OR length(trim(address)) BETWEEN 1 AND 240),
        city TEXT CHECK(city IS NULL OR length(trim(city)) BETWEEN 1 AND 100),
        department TEXT CHECK(department IS NULL OR length(trim(department)) BETWEEN 1 AND 100),
        phone TEXT CHECK(phone IS NULL OR length(trim(phone)) BETWEEN 1 AND 32),
        secondary_phone TEXT CHECK(secondary_phone IS NULL OR length(trim(secondary_phone)) BETWEEN 1 AND 32),
        email TEXT CHECK(email IS NULL OR length(trim(email)) BETWEEN 3 AND 254),
        updated_by_user_id TEXT NOT NULL REFERENCES pos_users(id) ON DELETE RESTRICT,
        updated_at TEXT NOT NULL,
        CHECK(verification_digit IS NULL OR nit IS NOT NULL)
      ) STRICT;
    `);
  }
} as const;
