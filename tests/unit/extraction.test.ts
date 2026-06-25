import { describe, expect, it } from "vitest";
import { buildSystemPrompt, ExtractionResult, resolveDirection } from "@/lib/llm/extraction";

describe("buildSystemPrompt", () => {
  it("lists the user's categories when provided", () => {
    const p = buildSystemPrompt(["Dining", "My Custom Cat"]);
    expect(p).toContain("Dining");
    expect(p).toContain("My Custom Cat");
    expect(p.toLowerCase()).toContain("choose");
  });

  it("omits the category-list instruction when none are provided", () => {
    const p = buildSystemPrompt([]);
    expect(p).not.toContain("Choose suggested_category from");
  });

  it("instructs the model to capture the full account number (last4 is fallback)", () => {
    const p = buildSystemPrompt([]);
    expect(p).toMatch(/account_number/);
    expect(p).toMatch(/full account or card number/i);
    expect(p).toMatch(/last4/);
  });
});

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
    expect(parsed.transactions[0].direction).toBeUndefined();
  });

  it("rejects an invalid date", () => {
    expect(() =>
      ExtractionResult.parse({
        account_summary: { period_start: "nope", period_end: "2026-04-30", currency: "USD" },
        transactions: [],
      }),
    ).toThrow();
  });

  it("accepts each valid direction value", () => {
    for (const dir of ["outflow", "inflow", "transfer"] as const) {
      const parsed = ExtractionResult.parse({
        account_summary: { period_start: "2026-04-01", period_end: "2026-04-30", currency: "USD" },
        transactions: [
          {
            posted_at: "2026-04-03",
            description: "Test",
            amount: -1.0,
            suggested_category: "Other",
            direction: dir,
          },
        ],
      });
      expect(parsed.transactions[0].direction).toBe(dir);
    }
  });

  it("rejects an invalid direction value", () => {
    expect(() =>
      ExtractionResult.parse({
        account_summary: { period_start: "2026-04-01", period_end: "2026-04-30", currency: "USD" },
        transactions: [
          {
            posted_at: "2026-04-03",
            description: "Test",
            amount: -1.0,
            suggested_category: "Other",
            direction: "refund",
          },
        ],
      }),
    ).toThrow();
  });

  it("captures an optional merchant and tolerates its absence", () => {
    const parsed = ExtractionResult.parse({
      account_summary: { period_start: "2026-04-01", period_end: "2026-04-30", currency: "CAD" },
      transactions: [
        { posted_at: "2026-04-03", description: "AMZN MKTP CA*ZX1 WWW.AMAZON.CA", amount: -42.17, suggested_category: "Shopping", merchant: "Amazon" },
        { posted_at: "2026-04-04", description: "UNKNOWN THING", amount: -1.0, suggested_category: "Other" },
      ],
    });
    expect(parsed.transactions[0].merchant).toBe("Amazon");
    expect(parsed.transactions[1].merchant).toBeUndefined();
  });

  it("captures optional opening and closing balances", () => {
    const parsed = ExtractionResult.parse({
      account_summary: {
        period_start: "2026-04-01",
        period_end: "2026-04-30",
        currency: "CAD",
        opening_balance: 812.3,
        closing_balance: 1204.55,
      },
      transactions: [],
    });
    expect(parsed.account_summary.opening_balance).toBe(812.3);
    expect(parsed.account_summary.closing_balance).toBe(1204.55);
  });
});

describe("ExtractionResult account_type", () => {
  it("accepts a valid account_type", () => {
    const parsed = ExtractionResult.parse({
      account_summary: {
        period_start: "2026-04-01", period_end: "2026-04-30",
        currency: "USD", account_type: "credit",
      },
      transactions: [],
    });
    expect(parsed.account_summary.account_type).toBe("credit");
  });

  it("allows account_type to be absent", () => {
    const parsed = ExtractionResult.parse({
      account_summary: { period_start: "2026-04-01", period_end: "2026-04-30", currency: "USD" },
      transactions: [],
    });
    expect(parsed.account_summary.account_type).toBeUndefined();
  });

  it("rejects an invalid account_type", () => {
    expect(() =>
      ExtractionResult.parse({
        account_summary: {
          period_start: "2026-04-01", period_end: "2026-04-30",
          currency: "USD", account_type: "loan",
        },
        transactions: [],
      }),
    ).toThrow();
  });
});

describe("resolveDirection", () => {
  it("returns the provided direction when present (outflow)", () => {
    expect(resolveDirection({ amount: -10, direction: "outflow" })).toBe("outflow");
  });

  it("returns the provided direction when present (inflow)", () => {
    expect(resolveDirection({ amount: 10, direction: "inflow" })).toBe("inflow");
  });

  it("returns the provided direction when present (transfer)", () => {
    expect(resolveDirection({ amount: -500, direction: "transfer" })).toBe("transfer");
  });

  it("falls back to outflow for missing direction with negative amount", () => {
    expect(resolveDirection({ amount: -42.17 })).toBe("outflow");
  });

  it("falls back to inflow for missing direction with positive amount", () => {
    expect(resolveDirection({ amount: 3200 })).toBe("inflow");
  });

  it("falls back to inflow for missing direction with zero amount", () => {
    expect(resolveDirection({ amount: 0 })).toBe("inflow");
  });
});