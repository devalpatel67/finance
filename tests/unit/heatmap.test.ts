import { describe, expect, it } from "vitest";
import { buildYearHeatmap } from "@/lib/dashboard/heatmap";

describe("buildYearHeatmap", () => {
  it("levels the busiest day at 4 and unknown days at 0", () => {
    const g = buildYearHeatmap(
      [{ date: "2026-06-25", total: 100 }, { date: "2026-06-10", total: 10 }],
      "2026-06-25",
    );
    const cells = g.weeks.flat().filter((c) => c.date);
    expect(g.max).toBe(100);
    expect(cells.find((c) => c.date === "2026-06-25")!.level).toBe(4);
    expect(cells.find((c) => c.date === "2026-06-10")!.level).toBe(1);
    // a day with no spend in range is level 0
    expect(cells.find((c) => c.date === "2026-06-24")!.level).toBe(0);
  });

  it("covers ~a year of weeks and ends on the end date", () => {
    const g = buildYearHeatmap([], "2026-06-25");
    expect(g.weeks.length).toBeGreaterThanOrEqual(52);
    const lastReal = g.weeks.at(-1)!.filter((c) => c.date).at(-1);
    expect(lastReal!.date).toBe("2026-06-25");
    expect(g.weeks.every((w) => w.length === 7)).toBe(true);
  });
});
