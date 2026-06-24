import { describe, expect, it } from "vitest";
import { escapeLike, parseUuid } from "@/lib/transactions/filters";

describe("parseUuid", () => {
  it("returns the value for a valid UUID", () => {
    const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(parseUuid(id)).toBe(id);
  });

  it("returns undefined for malformed input", () => {
    expect(parseUuid("not-a-uuid")).toBeUndefined();
    expect(parseUuid("")).toBeUndefined();
    expect(parseUuid(undefined)).toBeUndefined();
    expect(parseUuid("1; drop table transactions")).toBeUndefined();
  });
});

describe("escapeLike", () => {
  it("escapes LIKE wildcards so they match literally", () => {
    expect(escapeLike("50%")).toBe("50\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("back\\slash")).toBe("back\\\\slash");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeLike("Whole Foods")).toBe("Whole Foods");
  });
});
