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
  getStatementPdf: vi.fn(async () => Buffer.from("%PDF-1.4 x")),
}));

vi.mock("@/lib/llm/extraction", async (orig) => {
  const real = await orig<typeof import("@/lib/llm/extraction")>();
  return {
    ...real,
    extractFromPdf: vi.fn(async () => ({
      account_summary: { period_start: "2026-04-01", period_end: "2026-04-30", currency: "USD" },
      transactions: [
        { posted_at: "2026-04-03", description: "STARBUCKS 57744 NIAGARA FALLSON", amount: -2.73, suggested_category: "Shopping", direction: "outflow" },
      ],
    })),
  };
});

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: "u1", name: "T", email: "t@x" } })) } },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("reprocess preserves manual categorization", () => {
  it("re-applies a manual category by normalized key after reprocess", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, categories, statements, transactions } = await import("@/lib/db/schema");
    await db.insert(users).values({ id: "u1", name: "T", email: "t@x" });
    const [acc] = await db.insert(financialAccounts)
      .values({ userId: "u1", name: "Visa", kind: "credit", currency: "USD" }).returning();
    const [coffee] = await db.insert(categories).values({ userId: "u1", name: "Coffee", isSystem: false }).returning();
    await db.insert(categories).values([
      { userId: "u1", name: "Shopping", isSystem: true },
      { userId: "u1", name: "Uncategorized", isSystem: true },
    ]);
    const [s] = await db.insert(statements).values({
      userId: "u1", financialAccountId: acc.id, sourceFilename: "s.pdf",
      storageBucket: "b", storageKey: "k", modelUsed: "google/gemini-2.5-flash",
      extractionStatus: "succeeded",
    }).returning();

    // existing manually-categorized row; double space collapses to match extracted "STARBUCKS 57744 NIAGARA FALLSON"
    await db.insert(transactions).values({
      userId: "u1", financialAccountId: acc.id, statementId: s.id, postedAt: "2026-04-03",
      description: "STARBUCKS 57744 NIAGARA  FALLSON", amount: "-2.73", direction: "outflow",
      currency: "USD", categoryId: coffee.id, categorySource: "manual",
    });

    const { reprocessStatement } = await import("@/lib/actions/reprocess-statement");
    await reprocessStatement(s.id, "google/gemini-2.5-pro");

    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
    expect(rows[0].categoryId).toBe(coffee.id);
    expect(rows[0].categorySource).toBe("manual");
  }, 90_000);
});
