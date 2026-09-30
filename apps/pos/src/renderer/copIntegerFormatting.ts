/** Converts a raw COP integer string to the es-CO thousands-grouped display form. */
export function formatCopIntegerInput(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Keeps only digits and avoids redundant leading zeroes while the user types. */
export function normalizeCopIntegerInput(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/^0+(?=\d)/, "");
}

/** Returns the string offset immediately after the requested digit in a formatted value. */
export function caretOffsetAfterDigits(value: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (/\d/.test(value[index] ?? "")) seen += 1;
    if (seen >= digitCount) return index + 1;
  }
  return value.length;
}
