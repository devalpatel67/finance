/**
 * Formats an amount as currency using a PINNED locale + the narrow symbol, so
 * CAD renders as "$" (not "CA$") — the user already knows their currency. The
 * locale is fixed (not the runtime default) so server and client render
 * identical text and avoid an SSR hydration mismatch. Renders the absolute value.
 */
export function formatCurrency(amount: string | number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  }).format(Math.abs(Number(amount)));
}
