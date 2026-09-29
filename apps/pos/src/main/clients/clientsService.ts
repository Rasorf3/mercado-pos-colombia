import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { normalizeClientDraft } from "@mercado-pos/domain";
import type { Client, ClientCreateInput, ClientSearchInput, ClientUpdateInput } from "@mercado-pos/contracts";

interface ClientRow {
  id: string;
  name: string;
  document_type: string | null;
  document_number: string | null;
  email: string | null;
  active: bigint;
  created_at: string;
  updated_at: string;
}

export class ClientNotFoundError extends Error {
  constructor() {
    super("No se encontró el cliente.");
    this.name = "ClientNotFoundError";
  }
}

export class DuplicateClientIdentityError extends Error {
  constructor() {
    super("Ya existe un cliente con ese tipo y número de identificación.");
    this.name = "DuplicateClientIdentityError";
  }
}

export class ClientsService {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  list(input: ClientSearchInput): Client[] {
    const query = input.query.trim();
    const rows = this.database.prepare(`
      SELECT id, name, document_type, document_number, email, active, created_at, updated_at
      FROM clients
      WHERE (? = 1 OR active = 1)
        AND (
          ? = '' OR instr(lower(name), lower(?)) > 0
          OR instr(lower(COALESCE(document_type, '')), lower(?)) > 0
          OR instr(lower(COALESCE(document_number, '')), lower(?)) > 0
          OR instr(lower(COALESCE(email, '')), lower(?)) > 0
        )
      ORDER BY active DESC, name COLLATE NOCASE
      LIMIT 100
    `).all(
      input.includeInactive ? 1n : 0n,
      query,
      query,
      query,
      query,
      query
    ) as ClientRow[];
    return rows.map(toClient);
  }

  create(input: ClientCreateInput): Client {
    const draft = normalizeClientDraft(input);
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      this.database.prepare(`
        INSERT INTO clients (
          id, name, document_type, document_number, email, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `).run(id, draft.name, draft.documentType, draft.documentNumber, draft.email, now, now);
    } catch (error) {
      throw translateDatabaseError(error);
    }
    return this.getById(id);
  }

  update(id: string, input: ClientUpdateInput): Client {
    const draft = normalizeClientDraft(input);
    try {
      const result = this.database.prepare(`
        UPDATE clients SET name = ?, document_type = ?, document_number = ?, email = ?,
          active = ?, updated_at = ?
        WHERE id = ?
      `).run(
        draft.name,
        draft.documentType,
        draft.documentNumber,
        draft.email,
        input.active ? 1n : 0n,
        new Date().toISOString(),
        id
      );
      if (result.changes !== 1) throw new ClientNotFoundError();
    } catch (error) {
      throw translateDatabaseError(error);
    }
    return this.getById(id);
  }

  private getById(id: string): Client {
    const row = this.database.prepare(`
      SELECT id, name, document_type, document_number, email, active, created_at, updated_at
      FROM clients WHERE id = ?
    `).get(id) as ClientRow | undefined;
    if (!row) throw new ClientNotFoundError();
    return toClient(row);
  }
}

function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    documentType: row.document_type,
    documentNumber: row.document_number,
    email: row.email,
    active: row.active === 1n,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function translateDatabaseError(error: unknown): Error {
  if (error instanceof Error && /clients_document_unique/.test(error.message)) {
    return new DuplicateClientIdentityError();
  }
  return error instanceof Error ? error : new Error("No se pudo guardar el cliente.");
}
