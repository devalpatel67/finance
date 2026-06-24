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
  } catch { /* ignore */ }
  if (envt) await envt.stop();
}, 30_000);

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: "u1", name: "T", email: "t@x" } })) } },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("reassignStatementAccount", () => {
  it("moves the statement + its transactions and re-reconciles for the new kind", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, statements, transactions } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.insert(users).values({ id: "u1", name: "T", email: "t@x" }).onConflictDoNothing();

    const [asset] = await db.insert(financialAccounts).values({
      userId: "u1", name: "Checking", kind: "checking", currency: "USD",
    }).returning();
    const [credit] = await db.insert(financialAccounts).values({
      userId: "u1", name: "Card", kind: "credit", currency: "USD",
    }).returning();

    // opening 100, closing 150, one +50 txn. Asset: 100+50=150 → reconciled.
    // Credit: 100-50=50 ≠ 150 → discrepancy, delta 100.
    const sid = (await import("node:crypto")).randomUUID();
    await db.insert(statements).values({
      id: sid, userId: "u1", financialAccountId: asset.id, sourceFilename: "s.pdf",
      storageBucket: "b", storageKey: "k", openingBalance: "100.00", closingBalance: "150.00",
      reconciliationStatus: "reconciled", reconciliationDelta: "0.00", extractionStatus: "succeeded",
    });
    await db.insert(transactions).values({
      userId: "u1", financialAccountId: asset.id, statementId: sid,
      postedAt: "2026-04-03", description: "Dep", amount: "50.00", direction: "inflow", currency: "USD",
    });

    const { reassignStatementAccount } = await import("@/lib/actions/reassign-statement-account");
    const res = await reassignStatementAccount({ statementId: sid, accountId: credit.id });

    expect(res.reconciliation.status).toBe("discrepancy");
    expect(res.reconciliation.delta).toBe(100);

    const [movedStmt] = await db.select().from(statements).where(eq(statements.id, sid));
    expect(movedStmt.financialAccountId).toBe(credit.id);
    const txns = await db.select().from(transactions).where(eq(transactions.statementId, sid));
    expect(txns.every((t) => t.financialAccountId === credit.id)).toBe(true);
  });
});
