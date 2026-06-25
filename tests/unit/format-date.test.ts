import { describe, expect, it } from "vitest";
import { weekdayShort } from "@/lib/format/date";

describe("weekdayShort", () => {
  it("returns the UTC weekday for a date string", () => {
    expect(weekdayShort("2021-01-01")).toBe("Fri");
    expect(weekdayShort("2000-01-01")).toBe("Sat");
    expect(weekdayShort("2026-06-18")).toBe("Thu");
  });
  it("returns empty string for malformed input", () => {
    expect(weekdayShort("")).toBe("");
    expect(weekdayShort("nope")).toBe("");
  });
});
