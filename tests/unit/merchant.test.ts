import { describe, expect, it } from "vitest";
import { normalizeMerchant } from "@/lib/transactions/merchant";

describe("normalizeMerchant", () => {
  it("merges corporate-suffix and trailing-payment variants", () => {
    expect(normalizeMerchant("Payment Pad Inc")).toBe("payment pad");
    expect(normalizeMerchant("Payment Pad")).toBe("payment pad");
    expect(normalizeMerchant("Mortgage Payment")).toBe("mortgage");
    expect(normalizeMerchant("Mortgage")).toBe("mortgage");
  });
  it("strips punctuation and collapses whitespace", () => {
    expect(normalizeMerchant("Tim Hortons #123")).toBe("tim hortons 123");
    expect(normalizeMerchant("  RBC   ")).toBe("rbc");
  });
  it("keeps a single leading word like 'Payment'", () => {
    expect(normalizeMerchant("Payment")).toBe("payment");
  });
});
