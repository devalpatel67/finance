function digitsTail(s: string | null | undefined): string | null {
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * Derives a clean 4-digit identifier from what extraction returned. The model
 * is unreliable at slicing the "last 4" out of a space-grouped account number
 * (e.g. "93922 16843 88"), so we prefer the full `accountNumber`, strip
 * non-digits, and take the last 4 ourselves — deterministic regardless of
 * spacing. Falls back to the `last4` field (also digit-stripped). Returns null
 * when neither yields ≥4 digits, so the caller buckets instead of creating a
 * malformed account (e.g. from "3 88").
 */
export function deriveLast4(input: {
  accountNumber?: string | null;
  last4?: string | null;
}): string | null {
  return digitsTail(input.accountNumber) ?? digitsTail(input.last4);
}
