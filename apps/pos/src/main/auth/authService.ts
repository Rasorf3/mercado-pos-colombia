import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import Database from "better-sqlite3";
import type {
  AuthState,
  BootstrapAdminInput,
  LoginInput,
  User,
  UserCreateInput,
  UserRole
} from "@mercado-pos/contracts";
import { roleCan, type Capability } from "@mercado-pos/domain";

const PASSWORD_BYTES = 64;
const PASSWORD_MIN_LENGTH = 5;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 30_000;
const DUMMY_SALT = randomBytes(16).toString("hex");

interface UserRow {
  id: string;
  username: string;
  password_salt?: string;
  password_hash?: string;
  role: UserRole;
  active: bigint;
  created_at: string;
  last_login_at: string | null;
}

interface LoginFailures {
  count: number;
  lockedUntil: number;
}

export class AuthService {
  private readonly database: Database.Database;
  private readonly sessions = new Map<number, string>();
  private readonly failures = new Map<string, LoginFailures>();

  constructor(database: Database.Database) {
    this.database = database;
  }

  async bootstrapAdmin(input: BootstrapAdminInput, sessionKey: number): Promise<User> {
    const username = normalizeUsername(input.username);
    validatePassword(input.password);
    const { salt, hash } = await hashPassword(input.password);
    const create = this.database.transaction(() => {
      const count = this.database.prepare("SELECT count(*) AS count FROM pos_users WHERE remote_actor=0").get() as { count: bigint };
      if (count.count !== 0n) throw new Error("La caja ya tiene usuarios configurados. Inicia sesión.");
      const now = new Date().toISOString();
      const id = randomUUID();
      this.database.prepare(`
        INSERT INTO pos_users (id, username, password_salt, password_hash, role, active, created_at, updated_at, last_login_at)
        VALUES (?, ?, ?, ?, 'admin', 1, ?, ?, ?)
      `).run(id, username, salt, hash, now, now, now);
      this.sessions.set(sessionKey, id);
      return this.getById(id)!;
    });
    return toUser(create.immediate());
  }

  async login(input: LoginInput, sessionKey: number): Promise<User> {
    const username = normalizeUsername(input.username);
    const now = Date.now();
    const failure = this.failures.get(username);
    if (failure?.lockedUntil && failure.lockedUntil > now) {
      throw new Error("Demasiados intentos. Espera 30 segundos antes de volver a ingresar.");
    }

    const row = this.database.prepare(`
      SELECT id, username, password_salt, password_hash, role, active, created_at, last_login_at
      FROM pos_users WHERE username = ? COLLATE NOCASE AND remote_actor=0
    `).get(username) as UserRow | undefined;
    const actualHash = await hashPassword(input.password, row?.password_salt ?? DUMMY_SALT);
    const expectedHash = row?.password_hash ? Buffer.from(row.password_hash, "hex") : Buffer.alloc(PASSWORD_BYTES);
    const actualHashBytes = Buffer.from(actualHash.hash, "hex");
    const validHash = expectedHash.length === actualHashBytes.length && timingSafeEqual(expectedHash, actualHashBytes);
    if (!row || row.active !== 1n || !validHash) {
      const attempts = (failure?.count ?? 0) + 1;
      this.failures.set(username, {
        count: attempts,
        lockedUntil: attempts >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_LOCK_MS : 0
      });
      throw new Error("Usuario o contraseña no válidos.");
    }

    this.failures.delete(username);
    const lastLoginAt = new Date().toISOString();
    this.database.prepare("UPDATE pos_users SET last_login_at = ?, updated_at = ? WHERE id = ?")
      .run(lastLoginAt, lastLoginAt, row.id);
    this.sessions.set(sessionKey, row.id);
    return toUser({ ...row, last_login_at: lastLoginAt });
  }

  logout(sessionKey: number): void {
    this.sessions.delete(sessionKey);
  }

  state(sessionKey: number): AuthState {
    const userId = this.sessions.get(sessionKey);
    const user = userId ? this.getActiveUserById(userId) : null;
    if (userId && !user) this.sessions.delete(sessionKey);
    const count = this.database.prepare("SELECT count(*) AS count FROM pos_users WHERE remote_actor=0").get() as { count: bigint };
    return { needsBootstrap: count.count === 0n, user: user ? toUser(user) : null };
  }

