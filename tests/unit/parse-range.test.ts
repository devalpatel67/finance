import { describe, expect, it } from "vitest";

import { parseRange, formatRangeLabel } from "@/lib/dates/ranges";

const TODAY = new Date("2026-05-29T00:00:00Z");

describe("parseRange", () => {
  it("defaults to 6m when range is omitted", () => {
    const r = parseRange({}, TODAY);
    expect(r.preset).toBe("6m");
    expect(r.fromIso).toBe("2025-11-29");
    expect(r.toIso).toBeNull();
  });

  it("falls back to 6m on unknown range value", () => {
    const r = parseRange({ range: "bogus" }, TODAY);
    expect(r.preset).toBe("6m");
    expect(r.fromIso).toBe("2025-11-29");
    expect(r.toIso).toBeNull();
  });

  it("30d → today minus 30 days", () => {
    const r = parseRange({ range: "30d" }, TODAY);
    expect(r.fromIso).toBe("2026-04-29");
    expect(r.toIso).toBeNull();
  });

  it("90d → today minus 90 days", () => {
    const r = parseRange({ range: "90d" }, TODAY);
    expect(r.fromIso).toBe("2026-02-28");
    expect(r.toIso).toBeNull();
  });

  it("6m → today minus 6 months", () => {
    const r = parseRange({ range: "6m" }, TODAY);
    expect(r.fromIso).toBe("2025-11-29");
    expect(r.toIso).toBeNull();
  });

  it("1y → today minus 1 year", () => {
    const r = parseRange({ range: "1y" }, TODAY);
    expect(r.fromIso).toBe("2025-05-29");
    expect(r.toIso).toBeNull();
  });

  it("2y → today minus 2 years", () => {
    const r = parseRange({ range: "2y" }, TODAY);
    expect(r.fromIso).toBe("2024-05-29");
    expect(r.toIso).toBeNull();
  });

  it("5y → today minus 5 years", () => {
    const r = parseRange({ range: "5y" }, TODAY);
    expect(r.fromIso).toBe("2021-05-29");
    expect(r.toIso).toBeNull();
  });

  it("all → both nulls", () => {
    const r = parseRange({ range: "all" }, TODAY);
    expect(r.preset).toBe("all");
    expect(r.fromIso).toBeNull();
    expect(r.toIso).toBeNull();
  });

  it("custom with valid from/to → uses them", () => {
    const r = parseRange(
      { range: "custom", from: "2026-01-01", to: "2026-03-31" },
      TODAY,
    );
    expect(r.preset).toBe("custom");
    expect(r.fromIso).toBe("2026-01-01");
    expect(r.toIso).toBe("2026-03-31");
  });

  it("custom with invalid from → fromIso null", () => {
    const r = parseRange(
      { range: "custom", from: "not-a-date", to: "2026-03-31" },
      TODAY,
    );
    expect(r.preset).toBe("custom");
    expect(r.fromIso).toBeNull();
    expect(r.toIso).toBe("2026-03-31");
  });

  it("custom with missing from/to → both null", () => {
    const r = parseRange({ range: "custom" }, TODAY);
    expect(r.preset).toBe("custom");
    expect(r.fromIso).toBeNull();
    expect(r.toIso).toBeNull();
  });

  it("custom with invalid to → toIso null", () => {
    const r = parseRange(
      { range: "custom", from: "2026-01-01", to: "garbage" },
      TODAY,
    );
    expect(r.fromIso).toBe("2026-01-01");
    expect(r.toIso).toBeNull();
  });
});

describe("formatRangeLabel", () => {
  it("30d label", () => {
    expect(formatRangeLabel(parseRange({ range: "30d" }, TODAY))).toBe(
      "Last 30 days",
    );
  });

  it("90d label", () => {
    expect(formatRangeLabel(parseRange({ range: "90d" }, TODAY))).toBe(
      "Last 90 days",
    );
  });

  it("6m label", () => {
    expect(formatRangeLabel(parseRange({ range: "6m" }, TODAY))).toBe(
      "Last 6 months",
    );
  });

  it("1y label", () => {
    expect(formatRangeLabel(parseRange({ range: "1y" }, TODAY))).toBe(
      "Last 1 year",
    );
  });

  it("2y label", () => {
    expect(formatRangeLabel(parseRange({ range: "2y" }, TODAY))).toBe(
      "Last 2 years",
    );
  });

  it("5y label", () => {
    expect(formatRangeLabel(parseRange({ range: "5y" }, TODAY))).toBe(
      "Last 5 years",
    );
  });

  it("all → 'All time'", () => {
    expect(formatRangeLabel(parseRange({ range: "all" }, TODAY))).toBe(
      "All time",
    );
  });

  it("custom with both dates → 'Jan 1 – Mar 31, 2026'", () => {
    expect(
      formatRangeLabel(
        parseRange(
          { range: "custom", from: "2026-01-01", to: "2026-03-31" },
          TODAY,
        ),
      ),
    ).toBe("Jan 1 – Mar 31, 2026");
  });

  it("custom across years → includes both years", () => {
    expect(
      formatRangeLabel(
        parseRange(
          { range: "custom", from: "2025-11-15", to: "2026-03-31" },
          TODAY,
        ),
      ),
    ).toBe("Nov 15, 2025 – Mar 31, 2026");
  });

  it("custom with only from", () => {
    expect(
      formatRangeLabel(
        parseRange({ range: "custom", from: "2026-01-01" }, TODAY),
      ),
    ).toBe("Since Jan 1, 2026");
  });

  it("custom with only to", () => {
    expect(
      formatRangeLabel(
        parseRange({ range: "custom", to: "2026-03-31" }, TODAY),
      ),
    ).toBe("Through Mar 31, 2026");
  });

  it("custom with neither → 'Custom range'", () => {
    expect(formatRangeLabel(parseRange({ range: "custom" }, TODAY))).toBe(
      "Custom range",
    );
  });
});
