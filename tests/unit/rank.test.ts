import { describe, expect, it } from "vitest";
import { rankCategories } from "@/lib/dashboard/rank";

const cats = [{ id: "a", name: "Bills", color: "#a84f3f" }, { id: "b", name: "Dining", color: "#c0683c" }];

describe("rankCategories", () => {
  it("sorts by amount desc and computes delta vs prior", () => {
    const out = rankCategories({
      current: [{ categoryId: "a", total: "-120" }, { categoryId: "b", total: "-50" }],
      prior: [{ categoryId: "a", total: "-100" }, { categoryId: "b", total: "-100" }],
      categories: cats,
    });
    expect(out.map((r) => r.name)).toEqual(["Bills", "Dining"]);
    expect(out[0]).toMatchObject({ amount: 120, deltaPct: 20 });
    expect(out[1]).toMatchObject({ amount: 50, deltaPct: -50 });
  });

  it("delta is null with no prior period or no prior spend", () => {
    const out = rankCategories({
      current: [{ categoryId: "a", total: "-120" }],
      prior: null,
      categories: cats,
    });
    expect(out[0].deltaPct).toBeNull();
  });
});
