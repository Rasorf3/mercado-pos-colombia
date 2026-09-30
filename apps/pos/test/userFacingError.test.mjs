import assert from "node:assert/strict";
import test from "node:test";
import { userFacingError } from "../src/renderer/userFacingError.ts";

const fallback = "No se pudo registrar el abono. Inténtalo de nuevo.";

test("muestra la razón de negocio sin exponer el canal IPC", () => {
  const error = new Error("Error invoking remote method 'receivables:record-payment': Error: Abre un turno de caja antes de registrar un abono en efectivo.");
  assert.equal(userFacingError(error, fallback), "Abre un turno de caja antes de registrar un abono en efectivo.");
});

test("conserva mensajes locales de validación", () => {
  assert.equal(userFacingError(new Error("Ingresa el efectivo recibido antes de registrar la venta."), fallback),
    "Ingresa el efectivo recibido antes de registrar la venta.");
});

test("oculta errores técnicos o respuestas inesperadas", () => {
  for (const error of [
    new Error("Error invoking remote method 'receivables:record-payment': Error: SQLITE_CONSTRAINT: client_credit_entries"),
    new Error("Error invoking remote method 'sales:create-sale': TypeError: Cannot read properties of undefined"),
    new Error("Error invoking remote method 'sales:create-sale': Error: No handler registered for 'sales:create-sale'"),
    new Error("Error invoking remote method 'sales:create-sale': Error: La consulta falló en C:\\app\\main.js:42"),
    new Error("Cannot find module better-sqlite3"),
    new Error("Error invoking remote method 'broken': Error: mensaje\n    at main.js:1"),
    "Error invocando método",
    null
  ]) {
    assert.equal(userFacingError(error, fallback), fallback);
  }
});
