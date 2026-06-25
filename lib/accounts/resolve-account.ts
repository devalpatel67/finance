export type AccountKind = "checking" | "savings" | "credit" | "investment";

export type ExtractedAccount = {
  institution?: string | null;
  last4?: string | null;
  kind?: AccountKind | null;
};

export type MatchableAccount = {
  id: string;
  institution: string | null;
  last4: string | null;
  kind: AccountKind;
  createdAt: Date;
};

export type AccountMatch =
  | { kind: "matched"; account: MatchableAccount }
  | { kind: "ambiguous"; account: MatchableAccount }
  | { kind: "none" };

// Common institution aliases collapse to a canonical token so "AMEX" matches
// "American Express". Keys and values are already normalized (lowercase, alnum).
const ALIASES: Record<string, string> = {
  amex: "americanexpress",
};

export function normalizeInstitution(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ALIASES[base] ?? base;
}

function institutionCompatible(stored: string | null, want: string): boolean {
  if (!stored || !want) return false;
  const n = normalizeInstitution(stored);
  if (!n) return false;
  return n === want || n.includes(want) || want.includes(n);
}

/**
 * Matches an extracted statement to one of the user's accounts. last4 is the
 * stable identity key: a statement belongs to the account with the same last4
 * and kind, regardless of how the institution name is spelled ("RBC" vs "Royal
 * Bank of Canada"). Institution only disambiguates when several accounts share
 * the same last4 + kind. Returns "none" when last4 is absent — the caller then
 * falls back to institution+kind bucketing.
 */
export function resolveAccount({
  extracted,
  accounts,
}: {
  extracted: ExtractedAccount;
  accounts: MatchableAccount[];
}): AccountMatch {
  if (!extracted.last4) return { kind: "none" };

  const candidates = accounts.filter(
    (a) => a.last4 === extracted.last4 && (!extracted.kind || a.kind === extracted.kind),
  );
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "matched", account: candidates[0] };

  // Multiple accounts share last4 + kind — use the institution to break the tie.
  if (extracted.institution) {
    const want = normalizeInstitution(extracted.institution);
    const byInstitution = candidates.filter((a) => institutionCompatible(a.institution, want));
    if (byInstitution.length === 1) return { kind: "matched", account: byInstitution[0] };
  }
  const newest = candidates.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  return { kind: "ambiguous", account: newest };
}

/**
 * Finds an existing "bucket" account (last4 unknown) for the given institution
 * and kind. When a statement's account number can't be extracted, all such
 * statements from the same institution + kind collapse onto one bucket account
 * instead of creating one account per file.
 */
export function findBucketAccount(
  accounts: MatchableAccount[],
  { institution, kind }: { institution: string | null | undefined; kind: AccountKind },
): MatchableAccount | null {
  const want = institution ? normalizeInstitution(institution) : "";
  return (
    accounts.find(
      (a) => a.last4 == null && a.kind === kind && normalizeInstitution(a.institution ?? "") === want,
    ) ?? null
  );
}
