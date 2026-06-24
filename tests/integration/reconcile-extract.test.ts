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

const extractMock = vi.fn();
vi.mock("@/lib/llm/extraction", async (orig) => {
  const real = await orig<typeof import("@/lib/llm/extraction")>();
  return { ...real, extractFromPdf: extractMock };
});

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: "u1", name: "T", email: "t@x" } })) } },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));

const TXNS_A = [
  { posted_at: "2024-12-05", description: "Purchase A", amount: -789.55, suggested_category: "Shopping", direction: "outflow" as const },
  { posted_at: "2024-12-20", description: "Payment A", amount: 393.0, suggested_category: "Transfers", direction: "transfer" as const },
];
const TXNS_B = [
  { posted_at: "2024-12-06", description: "Purchase B", amount: -100.0, suggested_category: "Shopping", direction: "outflow" as const },
  { posted_at: "2024-12-21", description: "Payment B", amount: 50.0, suggested_category: "Transfers", direction: "transfer" as const },
];

const summary = (opening: number, closing: number, txns: typeof TXNS_A) => ({
  account_summary: {
    period_start: "2024-12-01", period_end: "2024-12-31", currency: "CAD",
    opening_balance: opening, closing_balance: closing,
  },
  transactions: txns,
});

async function upload(accountId: string, bytes: string) {
  const { extractStatement } = await import("@/lib/actions/extract-statement");
  const fd = new FormData();
  fd.append("financialAccountId", accountId);
  fd.append("file", new File([Buffer.from(bytes)], "s.pdf", { type: "application/pdf" }));
  await extractStatement(fd);
}

describe("reconciliation on extract", () => {
  it("marks reconciled when balances tie out and discrepancy when they don't", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, categories, statements, transactions } = await import("@/lib/db/schema");
    await db.insert(users).values({ id: "u1", name: "T", email: "t@x" });
    const [acc] = await db.insert(financialAccounts)
      .values({ userId: "u1", name: "Visa", kind: "credit", currency: "CAD" }).returning();
    await db.insert(categories).values([
      { userId: "u1", name: "Shopping", isSystem: true },
      { userId: "u1", name: "Transfers", isSystem: true },
      { userId: "u1", name: "Uncategorized", isSystem: true },
    ]);

    // credit: expected closing = 812.30 - (-789.55 + 393.00) = 1208.85
    extractMock.mockResolvedValueOnce(summary(812.3, 1208.85, TXNS_A));
    await upload(acc.id, "%PDF-1.4 TIES-OUT");
    const [ok] = await db.select().from(statements);
    expect(ok.reconciliationStatus).toBe("reconciled");
    expect(ok.reconciliationDelta).toBe("0.00");
    expect(ok.openingBalance).toBe("812.30");

    // credit: expected closing = 200 - (-100 + 50) = 250; stated 300 → delta = 300 - 250 = 50
    extractMock.mockResolvedValueOnce(summary(200, 300, TXNS_B));
    await upload(acc.id, "%PDF-1.4 OFF-BY");
    const offRows = await db.select().from(statements);
    const off = offRows.find((s) => s.id !== ok.id)!;
    expect(off.reconciliationStatus).toBe("discrepancy");
    expect(off.reconciliationDelta).toBe("50.00");

    // transactions still imported for the discrepant statement
    const offTxns = await db.select().from(transactions).where(eq(transactions.statementId, off.id));
    expect(offTxns.length).toBe(2);
  }, 90_000);
});
