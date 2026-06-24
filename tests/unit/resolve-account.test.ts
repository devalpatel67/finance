import { describe, expect, it } from "vitest";
import { normalizeInstitution, resolveAccount, type MatchableAccount } from "@/lib/accounts/resolve-account";

const d = (s: string) => new Date(s);
const acc = (over: Partial<MatchableAccount>): MatchableAccount => ({
  id: "a", institution: "Chase", last4: "1234", createdAt: d("2026-01-01"), ...over,
});

describe("normalizeInstitution", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(normalizeInstitution("American Express")).toBe("americanexpress");
    expect(normalizeInstitution("AMEX")).toBe("americanexpress");
    expect(normalizeInstitution("Capital One!!")).toBe("capitalone");
  });
});

describe("resolveAccount", () => {
  it("matches on normalized institution + exact last4", () => {
    const r = resolveAccount({
      extracted: { institution: "AMEX", last4: "9001" },
      accounts: [acc({ id: "x", institution: "American Express", last4: "9001" })],
    });
    expect(r).toEqual({ kind: "matched", account: expect.objectContaining({ id: "x" }) });
  });

  it("returns none when last4 differs", () => {
    const r = resolveAccount({
      extracted: { institution: "Chase", last4: "0000" },
      accounts: [acc({ id: "x", last4: "1234" })],
    });
    expect(r.kind).toBe("none");
  });

  it("returns none when extraction has no last4", () => {
    const r = resolveAccount({
      extracted: { institution: "Chase", last4: undefined },
      accounts: [acc({ id: "x" })],
    });
    expect(r.kind).toBe("none");
  });

  it("picks the most-recently-created on ambiguous match", () => {
    const r = resolveAccount({
      extracted: { institution: "Chase", last4: "1234" },
      accounts: [
        acc({ id: "old", createdAt: d("2026-01-01") }),
        acc({ id: "new", createdAt: d("2026-05-01") }),
      ],
    });
    expect(r).toEqual({ kind: "ambiguous", account: expect.objectContaining({ id: "new" }) });
  });
});
