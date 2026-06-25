import { describe, expect, it } from "vitest";
import { monthShort } from "@/lib/format/date";

describe("monthShort", () => {
  it("maps YYYY-MM to a short month", () => {
    expect(monthShort("2026-06")).toBe("Jun");
    expect(monthShort("2026-01")).toBe("Jan");
  });
  it("returns empty for malformed", () => {
    expect(monthShort("2026")).toBe("");
  });
});
