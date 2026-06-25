import { describe, expect, it } from "vitest";
import { weekdayLong } from "@/lib/format/date";

describe("weekdayLong", () => {
  it("returns the full UTC weekday for a date string", () => {
    expect(weekdayLong("2021-01-01")).toBe("Friday");
    expect(weekdayLong("2000-01-01")).toBe("Saturday");
    expect(weekdayLong("2026-06-18")).toBe("Thursday");
  });
  it("returns empty string for malformed input", () => {
    expect(weekdayLong("")).toBe("");
    expect(weekdayLong("nope")).toBe("");
  });
});
