import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthService } from "../src/main/auth/authService.ts";
import { CompanyService } from "../src/main/company/companyService.ts";
import { openPosDatabase } from "../src/main/database/database.ts";

const input = {
  businessName: " Mercado Los Pinos ", legalName: " Los Pinos SAS ", nit: " 000901234567 ",
  verificationDigit: " 3 ", address: " Calle 1 # 2-3 ", city: " Medellín ",
  department: " Antioquia ", phone: " 6041234567 ", secondaryPhone: null,
  email: " ADMIN@EJEMPLO.CO "
};

test("la migración conserva el perfil al reabrir SQLite y registra quién lo modificó", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mercado-pos-company-"));
  const file = join(directory, "company.sqlite");
  let database = openPosDatabase(file);
  context.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });
  const auth = new AuthService(database);
  const admin = await auth.bootstrapAdmin({ username: "adminlocal", password: "Clave robusta 2026!" }, 1);
  const manager = await auth.createUser({ username: "jefelocal", password: "Clave robusta 2026!", role: "employee_manager" });
  const employee = await auth.createUser({ username: "cajerolocal", password: "Clave robusta 2026!", role: "employee" });
  assert.equal(new CompanyService(database).get(), null);
  assert.equal(auth.requireCapability(1, "company:manage").id, admin.id);
  await auth.login({ username: "jefelocal", password: "Clave robusta 2026!" }, 2);
  await auth.login({ username: "cajerolocal", password: "Clave robusta 2026!" }, 3);
  assert.throws(() => auth.requireCapability(2, "company:manage"), /No tienes permiso/);
  assert.throws(() => auth.requireCapability(3, "company:manage"), /No tienes permiso/);
  assert.notEqual(manager.id, employee.id);

  let service = new CompanyService(database);
  assert.throws(() => service.save({ ...input, businessName: " " }, admin.id), /nombre del comercio/);
  assert.equal(service.get(), null);
  const saved = service.save(input, admin.id);
  assert.equal(saved.businessName, "Mercado Los Pinos");
  assert.equal(saved.nit, "000901234567");
  assert.equal(saved.email, "admin@ejemplo.co");
  assert.equal(saved.updatedByUsername, admin.username);
  assert.equal(database.prepare("SELECT count(*) AS total FROM company_profile").get().total, 1n);
  assert.throws(() => service.save({ ...input, nit: "NIT-inválido" }, admin.id), /NIT solo/);
  assert.equal(service.get()?.nit, "000901234567");

  database.close();
  database = openPosDatabase(file);
  service = new CompanyService(database);
  assert.equal(service.get()?.address, "Calle 1 # 2-3");
  assert.equal(database.prepare("SELECT count(*) AS total FROM schema_migrations WHERE version = 9").get().total, 1n);
  service.save({ ...input, businessName: "Mercado Nuevo", nit: null, verificationDigit: null }, admin.id);
  assert.equal(service.get()?.businessName, "Mercado Nuevo");
  assert.equal(service.get()?.nit, null);
  assert.equal(database.prepare("SELECT count(*) AS total FROM company_profile").get().total, 1n);
});
