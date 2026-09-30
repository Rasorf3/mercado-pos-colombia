import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { normalizeClientDraft, parseCopInteger } from "@mercado-pos/domain";
import type { Client, ClientCreateInput, ClientSearchInput, ClientUpdateInput, SaleClientMatch } from "@mercado-pos/contracts";

interface ClientRow {
  id: string;
  name: string;
  document_type: string | null;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  credit_limit_cop: bigint;
  credit_balance_cop: bigint;
  active: bigint;
  created_at: string;
  updated_at: string;
}

interface SaleClientRow extends Pick<ClientRow,
  "id" | "name" | "document_type" | "document_number" | "email" | "phone" | "address" | "credit_limit_cop" | "credit_balance_cop"> {}

const CLIENT_SELECT = `
  SELECT c.id, c.name, c.document_type, c.document_number, c.email, c.phone, c.address,
         c.credit_limit_cop,
         COALESCE((
           SELECT SUM(CASE WHEN e.entry_type = 'sale_charge' THEN e.amount_cop ELSE -e.amount_cop END)
           FROM client_credit_entries e WHERE e.client_id = c.id
         ), 0) AS credit_balance_cop,
         c.active, c.created_at, c.updated_at
  FROM clients c
`;

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
      ${CLIENT_SELECT}
      WHERE (? = 1 OR c.active = 1)
        AND (
          ? = '' OR instr(lower(c.name), lower(?)) > 0
          OR instr(lower(COALESCE(c.document_type, '')), lower(?)) > 0
          OR instr(lower(COALESCE(c.document_number, '')), lower(?)) > 0
          OR instr(lower(COALESCE(c.email, '')), lower(?)) > 0
          OR instr(lower(COALESCE(c.phone, '')), lower(?)) > 0
          OR instr(lower(COALESCE(c.address, '')), lower(?)) > 0
        )
      ORDER BY c.active DESC, c.name COLLATE NOCASE
      LIMIT 100
    `).all(input.includeInactive ? 1n : 0n, query, query, query, query, query, query, query) as ClientRow[];
    return rows.map(toClient);
  }

  listForSale(query: string): SaleClientMatch[] {
    const normalized = query.trim();
    const rows = this.database.prepare(`
      ${CLIENT_SELECT}
      WHERE c.active = 1 AND (
        instr(lower(c.name), lower(?)) > 0
        OR instr(lower(COALESCE(c.document_type, '')), lower(?)) > 0
        OR instr(lower(COALESCE(c.document_number, '')), lower(?)) > 0
        OR instr(lower(COALESCE(c.email, '')), lower(?)) > 0
        OR instr(lower(COALESCE(c.phone, '')), lower(?)) > 0
      )
      ORDER BY c.name COLLATE NOCASE LIMIT 25
    `).all(normalized, normalized, normalized, normalized, normalized) as SaleClientRow[];
    return rows.map(toSaleClientMatch);
  }

  create(input: ClientCreateInput, actorUserId: string | null = null): Client {
    const draft = normalizeClientDraft(input);
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      const create = this.database.transaction(() => {
        this.database.prepare(`
          INSERT INTO clients (
            id, name, document_type, document_number, email, phone, address, credit_limit_cop,
            active, created_at, updated_at, created_by_user_id, updated_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        `).run(
          id, draft.name, draft.documentType, draft.documentNumber, draft.email, draft.phone,
          draft.address, BigInt(draft.creditLimitCop), now, now, actorUserId, actorUserId
        );
        return this.getById(id);
      });
      return create.immediate();
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  update(id: string, input: ClientUpdateInput, actorUserId: string | null = null): Client {
    try {
      const update = this.database.transaction(() => {
        const current = this.getRow(id);
        if (!current) throw new ClientNotFoundError();
        const draft = normalizeClientDraft({
          ...input,
          phone: input.phone === undefined ? current.phone : input.phone,
          address: input.address === undefined ? current.address : input.address,
          creditLimitCop: input.creditLimitCop ?? current.credit_limit_cop.toString()
        });
        const creditLimitCop = BigInt(draft.creditLimitCop);
        if (creditLimitCop < current.credit_balance_cop) {
          throw new Error("El límite de fiado no puede ser menor que el saldo pendiente del cliente.");
        }
        const now = new Date().toISOString();
        const result = this.database.prepare(`
          UPDATE clients SET name = ?, document_type = ?, document_number = ?, email = ?,
            phone = ?, address = ?, credit_limit_cop = ?, active = ?, updated_at = ?, updated_by_user_id = ?
          WHERE id = ?
        `).run(
          draft.name, draft.documentType, draft.documentNumber, draft.email, draft.phone,
          draft.address, creditLimitCop, input.active ? 1n : 0n, now, actorUserId, id
        );
        if (result.changes !== 1) throw new ClientNotFoundError();
        this.recordLimitChange(id, current.credit_limit_cop, creditLimitCop, actorUserId, now);
        return this.getById(id);
      });
      return update.immediate();
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  setCreditLimit(id: string, value: string, actorUserId: string | null = null): Client {
    const creditLimitCop = parseCopInteger(value);
    try {
      const update = this.database.transaction(() => {
        const current = this.getRow(id);
        if (!current) throw new ClientNotFoundError();
        if (creditLimitCop < current.credit_balance_cop) {
          throw new Error("El límite de fiado no puede ser menor que el saldo pendiente del cliente.");
        }
        const now = new Date().toISOString();
        const result = this.database.prepare(`
          UPDATE clients SET credit_limit_cop = ?, updated_at = ?, updated_by_user_id = ? WHERE id = ?
        `).run(creditLimitCop, now, actorUserId, id);
        if (result.changes !== 1) throw new ClientNotFoundError();
        this.recordLimitChange(id, current.credit_limit_cop, creditLimitCop, actorUserId, now);
        return this.getById(id);
      });
      return update.immediate();
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  private recordLimitChange(
    clientId: string,
    previous: bigint,
    next: bigint,
    actorUserId: string | null,
    at: string
  ): void {
    if (previous === next) return;
    this.database.prepare(`
      INSERT INTO client_credit_limit_events (
        id, client_id, previous_limit_cop, new_limit_cop, changed_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), clientId, previous, next, actorUserId, at);
  }

  private getRow(id: string): ClientRow | undefined {
    return this.database.prepare(`${CLIENT_SELECT} WHERE c.id = ?`).get(id) as ClientRow | undefined;
  }

  private getById(id: string): Client {
    const row = this.getRow(id);
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
    phone: row.phone,
    address: row.address,
    creditLimitCop: row.credit_limit_cop.toString(),
    creditBalanceCop: row.credit_balance_cop.toString(),
    active: row.active === 1n,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toSaleClientMatch(row: SaleClientRow): SaleClientMatch {
  return {
    id: row.id,
    name: row.name,
    documentType: row.document_type,
    documentNumber: row.document_number,
    email: row.email,
    phone: row.phone,
    address: row.address,
    creditLimitCop: row.credit_limit_cop.toString(),
    creditBalanceCop: row.credit_balance_cop.toString()
  };
}

function translateDatabaseError(error: unknown): Error {
  if (error instanceof Error && /clients_document_unique/.test(error.message)) {
    return new DuplicateClientIdentityError();
  }
  return error instanceof Error ? error : new Error("No se pudo guardar el cliente.");
}
