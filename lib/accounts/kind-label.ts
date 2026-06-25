import type { AccountKind } from "@/lib/accounts/resolve-account";

// Display labels for account kinds. The stored enum value stays "checking"
// (used by extraction, matching, reconciliation); we show Canadian-English
// "Chequing" in the UI.
export const KIND_LABELS: Record<AccountKind, string> = {
  checking: "Chequing",
  savings: "Savings",
  credit: "Credit",
  investment: "Investment",
};

export function kindLabel(kind: AccountKind): string {
  return KIND_LABELS[kind] ?? kind;
}
