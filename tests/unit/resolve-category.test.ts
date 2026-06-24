import { describe, expect, it } from "vitest";
import { resolveCategory } from "@/lib/categories/resolve";

const cats = [
  { id: "dining", name: "Dining" },
  { id: "shopping", name: "Shopping" },
  { id: "uncat", name: "Uncategorized" },
];

describe("resolveCategory", () => {
  it("a matching rule beats the LLM suggestion", () => {
    const r = resolveCategory({
      description: "STARBUCKS 57744 NIAGARA FALLS ON",
      suggestedLabel: "Shopping",
      rules: [{ keyword: "starbucks", categoryId: "dining" }],
      categories: cats,
    });
    expect(r).toEqual({ categoryId: "dining", source: "rule" });
  });

  it("longest keyword wins among multiple matching rules", () => {
    const r = resolveCategory({
      description: "AMZN MKTP CA*ZX1 WWW.AMAZON.CA",
      suggestedLabel: "Other",
      rules: [
        { keyword: "amzn", categoryId: "shopping" },
        { keyword: "amzn mktp", categoryId: "dining" },
      ],
      categories: cats,
    });
    expect(r.categoryId).toBe("dining");
    expect(r.source).toBe("rule");
  });

  it("breaks keyword-length ties by newest (rules passed newest-first)", () => {
    const r = resolveCategory({
      description: "abcd wxyz store",
      suggestedLabel: "Other",
      rules: [
        { keyword: "abcd", categoryId: "dining" }, // newer
        { keyword: "wxyz", categoryId: "shopping" }, // older
      ],
      categories: cats,
    });
    expect(r.categoryId).toBe("dining");
  });

  it("falls back to an exact LLM-label category match", () => {
    const r = resolveCategory({
      description: "Some Shop",
      suggestedLabel: "dining",
      rules: [],
      categories: cats,
    });
    expect(r).toEqual({ categoryId: "dining", source: "suggested" });
  });

  it("falls back to Uncategorized when nothing matches", () => {
    const r = resolveCategory({
      description: "Mystery",
      suggestedLabel: "Nonexistent",
      rules: [],
      categories: cats,
    });
    expect(r).toEqual({ categoryId: "uncat", source: "suggested" });
  });
});
