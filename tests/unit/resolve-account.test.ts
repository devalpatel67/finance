import { describe, expect, it } from "vitest";
import {
  normalizeInstitution,
  resolveAccount,
  findBucketAccount,
  type MatchableAccount,
} from "@/lib/accounts/resolve-account";

const d = (s: string) => new Date(s);
const acc = (over: Partial<MatchableAccount>): MatchableAccount => ({
  id: "a",
  institution: "Chase",
  last4: "1234",
  kind: "checking",
  createdAt: d("2026-01-01"),
  ...over,
});

describe("normalizeInstitution", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(normalizeInstitution("American Express")).toBe("americanexpress");
    expect(normalizeInstitution("AMEX")).toBe("americanexpress");
    expect(normalizeInstitution("Capital One!!")).toBe("capitalone");
  });
});

describe("resolveAccount", () => {
  it("matches on last4 + kind regardless of institution wording", () => {
    const r = resolveAccount({
      extracted: { institution: "Royal Bank of Canada", last4: "7610", kind: "checking" },
      accounts: [acc({ id: "x", institution: "RBC", last4: "7610", kind: "checking" })],
    });
    expect(r).toEqual({ kind: "matched", account: expect.objectContaining({ id: "x" }) });
  });

  it("matches on last4 alone when extraction kind is unknown", () => {
    const r = resolveAccount({
      extracted: { institution: "RBC", last4: "7610" },
      accounts: [acc({ id: "x", last4: "7610", kind: "checking" })],
    });
    expect(r).toEqual({ kind: "matched", account: expect.objectContaining({ id: "x" }) });
  });

  it("does not match a different kind when kind is known", () => {
    const r = resolveAccount({
      extracted: { institution: "RBC", last4: "8387", kind: "credit" },
      accounts: [acc({ id: "x", last4: "8387", kind: "checking" })],
    });
    expect(r.kind).toBe("none");
  });

  it("returns none when last4 differs", () => {
    const r = resolveAccount({
      extracted: { institution: "Chase", last4: "0000", kind: "checking" },
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

  it("disambiguates same-last4+kind candidates by institution", () => {
    const r = resolveAccount({
      extracted: { institution: "TD Bank", last4: "5000", kind: "checking" },
      accounts: [
        acc({ id: "rbc", institution: "RBC", last4: "5000", kind: "checking" }),
        acc({ id: "td", institution: "TD Bank", last4: "5000", kind: "checking" }),
      ],
    });
    expect(r).toEqual({ kind: "matched", account: expect.objectContaining({ id: "td" }) });
  });

  it("is ambiguous (most-recent) when institution can't break a multi-way tie", () => {
    const r = resolveAccount({
      extracted: { institution: "Chase", last4: "1234", kind: "checking" },
      accounts: [
        acc({ id: "old", createdAt: d("2026-01-01") }),
        acc({ id: "new", createdAt: d("2026-05-01") }),
      ],
    });
    expect(r).toEqual({ kind: "ambiguous", account: expect.objectContaining({ id: "new" }) });
  });
});

describe("findBucketAccount", () => {
  it("finds a last4-null account of the same normalized institution + kind", () => {
    const found = findBucketAccount(
      [
        acc({ id: "withLast4", institution: "Royal Bank of Canada", last4: "7610", kind: "checking" }),
        acc({ id: "bucket", institution: "Royal Bank of Canada", last4: null, kind: "checking" }),
      ],
      { institution: "Royal Bank of Canada", kind: "checking" },
    );
    expect(found?.id).toBe("bucket");
  });

  it("does not reuse a bucket of a different kind", () => {
    const found = findBucketAccount(
      [acc({ id: "bucket", institution: "Royal Bank of Canada", last4: null, kind: "checking" })],
      { institution: "Royal Bank of Canada", kind: "credit" },
    );
    expect(found).toBeNull();
  });

  it("returns null when no bucket exists", () => {
    const found = findBucketAccount(
      [acc({ id: "withLast4", last4: "7610", kind: "checking" })],
      { institution: "Royal Bank of Canada", kind: "checking" },
    );
    expect(found).toBeNull();
  });
});
