import assert from "node:assert/strict";
import test from "node:test";
import { caretOffsetAfterDigits, formatCopIntegerInput, normalizeCopIntegerInput } from "../src/renderer/copIntegerFormatting.ts";

test("agrupa miles con punto sin perder exactitud ni cambiar el valor guardado", () => {
  for (const [raw, formatted] of [
    ["0", "0"], ["999", "999"], ["1000", "1.000"], ["100000", "100.000"],
    ["1000000", "1.000.000"], ["1234567890123456789", "1.234.567.890.123.456.789"]
  ]) {
    assert.equal(formatCopIntegerInput(raw), formatted);
  }
});

test("normaliza texto digitado o pegado y mantiene estable la posición del cursor", () => {
  assert.equal(normalizeCopIntegerInput("1.234.567"), "1234567");
  assert.equal(normalizeCopIntegerInput("00042"), "42");
  assert.equal(normalizeCopIntegerInput("000"), "0");
  assert.equal(normalizeCopIntegerInput(""), "");
  assert.equal(caretOffsetAfterDigits("1.234.567", 4), 5);
  assert.equal(caretOffsetAfterDigits("1.234.567", 0), 0);
});
