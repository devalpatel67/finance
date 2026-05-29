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
  } catch {
    // ignore
  }
  if (envt) await envt.stop();
}, 30_000);

describe("getSpendByCategory", () => {
  it("includes only direction=outflow rows; excludes inflow and transfer", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, transactions } = await import("@/lib/db/schema");
    const { getSpendByCategory } = await import("@/lib/queries/dashboard");

    await db.insert(users).values({ id: "u-donut", name: "Donut", email: "donut@x" });
    const [acc] = await db
      .insert(financialAccounts)
      .values({ userId: "u-donut", name: "Checking", kind: "checking", currency: "USD" })
      .returning();

    await db.insert(transactions).values([
      {
        userId: "u-donut",
        financialAccountId: acc.id,
        postedAt: "2026-05-20",
        description: "Whole Foods",
        amount: "-50.00",
        currency: "USD",
        direction: "outflow",
      },
      {
        userId: "u-donut",
        financialAccountId: acc.id,
        postedAt: "2026-05-21",
        description: "Refund",
        amount: "25.00",
        currency: "USD",
        direction: "inflow",
      },
      {
        userId: "u-donut",
        financialAccountId: acc.id,
        postedAt: "2026-05-22",
        description: "CC Payment",
        amount: "-200.00",
        currency: "USD",
        direction: "transfer",
      },
      {
        userId: "u-donut",
        financialAccountId: acc.id,
        postedAt: "1990-01-01",
        description: "Ancient outflow",
        amount: "-9999.00",
        currency: "USD",
        direction: "outflow",
      },
    ]);

    // Use a fromIso well before the inserted rows so all three are in range.
    const rows = await getSpendByCategory("u-donut", "2026-05-01", null);

    expect(rows).toHaveLength(1);
    // Raw SUM: -50.00 from the single in-window outflow. Refund and CC
    // Payment excluded (wrong direction); 1990 row excluded (out of range).
    expect(Math.abs(Number(rows[0].total))).toBeCloseTo(50, 2);
  }, 60_000);

  it("respects fromIso bound: out-of-range rows are excluded", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, transactions } = await import("@/lib/db/schema");
    const { getSpendByCategory } = await import("@/lib/queries/dashboard");

    await db.insert(users).values({ id: "u-donut-range", name: "DonutRange", email: "donut-range@x" });
    const [acc] = await db
      .insert(financialAccounts)
      .values({ userId: "u-donut-range", name: "Checking", kind: "checking", currency: "USD" })
      .returning();

    await db.insert(transactions).values([
      {
        userId: "u-donut-range",
        financialAccountId: acc.id,
        postedAt: "2026-02-15",
        description: "In window",
        amount: "-75.00",
        currency: "USD",
        direction: "outflow",
      },
      {
        userId: "u-donut-range",
        financialAccountId: acc.id,
        postedAt: "1990-01-01",
        description: "Out of window",
        amount: "-9999.00",
        currency: "USD",
        direction: "outflow",
      },
    ]);

    const rows = await getSpendByCategory("u-donut-range", "2026-01-01", null);

    expect(rows).toHaveLength(1);
    expect(Math.abs(Number(rows[0].total))).toBeCloseTo(75, 2);
  }, 60_000);
});
