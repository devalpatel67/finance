/**
 * Formats an amount as currency using a PINNED locale. The locale must be fixed
 * (not the runtime default) so server and client render identical text —
 * otherwise SSR and hydration disagree (e.g. CAD as "CA$" on the server vs "$"
 * in an en-CA browser). Renders the absolute value.
 */
export function formatCurrency(amount: string | number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    Math.abs(Number(amount)),
  );
}
