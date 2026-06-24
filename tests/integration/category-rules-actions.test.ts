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

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: "u1", name: "T", email: "t@x" } })) } },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("learn-from-edits", () => {
  it("manual edit sets source=manual; createCategoryRule backfills non-manual only", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, categories, transactions } = await import("@/lib/db/schema");
    await db.insert(users).values({ id: "u1", name: "T", email: "t@x" });
    const [acc] = await db.insert(financialAccounts)
      .values({ userId: "u1", name: "Visa", kind: "credit", currency: "USD" }).returning();
    const [dining] = await db.insert(categories).values({ userId: "u1", name: "Dining", isSystem: true }).returning();
    const [coffee] = await db.insert(categories).values({ userId: "u1", name: "Coffee", isSystem: false }).returning();

    const [a] = await db.insert(transactions).values({
      userId: "u1", financialAccountId: acc.id, postedAt: "2026-04-01",
      description: "STARBUCKS 1 TORONTO ON", amount: "-5.00", direction: "outflow", currency: "USD",
      categorySource: "suggested",
    }).returning();
    const [b] = await db.insert(transactions).values({
      userId: "u1", financialAccountId: acc.id, postedAt: "2026-04-02",
      description: "STARBUCKS 2 OTTAWA ON", amount: "-6.00", direction: "outflow", currency: "USD",
      categorySource: "suggested",
    }).returning();

    const { updateTransactionCategory } = await import("@/lib/actions/update-transaction");
    await updateTransactionCategory({ transactionId: b.id, categoryId: coffee.id });
    const bAfterEdit = (await db.select().from(transactions).where(eq(transactions.id, b.id)))[0];
    expect(bAfterEdit.categorySource).toBe("manual");

    const { createCategoryRule } = await import("@/lib/actions/category-rules");
    await createCategoryRule({ keyword: "STARBUCKS", categoryId: dining.id });

    const aAfter = (await db.select().from(transactions).where(eq(transactions.id, a.id)))[0];
    const bAfter = (await db.select().from(transactions).where(eq(transactions.id, b.id)))[0];
    expect(aAfter.categoryId).toBe(dining.id);
    expect(aAfter.categorySource).toBe("rule");        // non-manual → backfilled
    expect(bAfter.categoryId).toBe(coffee.id);          // manual → untouched
    expect(bAfter.categorySource).toBe("manual");
  }, 90_000);
});
