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
    const pool = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
    if (pool?.end) await pool.end();
  } catch {
    // ignore — db may not have been loaded
  }
  if (envt) await envt.stop();
}, 30_000);

vi.mock("@/lib/storage/minio", () => ({
  getStatementPdf: vi.fn(async () => Buffer.from("%PDF-1.4 fake")),
}));

vi.mock("@/lib/llm/extraction", async (orig) => {
  const real = await orig<typeof import("@/lib/llm/extraction")>();
  return {
    ...real,
    extractFromPdf: vi.fn(async () => ({
      account_summary: { period_start: "2026-04-01", period_end: "2026-04-30", currency: "USD" },
      transactions: [
        { posted_at: "2026-04-03", description: "Whole Foods", amount: -42.17, suggested_category: "Groceries", direction: "outflow" },
        { posted_at: "2026-04-10", description: "Payroll", amount: 3200.0, suggested_category: "Income", direction: "inflow" },
        { posted_at: "2026-04-20", description: "CC Payment", amount: -500.0, suggested_category: "Transfers", direction: "transfer" },
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

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("reprocessStatement", () => {
  it("preserves transaction direction on re-extraction", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, categories, statements } = await import("@/lib/db/schema");

    await db.insert(users).values({ id: "u1", name: "T", email: "t@x" });
    const [acc] = await db
      .insert(financialAccounts)
      .values({ userId: "u1", name: "Checking", kind: "checking", currency: "USD" })
      .returning();
    await db.insert(categories).values([
      { userId: "u1", name: "Groceries", isSystem: true },
      { userId: "u1", name: "Income", isSystem: true },
      { userId: "u1", name: "Transfers", isSystem: true },
      { userId: "u1", name: "Uncategorized", isSystem: true },
    ]);
    const [s] = await db
      .insert(statements)
      .values({
        userId: "u1",
        financialAccountId: acc.id,
        sourceFilename: "april.pdf",
        storageBucket: "statements",
        storageKey: "users/u1/statements/x.pdf",
        modelUsed: "google/gemini-2.5-flash",
        extractionStatus: "succeeded",
      })
      .returning();

    const { reprocessStatement } = await import("@/lib/actions/reprocess-statement");
    await reprocessStatement(s.id, "google/gemini-2.5-pro");

    const { transactions } = await import("@/lib/db/schema");
    const rows = await db.select().from(transactions);
    const byDescription = Object.fromEntries(rows.map((r) => [r.description, r]));

    expect(byDescription["Whole Foods"].direction).toBe("outflow");
    expect(byDescription["Payroll"].direction).toBe("inflow");
    expect(byDescription["CC Payment"].direction).toBe("transfer");
  }, 60_000);
});
