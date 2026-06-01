import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
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

describe("direction backfill migration", () => {
  it("post-migration: positive amounts are inflow, negative are outflow", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, transactions } = await import("@/lib/db/schema");

    await db.insert(users).values({ id: "u-bf", name: "BF", email: "bf@x" });
    const [acc] = await db
      .insert(financialAccounts)
      .values({ userId: "u-bf", name: "BF Checking", kind: "checking", currency: "USD" })
      .returning();

    // Insert rows with mixed amounts. The migration ran during bootstrap, so
    // these rows go in with whatever default the column has. We then re-run
    // the backfill statement to assert its semantics on these rows.
    await db.insert(transactions).values([
      { userId: "u-bf", financialAccountId: acc.id, postedAt: "2026-04-01", description: "Payroll",     amount: "3200.00", currency: "USD" },
      { userId: "u-bf", financialAccountId: acc.id, postedAt: "2026-04-02", description: "Whole Foods", amount: "-42.17", currency: "USD" },
      { userId: "u-bf", financialAccountId: acc.id, postedAt: "2026-04-03", description: "Zero",        amount: "0.00",   currency: "USD" },
    ]);

    // Reset to the pre-backfill default so we can prove the UPDATE works.
    await db.execute(sql`UPDATE "transactions" SET "direction" = 'outflow'`);

    // The exact statement appended to the generated migration.
    await db.execute(
      sql`UPDATE "transactions" SET "direction" = CASE WHEN "amount"::numeric >= 0 THEN 'inflow' ELSE 'outflow' END`,
    );

    const rows = await db
      .select({ description: transactions.description, direction: transactions.direction })
      .from(transactions);

    const byDesc = Object.fromEntries(rows.map((r) => [r.description, r.direction]));
    expect(byDesc["Payroll"]).toBe("inflow");
    expect(byDesc["Whole Foods"]).toBe("outflow");
    expect(byDesc["Zero"]).toBe("inflow");
  }, 60_000);
});
