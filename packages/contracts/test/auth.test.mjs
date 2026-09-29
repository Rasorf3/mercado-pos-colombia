import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "@sinclair/typebox/value";
import { BootstrapAdminInputSchema, UserCreateInputSchema } from "../dist/index.js";

test("el primer Admin exige contraseña robusta y los usuarios no pueden recibir AdminMaster", () => {
  assert.equal(Value.Check(BootstrapAdminInputSchema, { username: "admin1", password: "123456789012" }), true);
  assert.equal(Value.Check(BootstrapAdminInputSchema, { username: "admin1", password: "corta" }), false);
  assert.equal(Value.Check(UserCreateInputSchema, { username: "cajero1", password: "Clave segura 2026!", role: "employee" }), true);
  assert.equal(Value.Check(UserCreateInputSchema, { username: "soporte", password: "Clave segura 2026!", role: "admin_master" }), false);
  assert.equal(Value.Check(UserCreateInputSchema, { username: "jefe", password: "Clave segura 2026!", role: "employee_manager" }), false);
});
