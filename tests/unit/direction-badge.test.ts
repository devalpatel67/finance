import { describe, expect, it } from "vitest";

import { directionLabel } from "@/components/direction-badge";

describe("directionLabel", () => {
  it("maps each direction to its display label", () => {
    expect(directionLabel("outflow")).toBe("Outflow");
    expect(directionLabel("inflow")).toBe("Inflow");
    expect(directionLabel("transfer")).toBe("Transfer");
  });
});
