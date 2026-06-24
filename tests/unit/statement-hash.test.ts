import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/statements/hash";

describe("sha256Hex", () => {
  it("is stable for identical bytes and differs for different bytes", () => {
    const a = sha256Hex(Buffer.from("%PDF-1.4 hello"));
    const b = sha256Hex(Buffer.from("%PDF-1.4 hello"));
    const c = sha256Hex(Buffer.from("%PDF-1.4 world"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
