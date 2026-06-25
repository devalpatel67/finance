import type { AccountKind } from "@/lib/accounts/resolve-account";

type AccountInfo = { name: string; last4: string | null; kind: AccountKind };

export function stitchAccountsIntoRows<T extends { financialAccountId: string }>(
  rows: T[],
  accounts: { id: string; name: string; last4: string | null; kind: AccountKind }[],
): (T & { account: AccountInfo | undefined })[] {
  const acctById = new Map<string, AccountInfo>(
    accounts.map((a) => [a.id, { name: a.name, last4: a.last4, kind: a.kind }]),
  );
  return rows.map((r) => ({ ...r, account: acctById.get(r.financialAccountId) }));
}
