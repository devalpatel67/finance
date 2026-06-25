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

async function seedUsers() {
  const { db } = await import("@/lib/db/client");
  const { users } = await import("@/lib/db/schema");
  await db.insert(users).values({ id: "u1", name: "T", email: "t@x" }).onConflictDoNothing();
  await db.insert(users).values({ id: "u2", name: "O", email: "o@x" }).onConflictDoNothing();
}

describe("updateAccount", () => {
  it("renames an account", async () => {
    await seedUsers();
    const { db } = await import("@/lib/db/client");
    const { financialAccounts } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [acc] = await db.insert(financialAccounts).values({
      userId: "u1", name: "Royal Bank of Canada ··7610", kind: "checking", institution: "RBC", last4: "7610", currency: "CAD",
    }).returning();

    const { updateAccount } = await import("@/lib/actions/update-account");
    await updateAccount({ id: acc.id, name: "RBC Chequing (Personal)", kind: "checking", institution: "RBC", last4: "7610", currency: "CAD" });

    const [after] = await db.select().from(financialAccounts).where(eq(financialAccounts.id, acc.id));
    expect(after.name).toBe("RBC Chequing (Personal)");
  });

  it("re-reconciles the account's statements when kind changes", async () => {
    await seedUsers();
    const { db } = await import("@/lib/db/client");
    const { financialAccounts, statements, transactions } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [acc] = await db.insert(financialAccounts).values({
      userId: "u1", name: "Mystery", kind: "checking", institution: "Z", last4: "1111", currency: "CAD",
    }).returning();
    // opening 100, closing 150, one +50 txn. checking: 100+50=150 → reconciled.
    // credit: 100-50=50 ≠ 150 → discrepancy, delta 100.
    const [stmt] = await db.insert(statements).values({
      userId: "u1", financialAccountId: acc.id, sourceFilename: "s.pdf", storageBucket: "b", storageKey: "k",
      openingBalance: "100.00", closingBalance: "150.00", reconciliationStatus: "reconciled",
      reconciliationDelta: "0.00", extractionStatus: "succeeded",
    }).returning();
    await db.insert(transactions).values({
      userId: "u1", financialAccountId: acc.id, statementId: stmt.id,
      postedAt: "2026-04-03", description: "Dep", amount: "50.00", direction: "inflow", currency: "CAD",
    });

    const { updateAccount } = await import("@/lib/actions/update-account");
    await updateAccount({ id: acc.id, name: "Mystery", kind: "credit", institution: "Z", last4: "1111", currency: "CAD" });

    const [after] = await db.select().from(statements).where(eq(statements.id, stmt.id));
    expect(after.reconciliationStatus).toBe("discrepancy");
    expect(Number(after.reconciliationDelta)).toBeCloseTo(100, 2);
  });

  it("rejects an edit that collides with another account's (kind, last4)", async () => {
    await seedUsers();
    const { db } = await import("@/lib/db/client");
    const { financialAccounts } = await import("@/lib/db/schema");
    await db.insert(financialAccounts).values({
      userId: "u1", name: "A", kind: "credit", institution: "X", last4: "2222", currency: "CAD",
    });
    const [b] = await db.insert(financialAccounts).values({
      userId: "u1", name: "B", kind: "credit", institution: "Y", last4: "3333", currency: "CAD",
    }).returning();

    const { updateAccount } = await import("@/lib/actions/update-account");
    // Edit B to collide with A's (credit, 2222).
    await expect(
      updateAccount({ id: b.id, name: "B", kind: "credit", institution: "Y", last4: "2222", currency: "CAD" }),
    ).rejects.toThrow(/already (have|exists)/i);
  });

  it("will not edit another user's account", async () => {
    await seedUsers();
    const { db } = await import("@/lib/db/client");
    const { financialAccounts } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [acc] = await db.insert(financialAccounts).values({
      userId: "u2", name: "Other", kind: "checking", currency: "CAD",
    }).returning();

    const { updateAccount } = await import("@/lib/actions/update-account");
    await expect(
      updateAccount({ id: acc.id, name: "Hacked", kind: "checking", currency: "CAD" }),
    ).rejects.toThrow("Account not found");

    const [after] = await db.select().from(financialAccounts).where(eq(financialAccounts.id, acc.id));
    expect(after.name).toBe("Other");
  });
});
