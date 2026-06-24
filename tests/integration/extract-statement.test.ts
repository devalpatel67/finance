import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootstrap, type TestEnv } from "../setup";

let envt: TestEnv;

beforeAll(async () => {
  envt = await bootstrap();
  process.env.DATABASE_URL = envt.databaseUrl;
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.BETTER_AUTH_SECRET = "x".repeat(48);
  process.env.GOOGLE_CLIENT_ID = "test";
  process.env.GOOGLE_CLIENT_SECRET = "test";
  process.env.OPENROUTER_API_KEY = "test";
  process.env.MINIO_ENDPOINT = envt.s3.endpoint;
  process.env.MINIO_ACCESS_KEY = envt.s3.accessKey;
  process.env.MINIO_SECRET_KEY = envt.s3.secretKey;
  process.env.MINIO_BUCKET = envt.s3.bucket;
  process.env.MINIO_REGION = "us-east-1";
}, 180_000);

afterAll(async () => {
  try {
    const { db } = await import("@/lib/db/client");
    // drizzle's node-postgres driver wraps a pg Pool — close it before stopping the container
    // so we don't get an unhandled "terminating connection due to administrator command".
    const pool = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
    if (pool?.end) await pool.end();
  } catch {
    // ignore — db may not have been loaded
  }
  if (envt) await envt.stop();
}, 30_000);

vi.mock("@/lib/llm/extraction", async (orig) => {
  const real = await orig<typeof import("@/lib/llm/extraction")>();
  return {
    ...real,
    extractFromPdf: vi.fn(async () => ({
      account_summary: { period_start: "2026-04-01", period_end: "2026-04-30", currency: "USD" },
      transactions: [
        { posted_at: "2026-04-03", description: "Whole Foods", amount: -42.17, suggested_category: "Groceries", direction: "outflow" },
        { posted_at: "2026-04-10", description: "Payroll",     amount:  3200.00, suggested_category: "Income",   direction: "inflow" },
        { posted_at: "2026-04-15", description: "Unknown Fee", amount:   -9.99, suggested_category: "Fees" },
      ],
    })),
  };
});

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: "u1", name: "Test", email: "t@x" } })) } },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));

describe("extractStatement", () => {
  it("uploads a PDF, extracts, and writes transactions", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, categories } = await import("@/lib/db/schema");
    await db.insert(users).values({ id: "u1", name: "T", email: "t@x" });
    const [acc] = await db.insert(financialAccounts).values({
      userId: "u1", name: "Test Checking", kind: "checking", currency: "USD",
    }).returning();
    await db.insert(categories).values([
      { userId: "u1", name: "Groceries", isSystem: true },
      { userId: "u1", name: "Income", isSystem: true },
      { userId: "u1", name: "Uncategorized", isSystem: true },
    ]);

    const { extractStatement } = await import("@/lib/actions/extract-statement");

    const fd = new FormData();
    fd.append("financialAccountId", acc.id);
    fd.append("file", new File([Buffer.from("%PDF-1.4 fake")], "april.pdf", { type: "application/pdf" }));

    const res = await extractStatement(fd);
    expect(res.duplicate).toBe(false);
    expect(res.statementId).toMatch(/[0-9a-f-]{36}/);

    const { transactions, statements } = await import("@/lib/db/schema");
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(3);

    const byDescription = Object.fromEntries(rows.map((r) => [r.description, r]));
    expect(byDescription["Whole Foods"].direction).toBe("outflow");
    expect(byDescription["Payroll"].direction).toBe("inflow");
    // Mock omitted direction; fallback uses sign (negative -> outflow).
    expect(byDescription["Unknown Fee"].direction).toBe("outflow");

    const [s] = await db.select().from(statements);
    expect(s.extractionStatus).toBe("succeeded");
    expect(s.periodStart).toBe("2026-04-01");
  }, 60_000);
});
