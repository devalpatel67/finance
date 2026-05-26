import { describe, expect, it } from "vitest";
import { ExtractionResult } from "@/lib/llm/extraction";

describe("ExtractionResult schema", () => {
  it("parses a valid payload", () => {
    const parsed = ExtractionResult.parse({
      account_summary: {
        institution: "Chase",
        last4: "1234",
        period_start: "2026-04-01",
        period_end: "2026-04-30",
        currency: "USD",
      },
      transactions: [
        {
          posted_at: "2026-04-03",
          description: "Whole Foods",
          amount: -42.17,
          suggested_category: "Groceries",
        },
      ],
    });
    expect(parsed.transactions[0].amount).toBe(-42.17);
  });

  it("rejects an invalid date", () => {
    expect(() =>
      ExtractionResult.parse({
        account_summary: { period_start: "nope", period_end: "2026-04-30", currency: "USD" },
        transactions: [],
      }),
    ).toThrow();
  });
});
