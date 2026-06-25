import { describe, expect, it } from "vitest";
import { deriveLast4 } from "@/lib/accounts/last4";

describe("deriveLast4", () => {
  it("takes the last 4 digits of a space-grouped account number", () => {
    expect(deriveLast4({ accountNumber: "93922 16843 88" })).toBe("4388");
  });

  it("returns a clean 4-digit value unchanged", () => {
    expect(deriveLast4({ last4: "7012" })).toBe("7012");
  });

  it("rejects a malformed fragment with too few digits (buckets instead)", () => {
    expect(deriveLast4({ last4: "3 88" })).toBeNull();
  });

  it("prefers the full account number over the last4 field", () => {
    expect(deriveLast4({ accountNumber: "5500 1234 9999", last4: "0000" })).toBe("9999");
  });

  it("returns null when neither input has 4 digits", () => {
    expect(deriveLast4({ accountNumber: null, last4: undefined })).toBeNull();
    expect(deriveLast4({ last4: "12" })).toBeNull();
  });
});
