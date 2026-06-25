import { describe, expect, it } from "vitest";
import { kindLabel } from "@/lib/accounts/kind-label";

describe("kindLabel", () => {
  it("shows Canadian-English Chequing for the checking enum value", () => {
    expect(kindLabel("checking")).toBe("Chequing");
  });
  it("labels the other kinds", () => {
    expect(kindLabel("savings")).toBe("Savings");
    expect(kindLabel("credit")).toBe("Credit");
    expect(kindLabel("investment")).toBe("Investment");
  });
});
