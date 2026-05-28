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

const getSessionMock = vi.fn(async () => ({ user: { id: "u-a", name: "A", email: "a@x" } }));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSessionMock(...(args as [])) } },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("updateTransactionDirection", () => {
  it("updates the direction for the caller's own transaction", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, transactions } = await import("@/lib/db/schema");

    await db.insert(users).values({ id: "u-happy", name: "Happy", email: "happy@x" });
    const [acc] = await db
      .insert(financialAccounts)
      .values({ userId: "u-happy", name: "Checking", kind: "checking", currency: "USD" })
      .returning();
    const [tx] = await db
      .insert(transactions)
      .values({
        userId: "u-happy",
        financialAccountId: acc.id,
        postedAt: "2026-04-01",
        description: "Test",
        amount: "-10.00",
        currency: "USD",
        direction: "outflow",
      })
      .returning();

    getSessionMock.mockResolvedValueOnce({ user: { id: "u-happy", name: "Happy", email: "happy@x" } });

    const { updateTransactionDirection } = await import("@/lib/actions/update-transaction");
    await updateTransactionDirection({ transactionId: tx.id, direction: "transfer" });

    const [row] = await db.select().from(transactions).where(eq(transactions.id, tx.id));
    expect(row.direction).toBe("transfer");
  }, 60_000);

  it("does not update another user's transaction", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, transactions } = await import("@/lib/db/schema");

    await db.insert(users).values([
      { id: "u-iso-a", name: "IsoA", email: "iso-a@x" },
      { id: "u-iso-b", name: "IsoB", email: "iso-b@x" },
    ]);
    const [accA] = await db
      .insert(financialAccounts)
      .values({ userId: "u-iso-a", name: "A Checking", kind: "checking", currency: "USD" })
      .returning();
    const [accB] = await db
      .insert(financialAccounts)
      .values({ userId: "u-iso-b", name: "B Checking", kind: "checking", currency: "USD" })
      .returning();
    await db.insert(transactions).values({
      userId: "u-iso-a",
      financialAccountId: accA.id,
      postedAt: "2026-04-02",
      description: "A's tx",
      amount: "-5.00",
      currency: "USD",
      direction: "outflow",
    });
    const [txB] = await db
      .insert(transactions)
      .values({
        userId: "u-iso-b",
        financialAccountId: accB.id,
        postedAt: "2026-04-03",
        description: "B's tx",
        amount: "-7.00",
        currency: "USD",
        direction: "outflow",
      })
      .returning();

    // Session is user A, but we attempt to mutate user B's transaction.
    getSessionMock.mockResolvedValueOnce({ user: { id: "u-iso-a", name: "IsoA", email: "iso-a@x" } });

    const { updateTransactionDirection } = await import("@/lib/actions/update-transaction");
    await updateTransactionDirection({ transactionId: txB.id, direction: "inflow" });

    const [rowB] = await db.select().from(transactions).where(eq(transactions.id, txB.id));
    expect(rowB.direction).toBe("outflow");
  }, 60_000);

  it("throws on an invalid direction value", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "u-happy", name: "Happy", email: "happy@x" } });

    const { updateTransactionDirection } = await import("@/lib/actions/update-transaction");
    await expect(
      updateTransactionDirection({
        transactionId: "00000000-0000-0000-0000-000000000000",
        // @ts-expect-error — intentionally invalid to verify Zod rejects it
        direction: "bogus",
      }),
    ).rejects.toThrow();
  }, 60_000);
});
