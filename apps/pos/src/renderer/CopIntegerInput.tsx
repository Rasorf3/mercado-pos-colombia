import { forwardRef, useLayoutEffect, useRef, useState, useImperativeHandle, type ChangeEvent, type InputHTMLAttributes, type ReactElement } from "react";
import { caretOffsetAfterDigits, formatCopIntegerInput, normalizeCopIntegerInput } from "./copIntegerFormatting";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "pattern" | "maxLength"> & {
  value: string;
  onValueChange: (value: string) => void;
  maxDigits?: number;
};

/** A COP integer editor: groups thousands visually, but emits unformatted digits. */
export const CopIntegerInput = forwardRef<HTMLInputElement, Props>(function CopIntegerInput(
  { value, onValueChange, maxDigits = 19, ...inputProps },
  forwardedRef
): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaretDigit = useRef<number | null>(null);
  const [editRevision, setEditRevision] = useState(0);
  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const digitCount = pendingCaretDigit.current;
    if (!input || digitCount === null) return;
    const offset = caretOffsetAfterDigits(input.value, digitCount);
    input.setSelectionRange(offset, offset);
    pendingCaretDigit.current = null;
  }, [value, editRevision]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const typedValue = event.currentTarget.value;
    const caret = event.currentTarget.selectionStart ?? typedValue.length;
    const digitsBeforeCaret = (typedValue.slice(0, caret).match(/\d/g) ?? []).length;
    const digits = typedValue.replace(/\D/g, "").slice(0, maxDigits);
    const normalized = normalizeCopIntegerInput(digits);
    const removedLeadingZeroes = digits.length - normalized.length;
    pendingCaretDigit.current = Math.min(normalized.length, Math.max(0, Math.min(digitsBeforeCaret, maxDigits) - removedLeadingZeroes));
    setEditRevision((revision) => revision + 1);
    onValueChange(normalized);
  };

  return <input
    {...inputProps}
    ref={inputRef}
    type="text"
    inputMode="numeric"
    maxLength={maxDigits + Math.floor((maxDigits - 1) / 3)}
    value={formatCopIntegerInput(value)}
    onChange={handleChange}
  />;
});
