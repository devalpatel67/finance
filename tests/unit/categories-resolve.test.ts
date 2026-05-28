import { describe, expect, it } from "vitest";
import { pickCategoryId } from "@/lib/categories/resolve";

const cats = [
  { id: "a", name: "Groceries" },
  { id: "b", name: "Dining" },
  { id: "u", name: "Uncategorized" },
];

describe("pickCategoryId", () => {
  it("matches case-insensitively", () => {
    expect(pickCategoryId(cats, "groceries")).toBe("a");
  });

  it("falls back to Uncategorized when no match", () => {
    expect(pickCategoryId(cats, "Crypto")).toBe("u");
  });

  it("returns null if Uncategorized is also missing", () => {
    expect(pickCategoryId(cats.slice(0, 2), "Crypto")).toBeNull();
  });
});
