import { describe, expect, it } from "vitest";
import { normalizeDescription } from "@/lib/categories/normalize";

describe("normalizeDescription", () => {
  it("lowercases, trims, and collapses internal whitespace", () => {
    expect(normalizeDescription("  STARBUCKS   57744  ")).toBe("starbucks 57744");
    expect(normalizeDescription("AMZN  MKTP\tCA")).toBe("amzn mktp ca");
  });
});