  requireUser(sessionKey: number): User {
    const userId = this.sessions.get(sessionKey);
    const row = userId ? this.getActiveUserById(userId) : null;
    if (!row) {
      this.sessions.delete(sessionKey);
      throw new Error("La sesión terminó. Inicia sesión para continuar.");
    }
    return toUser(row);
  }

  requireCapability(sessionKey: number, capability: Capability): User {
    const user = this.requireUser(sessionKey);
    if (!roleCan(user.role, capability)) throw new Error("No tienes permiso para realizar esta acción.");
    return user;
  }

  listUsers(): User[] {
    const rows = this.database.prepare(`
      SELECT id, username, role, active, created_at, last_login_at
      FROM pos_users WHERE role != 'admin_master' AND remote_actor=0
      ORDER BY active DESC, role, username COLLATE NOCASE
    `).all() as UserRow[];
    return rows.map(toUser);
  }

  async createUser(input: UserCreateInput): Promise<User> {
    const username = normalizeUsername(input.username);
    validatePassword(input.password);
    if (!(["admin", "employee_manager", "employee"] as const).includes(input.role)) {
      throw new Error("Solo se pueden crear usuarios Admin, EmpleadoJefe o Empleado; AdminMaster no es asignable.");
    }
    const { salt, hash } = await hashPassword(input.password);
    const now = new Date().toISOString();
    const id = randomUUID();
    try {
      this.database.prepare(`
        INSERT INTO pos_users (id, username, password_salt, password_hash, role, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `).run(id, username, salt, hash, input.role, now, now);
    } catch (error) {
      if (error instanceof Error && /pos_users\.username|UNIQUE constraint failed: pos_users\.username/i.test(error.message)) {
        throw new Error("Ya existe un usuario con ese nombre.");
      }
      throw error;
    }
    return toUser(this.getById(id)!);
  }

  setUserActive(userId: string, active: boolean, actingUserId: string): User {
    if (userId === actingUserId && !active) throw new Error("No puedes desactivar tu propio usuario mientras tienes la sesión abierta.");
    const update = this.database.transaction(() => {
      if(this.database.prepare("SELECT 1 FROM pos_users WHERE id=? AND remote_actor=1").get(userId)) throw new Error("Los actores de otras cajas no son cuentas locales administrables.");
      const target = this.getById(userId);
      if (!target || target.role === "admin_master") throw new Error("No se encontró el usuario administrable.");
      if (!active && target.active === 1n && target.role === "admin") {
        const admins = this.database.prepare("SELECT count(*) AS count FROM pos_users WHERE role = 'admin' AND active = 1").get() as { count: bigint };
        if (admins.count <= 1n) throw new Error("Debe permanecer al menos un usuario Admin activo.");
      }
      const now = new Date().toISOString();
      this.database.prepare("UPDATE pos_users SET active = ?, updated_at = ? WHERE id = ?")
        .run(active ? 1n : 0n, now, userId);
      return this.getById(userId)!;
    });
    return toUser(update.immediate());
  }

  private getById(id: string): UserRow | undefined {
    return this.database.prepare(`
      SELECT id, username, password_salt, password_hash, role, active, created_at, last_login_at
      FROM pos_users WHERE id = ?
    `).get(id) as UserRow | undefined;
  }

  private getActiveUserById(id: string): UserRow | undefined {
    const row = this.getById(id);
    return row?.active === 1n ? row : undefined;
  }
}

function normalizeUsername(input: string): string {
  const username = input.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    throw new Error("El usuario debe tener 3–64 caracteres: letras sin tilde, números, punto, guion o guion bajo.");
  }
  return username;
}

function validatePassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > 128) {
    throw new Error(`La contraseña debe tener entre ${PASSWORD_MIN_LENGTH} y 128 caracteres.`);
  }
}

async function hashPassword(password: string, salt = randomBytes(16).toString("hex")): Promise<{ salt: string; hash: string }> {
  const result = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, PASSWORD_BYTES, { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
  return { salt, hash: result.toString("hex") };
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    active: row.active === 1n,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at
  };
}
