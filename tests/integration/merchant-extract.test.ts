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
    // ignore
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
        { posted_at: "2026-04-03", description: "AMZN MKTP CA*ZX1 WWW.AMAZON.CA", amount: -42.17, suggested_category: "Shopping", direction: "outflow", merchant: "Amazon" },
        { posted_at: "2026-04-04", description: "MYSTERY CHARGE", amount: -9.99, suggested_category: "Other", direction: "outflow" },
      ],
    })),
  };
});

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: "u1", name: "T", email: "t@x" } })) } },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

describe("extract persists merchant", () => {
  it("stores the merchant when present and null when absent", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, categories, transactions } = await import("@/lib/db/schema");
    await db.insert(users).values({ id: "u1", name: "T", email: "t@x" });
    const [acc] = await db.insert(financialAccounts)
      .values({ userId: "u1", name: "Visa", kind: "credit", currency: "USD" }).returning();
    await db.insert(categories).values([
      { userId: "u1", name: "Shopping", isSystem: true },
      { userId: "u1", name: "Other", isSystem: true },
      { userId: "u1", name: "Uncategorized", isSystem: true },
    ]);

    const { extractStatement } = await import("@/lib/actions/extract-statement");
    const fd = new FormData();
    fd.append("financialAccountId", acc.id);
    fd.append("file", new File([Buffer.from("%PDF-1.4 x")], "s.pdf", { type: "application/pdf" }));
    const res = await extractStatement(fd);
    expect(res.duplicate).toBe(false);

    const rows = await db.select().from(transactions);
    const amazon = rows.find((r) => r.description.includes("AMZN"))!;
    const mystery = rows.find((r) => r.description.includes("MYSTERY"))!;
    expect(amazon.merchant).toBe("Amazon");
    expect(mystery.merchant).toBeNull();
  }, 90_000);
});
