import assert from "node:assert/strict";
import test from "node:test";
import { roleCan } from "../dist/access.js";

test("roles only receive their explicitly assigned capabilities", () => {
  assert.equal(roleCan("admin", "users:manage"), true);
  assert.equal(roleCan("employee_manager", "inventory:manage"), true);
  assert.equal(roleCan("employee_manager", "catalog:sale-read"), true);
  assert.equal(roleCan("employee_manager", "sales:create"), true);
  assert.equal(roleCan("employee_manager", "sales:history"), true);
  assert.equal(roleCan("employee_manager", "clients:lookup-for-sale"), true);
  assert.equal(roleCan("employee_manager", "clients:manage"), true);
  assert.equal(roleCan("employee_manager", "users:manage"), false);
  assert.equal(roleCan("employee", "sales:create"), true);
  assert.equal(roleCan("employee", "sales:history"), false);
  assert.equal(roleCan("employee", "clients:create"), true);
  assert.equal(roleCan("employee", "clients:manage"), false);
  assert.equal(roleCan("admin_master", "users:manage"), true);
});
