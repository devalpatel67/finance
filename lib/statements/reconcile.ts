export type AccountKind = "checking" | "savings" | "credit" | "investment";

export type ReconciliationStatus =
  | "reconciled"
  | "discrepancy"
  | "not_available"
  | "not_applicable";

export type ReconcileInput = {
  kind: AccountKind;
  opening: number | null;
  closing: number | null;
  amounts: number[];
};

export type ReconcileResult = {
  status: ReconciliationStatus;
  delta: number | null;
};

const cents = (n: number): number => Math.round(n * 100);

/**
 * Verifies extracted transactions tie out to the statement's stated balances.
 * Asset accounts: closing = opening + Σ(amounts). Credit (liability): closing =
 * opening − Σ(amounts). Computed in integer cents; exact-to-the-cent tie-out.
 */
export function reconcile(input: ReconcileInput): ReconcileResult {
  if (input.kind === "investment") return { status: "not_applicable", delta: null };
  if (input.opening == null || input.closing == null) {
    return { status: "not_available", delta: null };
  }

  const sumCents = input.amounts.reduce((acc, a) => acc + cents(a), 0);
  const expectedCents =
    input.kind === "credit"
      ? cents(input.opening) - sumCents
      : cents(input.opening) + sumCents;
  const deltaCents = cents(input.closing) - expectedCents;

  return {
    status: deltaCents === 0 ? "reconciled" : "discrepancy",
    delta: deltaCents / 100,
  };
}
