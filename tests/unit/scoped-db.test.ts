import { describe, expect, it } from "vitest";
import { scopeFilter } from "@/lib/db/scoped";
import { eq } from "drizzle-orm";
import { financialAccounts } from "@/lib/db/schema";

describe("scopeFilter", () => {
  it("returns an eq(user_id, userId) filter", () => {
    const f = scopeFilter(financialAccounts, "user-123");
    expect(f).toEqual(eq(financialAccounts.userId, "user-123"));
  });
});
