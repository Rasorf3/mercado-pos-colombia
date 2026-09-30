import assert from "node:assert/strict";
import test from "node:test";
import { normalizeClientDraft } from "../dist/clients.js";

test("normaliza los campos mínimos del comprador y conserva identificación como texto", () => {
  assert.deepEqual(normalizeClientDraft({
    name: "  Tienda La Esquina  ",
    documentType: " nit ",
    documentNumber: " 000123456-7 ",
    email: "  VENTAS@EJEMPLO.CO ",
    phone: " +57 300 123 4567 ",
    address: "  Calle 12 # 34-56  "
  }), {
    name: "Tienda La Esquina",
    documentType: "NIT",
    documentNumber: "000123456-7",
    email: "ventas@ejemplo.co",
    phone: "+57 300 123 4567",
    address: "Calle 12 # 34-56",
    creditLimitCop: "300000"
  });
});

test("rechaza perfil sin nombre, identificación incompleta y correo inválido", () => {
  const base = { name: "Cliente", documentType: null, documentNumber: null, email: null };
  assert.throws(() => normalizeClientDraft({ ...base, name: "   " }), /nombre del cliente/);
  assert.throws(() => normalizeClientDraft({ ...base, documentType: "CC" }), /tipo como el número/);
  assert.throws(() => normalizeClientDraft({ ...base, documentNumber: "123" }), /tipo como el número/);
  assert.throws(() => normalizeClientDraft({ ...base, email: "no-es-correo" }), /correo electrónico válido/);
});
