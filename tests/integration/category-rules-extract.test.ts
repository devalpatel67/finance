import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
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
        { posted_at: "2026-04-03", description: "STARBUCKS 57744 NIAGARA FALLS ON", amount: -2.73, suggested_category: "Shopping", direction: "outflow" },
        { posted_at: "2026-04-04", description: "UNKNOWN MERCHANT", amount: -9.99, suggested_category: "Shopping", direction: "outflow" },
      ],
    })),
  };
});

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: "u1", name: "T", email: "t@x" } })) } },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("extract applies category rules", () => {
  it("a matching rule sets category + source 'rule'; non-match stays 'suggested'", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, categories, categoryRules, transactions } = await import("@/lib/db/schema");
    await db.insert(users).values({ id: "u1", name: "T", email: "t@x" });
    const [acc] = await db.insert(financialAccounts)
      .values({ userId: "u1", name: "Visa", kind: "credit", currency: "USD" }).returning();
    const [dining] = await db.insert(categories)
      .values({ userId: "u1", name: "Dining", isSystem: true }).returning();
    await db.insert(categories).values([
      { userId: "u1", name: "Shopping", isSystem: true },
      { userId: "u1", name: "Uncategorized", isSystem: true },
    ]);
    await db.insert(categoryRules).values({ userId: "u1", keyword: "starbucks", categoryId: dining.id });

    const { ingestStatement } = await import("@/lib/actions/ingest-statement");
    const fd = new FormData();
    fd.append("financialAccountId", acc.id);
    fd.append("file", new File([Buffer.from("%PDF-1.4 x")], "s.pdf", { type: "application/pdf" }));
    await ingestStatement(fd);

    const rows = await db.select().from(transactions);
    const sbux = rows.find((r) => r.description.includes("STARBUCKS"))!;
    const other = rows.find((r) => r.description.includes("UNKNOWN"))!;
    expect(sbux.categoryId).toBe(dining.id);
    expect(sbux.categorySource).toBe("rule");
    expect(other.categorySource).toBe("suggested");
  }, 90_000);
});
