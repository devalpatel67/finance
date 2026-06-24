export type ExtractedAccount = { institution?: string | null; last4?: string | null };
export type MatchableAccount = { id: string; institution: string | null; last4: string | null; createdAt: Date };
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
  // Strip common bank suffixes (N.A., Inc., etc.)
  const stripped = base.replace(/(na|inc|ltd|llc|corp)$/, "");
  return ALIASES[stripped] ?? ALIASES[base] ?? (stripped || base);
}

export function resolveAccount({
  extracted,
  accounts,
}: {
  extracted: ExtractedAccount;
  accounts: MatchableAccount[];
}): AccountMatch {
  if (!extracted.institution || !extracted.last4) return { kind: "none" };
  const wantInst = normalizeInstitution(extracted.institution);
  const wantLast4 = extracted.last4;

  const matches = accounts.filter(
    (a) => a.institution && a.last4 === wantLast4 && normalizeInstitution(a.institution) === wantInst,
  );
  if (matches.length === 0) return { kind: "none" };
  if (matches.length === 1) return { kind: "matched", account: matches[0] };

  const newest = matches.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  return { kind: "ambiguous", account: newest };
}
