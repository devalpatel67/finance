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

const extractMock = vi.fn(async () => ({
  account_summary: { period_start: "2026-04-01", period_end: "2026-04-30", currency: "USD" },
  transactions: [
    { posted_at: "2026-04-03", description: "Whole Foods", amount: -42.17, suggested_category: "Groceries", direction: "outflow" as const },
    { posted_at: "2026-04-10", description: "Payroll", amount: 3200.0, suggested_category: "Income", direction: "inflow" as const },
  ],
}));

vi.mock("@/lib/llm/extraction", async (orig) => {
  const real = await orig<typeof import("@/lib/llm/extraction")>();
  return { ...real, extractFromPdf: extractMock };
});

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: "u1", name: "Test", email: "t@x" } })) } },
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));

async function upload(accountId: string, bytes: string) {
  const { extractStatement } = await import("@/lib/actions/extract-statement");
  const fd = new FormData();
  fd.append("financialAccountId", accountId);
  fd.append("file", new File([Buffer.from(bytes)], "stmt.pdf", { type: "application/pdf" }));
  return extractStatement(fd);
}

describe("extractStatement content-hash dedup", () => {
  it("re-uploading identical bytes reuses the statement instead of duplicating", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, categories, statements, transactions } = await import("@/lib/db/schema");
    await db.insert(users).values({ id: "u1", name: "T", email: "t@x" });
    const [acc] = await db
      .insert(financialAccounts)
      .values({ userId: "u1", name: "Checking", kind: "checking", currency: "USD" })
      .returning();
    await db.insert(categories).values([
      { userId: "u1", name: "Groceries", isSystem: true },
      { userId: "u1", name: "Income", isSystem: true },
      { userId: "u1", name: "Uncategorized", isSystem: true },
    ]);

    const first = await upload(acc.id, "%PDF-1.4 SAME-BYTES");
    expect(first.duplicate).toBe(false);
    expect(extractMock).toHaveBeenCalledTimes(1);

    const second = await upload(acc.id, "%PDF-1.4 SAME-BYTES");
    // Same statement, flagged as duplicate, extraction not re-run.
    expect(second.statementId).toBe(first.statementId);
    expect(second.duplicate).toBe(true);
    expect(extractMock).toHaveBeenCalledTimes(1);

    expect(await db.select().from(statements)).toHaveLength(1);
    expect(await db.select().from(transactions)).toHaveLength(2);

    // Different bytes still create a new statement.
    const third = await upload(acc.id, "%PDF-1.4 DIFFERENT-BYTES");
    expect(third.statementId).not.toBe(first.statementId);
    expect(third.duplicate).toBe(false);
    expect(extractMock).toHaveBeenCalledTimes(2);
    expect(await db.select().from(statements)).toHaveLength(2);
  }, 90_000);
});
