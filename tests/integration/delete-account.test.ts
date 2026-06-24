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

async function seedUser() {
  const { db } = await import("@/lib/db/client");
  const { users } = await import("@/lib/db/schema");
  await db.insert(users).values({ id: "u1", name: "T", email: "t@x" }).onConflictDoNothing();
  await db.insert(users).values({ id: "u2", name: "O", email: "o@x" }).onConflictDoNothing();
}

describe("deleteAccount", () => {
  it("deletes an empty account", async () => {
    await seedUser();
    const { db } = await import("@/lib/db/client");
    const { financialAccounts } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [acc] = await db.insert(financialAccounts).values({
      userId: "u1", name: "Empty", kind: "checking", currency: "USD",
    }).returning();

    const { deleteAccount } = await import("@/lib/actions/delete-account");
    await expect(deleteAccount({ id: acc.id })).resolves.toEqual({ deleted: true });

    const rows = await db.select().from(financialAccounts).where(eq(financialAccounts.id, acc.id));
    expect(rows.length).toBe(0);
  });

  it("refuses to delete an account that has statements", async () => {
    await seedUser();
    const { db } = await import("@/lib/db/client");
    const { financialAccounts, statements } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [acc] = await db.insert(financialAccounts).values({
      userId: "u1", name: "HasStmt", kind: "checking", currency: "USD",
    }).returning();
    await db.insert(statements).values({
      userId: "u1", financialAccountId: acc.id, sourceFilename: "s.pdf",
      storageBucket: "b", storageKey: "k", extractionStatus: "succeeded",
    });

    const { deleteAccount } = await import("@/lib/actions/delete-account");
    await expect(deleteAccount({ id: acc.id })).rejects.toThrow();

    const rows = await db.select().from(financialAccounts).where(eq(financialAccounts.id, acc.id));
    expect(rows.length).toBe(1);
  });

  it("will not delete another user's account", async () => {
    await seedUser();
    const { db } = await import("@/lib/db/client");
    const { financialAccounts } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [acc] = await db.insert(financialAccounts).values({
      userId: "u2", name: "Other", kind: "checking", currency: "USD",
    }).returning();

    const { deleteAccount } = await import("@/lib/actions/delete-account");
    await expect(deleteAccount({ id: acc.id })).rejects.toThrow("Account not found");

    const rows = await db.select().from(financialAccounts).where(eq(financialAccounts.id, acc.id));
    expect(rows.length).toBe(1);
  });
});
