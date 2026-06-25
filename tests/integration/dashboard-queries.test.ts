import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  } catch { /* ignore */ }
  if (envt) await envt.stop();
}, 30_000);

describe("dashboard queries", () => {
  it("aggregates cash flow, merchants, and daily spend", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, transactions } = await import("@/lib/db/schema");
    const { getMonthlyCashFlow, getTopMerchants, getDailySpend } = await import("@/lib/queries/dashboard");

    await db.insert(users).values({ id: "u-dq", name: "DQ", email: "dq@x" });
    const [acc] = await db.insert(financialAccounts).values({
      userId: "u-dq", name: "Chq", kind: "checking", currency: "CAD",
    }).returning();
    const base = { userId: "u-dq", financialAccountId: acc.id, currency: "CAD" };
    await db.insert(transactions).values([
      { ...base, postedAt: "2026-05-10", description: "A", merchant: "Amazon", amount: "-50.00", direction: "outflow" },
      { ...base, postedAt: "2026-05-12", description: "B", merchant: "Amazon", amount: "-30.00", direction: "outflow" },
      { ...base, postedAt: "2026-05-15", description: "Pay", amount: "200.00", direction: "inflow" },
      { ...base, postedAt: "2026-06-03", description: "C", merchant: "Walmart", amount: "-100.00", direction: "outflow" },
    ]);

    const cf = await getMonthlyCashFlow("u-dq", null, null);
    expect(cf).toEqual([
      { month: "2026-05", inflow: 200, outflow: 80 },
      { month: "2026-06", inflow: 0, outflow: 100 },
    ]);

    const merch = await getTopMerchants("u-dq", null, null, 6);
    expect(merch).toEqual([
      { merchant: "Walmart", total: 100, count: 1 },
      { merchant: "Amazon", total: 80, count: 2 },
    ]);

    const daily = await getDailySpend("u-dq", null, null);
    const map = Object.fromEntries(daily.map((d) => [d.date, d.total]));
    expect(map).toEqual({ "2026-05-10": 50, "2026-05-12": 30, "2026-06-03": 100 });
  });

  it("excludes the Transfers category and merges near-duplicate merchants", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, transactions, categories } = await import("@/lib/db/schema");
    const { getMonthlyCashFlow, getTopMerchants, getSpendByCategory } = await import("@/lib/queries/dashboard");

    await db.insert(users).values({ id: "u-dq2", name: "DQ2", email: "dq2@x" });
    const [acc] = await db.insert(financialAccounts).values({
      userId: "u-dq2", name: "Chq", kind: "checking", currency: "CAD",
    }).returning();
    const [transfers] = await db.insert(categories).values({ userId: "u-dq2", name: "Transfers", isSystem: true }).returning();
    const base = { userId: "u-dq2", financialAccountId: acc.id, currency: "CAD", postedAt: "2026-05-10" };
    await db.insert(transactions).values([
      { ...base, description: "PP1", merchant: "Payment Pad", amount: "-100.00", direction: "outflow" },
      { ...base, description: "PP2", merchant: "Payment Pad Inc", amount: "-50.00", direction: "outflow" },
      { ...base, description: "XFER", merchant: "Friend", amount: "-200.00", direction: "outflow", categoryId: transfers.id },
    ]);

    const merch = await getTopMerchants("u-dq2", null, null, 6, transfers.id);
    expect(merch).toEqual([{ merchant: "Payment Pad", total: 150, count: 2 }]); // merged; transfer excluded

    const cf = await getMonthlyCashFlow("u-dq2", null, null, transfers.id);
    expect(cf).toEqual([{ month: "2026-05", inflow: 0, outflow: 150 }]); // 200 transfer excluded

    const spend = await getSpendByCategory("u-dq2", null, null, transfers.id);
    expect(spend.every((r) => r.categoryId !== transfers.id)).toBe(true);
  });
});
