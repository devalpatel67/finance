// Corporate suffixes and trailing "payment" words the LLM sometimes appends,
// so "Payment Pad Inc" and "Payment Pad", or "Mortgage" and "Mortgage Payment",
// collapse to one key for grouping. Display names are chosen separately.
const SUFFIXES = new Set(["inc", "ltd", "llc", "corp", "co", "ltee", "ltée", "plc", "limited", "incorporated"]);
const TRAILING = new Set(["payment", "payments", "pmt", "pmts"]);

/**
 * Canonical key for a merchant name — for grouping near-duplicates only (not
 * for display). Lowercases, strips punctuation, drops corporate suffixes and
 * trailing "payment" words, collapses whitespace.
 */
export function normalizeMerchant(name: string): string {
  let words = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !SUFFIXES.has(w));
  while (words.length > 1 && TRAILING.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}
