import { describe, expect, it } from "vitest";
import { formatCurrency } from "@/lib/format/currency";

describe("formatCurrency", () => {
  it("is locale-stable (pinned), not dependent on the runtime default locale", () => {
    // Pinned en-US + narrowSymbol: server and client agree, and CAD shows a
    // plain "$" rather than "CA$".
    expect(formatCurrency("326.80", "CAD")).toBe("$326.80");
    expect(formatCurrency("326.80", "USD")).toBe("$326.80");
  });

  it("formats the absolute value", () => {
    expect(formatCurrency("-42.17", "USD")).toBe("$42.17");
    expect(formatCurrency(42.17, "USD")).toBe("$42.17");
  });
});
