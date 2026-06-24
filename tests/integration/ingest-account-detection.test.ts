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

vi.mock("@/lib/llm/extraction", async (orig) => {
  const real = await orig<typeof import("@/lib/llm/extraction")>();
  return {
    ...real,
    extractFromPdf: vi.fn(async () => ({
      account_summary: {
        institution: "American Express", last4: "9001", account_type: "credit",
        period_start: "2026-04-01", period_end: "2026-04-30", currency: "USD",
        opening_balance: 100, closing_balance: 150,
      },
      transactions: [
        { posted_at: "2026-04-03", description: "Whole Foods", amount: 50, suggested_category: "Groceries", direction: "outflow" },
      ],
    })),
  };
});

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: "u1", name: "T", email: "t@x" } })) } },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

async function seed() {
  const { db } = await import("@/lib/db/client");
  const { users, categories } = await import("@/lib/db/schema");
  await db.insert(users).values({ id: "u1", name: "T", email: "t@x" }).onConflictDoNothing();
  await db.insert(categories).values([
    { userId: "u1", name: "Groceries", isSystem: true },
    { userId: "u1", name: "Uncategorized", isSystem: true },
  ]).onConflictDoNothing();
}

function pdf(name: string) {
  const fd = new FormData();
  fd.append("file", new File([Buffer.from(`%PDF-1.4 ${name}`)], name, { type: "application/pdf" }));
  return fd;
}

describe("ingestStatement account detection", () => {
  it("auto-creates an account with the extracted kind when none matches", async () => {
    await seed();
    const { ingestStatement } = await import("@/lib/actions/ingest-statement");
    const { db } = await import("@/lib/db/client");
    const { financialAccounts } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    const res = await ingestStatement(pdf("amex-apr.pdf"));

    expect(res.account.autoCreated).toBe(true);
    expect(res.duplicate).toBe(false);
    expect(res.txnCount).toBe(1);
    const [created] = await db.select().from(financialAccounts).where(eq(financialAccounts.id, res.account.id));
    expect(created.kind).toBe("credit");
    expect(created.last4).toBe("9001");
  });

  it("reuses an existing matching account instead of creating a new one", async () => {
    await seed();
    const { db } = await import("@/lib/db/client");
    const { financialAccounts } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [existing] = await db.insert(financialAccounts).values({
      userId: "u1", name: "My Amex", kind: "credit", institution: "Amex", last4: "9001", currency: "USD",
    }).returning();

    const { ingestStatement } = await import("@/lib/actions/ingest-statement");
    const res = await ingestStatement(pdf("amex-may.pdf"));

    expect(res.account.id).toBe(existing.id);
    expect(res.account.autoCreated).toBe(false);
    // Verify no extra account was created with institution "Amex" (the inserted one).
    const { and } = await import("drizzle-orm");
    const amexAccounts = await db.select().from(financialAccounts).where(
      and(eq(financialAccounts.userId, "u1"), eq(financialAccounts.institution, "Amex")),
    );
    expect(amexAccounts.length).toBe(1);
  });

  it("short-circuits a duplicate PDF without re-extracting", async () => {
    await seed();
    const { ingestStatement } = await import("@/lib/actions/ingest-statement");
    const { extractFromPdf } = await import("@/lib/llm/extraction");
    const first = await ingestStatement(pdf("dup.pdf"));
    const callsAfterFirst = (extractFromPdf as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    const second = await ingestStatement(pdf("dup.pdf"));
    expect(second.duplicate).toBe(true);
    expect(second.statementId).toBe(first.statementId);
    expect((extractFromPdf as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(callsAfterFirst);
  });
});
