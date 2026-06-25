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

const extractMock = vi.fn();
vi.mock("@/lib/llm/extraction", async (orig) => {
  const real = await orig<typeof import("@/lib/llm/extraction")>();
  return { ...real, extractFromPdf: (...args: unknown[]) => extractMock(...args) };
});
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: "u1", name: "T", email: "t@x" } })) } },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function summary(over: Record<string, unknown>) {
  return {
    account_summary: {
      period_start: "2026-04-01", period_end: "2026-04-30", currency: "CAD", ...over,
    },
    transactions: [
      { posted_at: "2026-04-03", description: "Tim Hortons", amount: 5, suggested_category: "Dining", direction: "outflow" },
    ],
  };
}

function pdf(name: string) {
  const fd = new FormData();
  fd.append("file", new File([Buffer.from(`%PDF-1.4 ${name}`)], name, { type: "application/pdf" }));
  return fd;
}

async function seedUser() {
  const { db } = await import("@/lib/db/client");
  const { users } = await import("@/lib/db/schema");
  await db.insert(users).values({ id: "u1", name: "T", email: "t@x" }).onConflictDoNothing();
}

describe("account identity matching", () => {
  it("matches an existing account by last4 + kind despite different institution wording", async () => {
    await seedUser();
    const { db } = await import("@/lib/db/client");
    const { financialAccounts } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [existing] = await db.insert(financialAccounts).values({
      userId: "u1", name: "RBC Checking", kind: "checking", institution: "RBC", last4: "7610", currency: "CAD",
    }).returning();

    extractMock.mockResolvedValueOnce(summary({ institution: "Royal Bank of Canada", last4: "7610", account_type: "checking" }));
    const { ingestStatement } = await import("@/lib/actions/ingest-statement");
    const res = await ingestStatement(pdf("rbc-jan.pdf"));

    expect(res.account.id).toBe(existing.id);
    expect(res.account.autoCreated).toBe(false);
    const all = await db.select().from(financialAccounts).where(eq(financialAccounts.userId, "u1"));
    expect(all.length).toBe(1);
  });

  it("collapses multiple no-last4 statements from one institution into a single bucket account", async () => {
    await seedUser();
    const { db } = await import("@/lib/db/client");
    const { financialAccounts } = await import("@/lib/db/schema");
    const { and, eq, isNull } = await import("drizzle-orm");
    const { ingestStatement } = await import("@/lib/actions/ingest-statement");

    extractMock.mockResolvedValueOnce(summary({ institution: "Bank of Nowhere", last4: undefined, account_type: "checking" }));
    const a = await ingestStatement(pdf("nowhere-1.pdf"));
    extractMock.mockResolvedValueOnce(summary({ institution: "Bank of Nowhere", last4: undefined, account_type: "checking" }));
    const b = await ingestStatement(pdf("nowhere-2.pdf"));

    expect(a.account.id).toBe(b.account.id);
    const buckets = await db.select().from(financialAccounts).where(and(
      eq(financialAccounts.userId, "u1"),
      eq(financialAccounts.institution, "Bank of Nowhere"),
      isNull(financialAccounts.last4),
    ));
    expect(buckets.length).toBe(1);
  });

  it("enforces one account per (user, kind, last4) via the unique index", async () => {
    await seedUser();
    const { db } = await import("@/lib/db/client");
    const { financialAccounts } = await import("@/lib/db/schema");
    const { and, eq, sql } = await import("drizzle-orm");
    await db.insert(financialAccounts).values({
      userId: "u1", name: "First", kind: "savings", institution: "X", last4: "4242", currency: "CAD",
    });
    // A second insert with the same (user, kind, last4) is a no-op.
    const dup = await db.insert(financialAccounts).values({
      userId: "u1", name: "Second", kind: "savings", institution: "Y", last4: "4242", currency: "CAD",
    }).onConflictDoNothing({
      target: [financialAccounts.userId, financialAccounts.kind, financialAccounts.last4],
      where: sql`${financialAccounts.last4} is not null`,
    }).returning();
    expect(dup.length).toBe(0);
    const rows = await db.select().from(financialAccounts).where(and(
      eq(financialAccounts.userId, "u1"),
      eq(financialAccounts.kind, "savings"),
      eq(financialAccounts.last4, "4242"),
    ));
    expect(rows.length).toBe(1);
  });
});
