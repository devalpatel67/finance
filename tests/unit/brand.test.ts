import { describe, expect, it } from "vitest";
import { bankBrand } from "@/lib/accounts/brand";

describe("bankBrand", () => {
  it("maps known institutions regardless of wording", () => {
    expect(bankBrand("Royal Bank of Canada").label).toBe("RBC");
    expect(bankBrand("RBC").label).toBe("RBC");
    expect(bankBrand("TD Canada Trust").label).toBe("TD");
    expect(bankBrand("American Express").label).toBe("American Express");
    expect(bankBrand("AMEX").label).toBe("American Express");
  });

  it("returns a colored gradient for known banks", () => {
    const rbc = bankBrand("RBC");
    expect(rbc.from).toBe("#0a2a6b");
    expect(rbc.to).toBe("#003da5");
  });

  it("falls back to the institution name + ink gradient for unknown banks", () => {
    const b = bankBrand("Bank of Nowhere");
    expect(b.label).toBe("Bank of Nowhere");
    expect(b.from).toBe("#15160f");
  });

  it("uses 'Account' when institution is null", () => {
    expect(bankBrand(null).label).toBe("Account");
  });
});
