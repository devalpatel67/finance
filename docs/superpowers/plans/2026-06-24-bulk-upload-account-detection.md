# Bulk Statement Upload + Account Auto-Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drop ~100 PDF statements at once and have each one extracted, auto-assigned to the right financial account (or a freshly auto-created one), with live per-file status and an inline override.

**Architecture:** Client-orchestrated, concurrency-limited. The browser holds the file list and fires one server action per file (cap 3). The ingest server action's `financialAccountId` becomes optional; the pipeline is reordered so account resolution runs *after* extraction (institution/last4 are only known post-extraction). Unmatched statements auto-create an account; the type comes from a new `account_type` extraction field. An inline override re-keys a statement to a different account and re-reconciles.

**Tech Stack:** Next.js 16 (App Router, server actions), TypeScript, Drizzle ORM + Postgres, OpenRouter (PDF extraction), MinIO/S3, Zod, Vitest + Testcontainers, shadcn/ui.

**Linear:** ARC-247
**Spec:** `docs/superpowers/specs/2026-06-24-bulk-upload-account-detection-design.md`

## Global Constraints

- All DB access in server actions uses the raw `@/lib/db/client` `db` (actions are exempt from the `app/**` scopedDb ESLint rule); every query is explicitly scoped by `eq(table.userId, userId)`.
- File limits: PDF only (`type === "application/pdf"`), `size ≤ 10 * 1024 * 1024` bytes. Validated client-side AND server-side.
- Content-hash dedup is preserved: identical PDF (same user, `extractionStatus = "succeeded"`) short-circuits with no re-extraction.
- Transaction inserts keep `onConflictDoNothing` on the unique target `[userId, financialAccountId, postedAt, amount, description]`.
- Reconciliation `kind` semantics: asset (`checking`/`savings`) `closing = opening + Σ`; `credit` `closing = opening − Σ`; `investment` → `not_applicable`. Auto-created accounts MUST get the correct `kind`.
- Concurrency cap for the batch runner is **3**.
- Money is stored as numeric strings (`.toFixed(2)`); convert with `Number()`/`parseFloat` before arithmetic.
- No background queue/worker. No new dependencies.

---

### Task 1: Add `account_type` to extraction

**Files:**
- Modify: `lib/llm/extraction.ts`
- Test: `tests/unit/extraction.test.ts`

**Interfaces:**
- Produces: `ExtractionResult.account_summary.account_type?: "checking" | "savings" | "credit" | "investment"` (optional). Consumed by Task 3 when auto-creating an account.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/extraction.test.ts`:

```ts
import { ExtractionResult } from "@/lib/llm/extraction";

describe("ExtractionResult account_type", () => {
  it("accepts a valid account_type", () => {
    const parsed = ExtractionResult.parse({
      account_summary: {
        period_start: "2026-04-01", period_end: "2026-04-30",
        currency: "USD", account_type: "credit",
      },
      transactions: [],
    });
    expect(parsed.account_summary.account_type).toBe("credit");
  });

  it("allows account_type to be absent", () => {
    const parsed = ExtractionResult.parse({
      account_summary: { period_start: "2026-04-01", period_end: "2026-04-30", currency: "USD" },
      transactions: [],
    });
    expect(parsed.account_summary.account_type).toBeUndefined();
  });

  it("rejects an invalid account_type", () => {
    expect(() =>
      ExtractionResult.parse({
        account_summary: {
          period_start: "2026-04-01", period_end: "2026-04-30",
          currency: "USD", account_type: "loan",
        },
        transactions: [],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/extraction.test.ts`
Expected: FAIL — the valid-`account_type` assertion gets `undefined` (Zod strips the unknown key) and/or the invalid case does not throw.

- [ ] **Step 3: Add the field to the Zod schema, JSON schema, and prompt**

In `lib/llm/extraction.ts`, add to the `account_summary` Zod object (after `last4`):

```ts
    account_type: z.enum(["checking", "savings", "credit", "investment"]).optional(),
```

Add to `JSON_SCHEMA.schema.properties.account_summary.properties` (after `last4`):

```ts
          account_type: { type: "string", enum: ["checking", "savings", "credit", "investment"] },
```

Append this bullet to `BASE_SYSTEM_PROMPT` (before the final "Include every transaction" line):

```
- Also return \`account_type\`: classify the statement's account as \`checking\`, \`savings\`, \`credit\` (a credit-card statement), or \`investment\`, based on the statement header and layout. Omit it only if genuinely unclear.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/extraction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/llm/extraction.ts tests/unit/extraction.test.ts
git commit -m "feat(extraction): classify account_type for auto-created accounts

Refs ARC-247"
```

---

### Task 2: `resolveAccount` matcher (pure function)

**Files:**
- Create: `lib/accounts/resolve-account.ts`
- Test: `tests/unit/resolve-account.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ExtractedAccount = { institution?: string | null; last4?: string | null };
  export type MatchableAccount = { id: string; institution: string | null; last4: string | null; createdAt: Date };
  export type AccountMatch =
    | { kind: "matched"; account: MatchableAccount }
    | { kind: "ambiguous"; account: MatchableAccount }
    | { kind: "none" };
  export function normalizeInstitution(name: string): string;
  export function resolveAccount(opts: { extracted: ExtractedAccount; accounts: MatchableAccount[] }): AccountMatch;
  ```
  Consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/resolve-account.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeInstitution, resolveAccount, type MatchableAccount } from "@/lib/accounts/resolve-account";

const d = (s: string) => new Date(s);
const acc = (over: Partial<MatchableAccount>): MatchableAccount => ({
  id: "a", institution: "Chase", last4: "1234", createdAt: d("2026-01-01"), ...over,
});

describe("normalizeInstitution", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(normalizeInstitution("American Express")).toBe("americanexpress");
    expect(normalizeInstitution("AMEX")).toBe("americanexpress");
    expect(normalizeInstitution("TD Bank, N.A.")).toBe("tdbank");
  });
});

describe("resolveAccount", () => {
  it("matches on normalized institution + exact last4", () => {
    const r = resolveAccount({
      extracted: { institution: "AMEX", last4: "9001" },
      accounts: [acc({ id: "x", institution: "American Express", last4: "9001" })],
    });
    expect(r).toEqual({ kind: "matched", account: expect.objectContaining({ id: "x" }) });
  });

  it("returns none when last4 differs", () => {
    const r = resolveAccount({
      extracted: { institution: "Chase", last4: "0000" },
      accounts: [acc({ id: "x", last4: "1234" })],
    });
    expect(r.kind).toBe("none");
  });

  it("returns none when extraction has no last4", () => {
    const r = resolveAccount({
      extracted: { institution: "Chase", last4: undefined },
      accounts: [acc({ id: "x" })],
    });
    expect(r.kind).toBe("none");
  });

  it("picks the most-recently-created on ambiguous match", () => {
    const r = resolveAccount({
      extracted: { institution: "Chase", last4: "1234" },
      accounts: [
        acc({ id: "old", createdAt: d("2026-01-01") }),
        acc({ id: "new", createdAt: d("2026-05-01") }),
      ],
    });
    expect(r).toEqual({ kind: "ambiguous", account: expect.objectContaining({ id: "new" }) });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/resolve-account.test.ts`
Expected: FAIL — `Cannot find module '@/lib/accounts/resolve-account'`.

- [ ] **Step 3: Implement**

Create `lib/accounts/resolve-account.ts`:

```ts
export type ExtractedAccount = { institution?: string | null; last4?: string | null };
export type MatchableAccount = { id: string; institution: string | null; last4: string | null; createdAt: Date };
export type AccountMatch =
  | { kind: "matched"; account: MatchableAccount }
  | { kind: "ambiguous"; account: MatchableAccount }
  | { kind: "none" };

// Common institution aliases collapse to a canonical token so "AMEX" matches
// "American Express". Keys and values are already normalized (lowercase, alnum).
const ALIASES: Record<string, string> = {
  amex: "americanexpress",
};

export function normalizeInstitution(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ALIASES[base] ?? base;
}

export function resolveAccount({
  extracted,
  accounts,
}: {
  extracted: ExtractedAccount;
  accounts: MatchableAccount[];
}): AccountMatch {
  if (!extracted.institution || !extracted.last4) return { kind: "none" };
  const wantInst = normalizeInstitution(extracted.institution);
  const wantLast4 = extracted.last4;

  const matches = accounts.filter(
    (a) => a.institution && a.last4 === wantLast4 && normalizeInstitution(a.institution) === wantInst,
  );
  if (matches.length === 0) return { kind: "none" };
  if (matches.length === 1) return { kind: "matched", account: matches[0] };

  const newest = matches.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  return { kind: "ambiguous", account: newest };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/resolve-account.test.ts`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add lib/accounts/resolve-account.ts tests/unit/resolve-account.test.ts
git commit -m "feat(accounts): resolveAccount matcher (institution + last4)

Refs ARC-247"
```

---

### Task 3: `ingestStatement` action (account-after-extraction + auto-create)

**Files:**
- Create: `lib/actions/ingest-statement.ts`
- Delete: `lib/actions/extract-statement.ts`
- Modify: `components/upload-statement-dialog.tsx` (update import + call to `ingestStatement`; this file is replaced in Task 6 but must compile now)
- Modify (rename import + calls `extractStatement` → `ingestStatement`): every test importing the old action. Find them with `rg -l "extract-statement" tests`.
- Create: `tests/integration/ingest-account-detection.test.ts`

**Interfaces:**
- Consumes: `resolveAccount` (Task 2), `ExtractionResult.account_summary.account_type` (Task 1), existing `extractFromPdf`, `resolveDirection`, `resolveCategory`, `reconcile`, `sha256Hex`, `putStatementPdf`.
- Produces:
  ```ts
  export type IngestResult = {
    statementId: string;
    duplicate: boolean;
    account: { id: string; name: string; autoCreated: boolean };
    needsReview: boolean;
    txnCount: number;
    reconciliation: { status: ReconciliationStatus; delta: number | null };
  };
  export async function ingestStatement(formData: FormData): Promise<IngestResult>;
  ```
  `financialAccountId` in the FormData is now OPTIONAL (present only on manual override). Consumed by Task 6.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/ingest-account-detection.test.ts` (mirror the env/mocks block from `tests/integration/extract-statement.test.ts`, but the LLM mock returns institution/last4/account_type):

```ts
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
    const all = await db.select().from(financialAccounts).where(eq(financialAccounts.userId, "u1"));
    expect(all.length).toBe(1);
  });

  it("short-circuits a duplicate PDF without re-extracting", async () => {
    await seed();
    const { ingestStatement } = await import("@/lib/actions/ingest-statement");
    const first = await ingestStatement(pdf("dup.pdf"));
    const second = await ingestStatement(pdf("dup.pdf"));
    expect(second.duplicate).toBe(true);
    expect(second.statementId).toBe(first.statementId);
  });
});
```

> Note: each `it` runs against the same container; if cross-test account leakage is a problem, the seed uses `onConflictDoNothing` and the "reuse" test asserts `length === 1` only after inserting its own account — run this file in isolation (`pnpm vitest run tests/integration/ingest-account-detection.test.ts`). If the reuse-count assertion proves flaky due to the auto-create test's account persisting, scope the count to `institution = "Amex"`; keep it simple first and adjust only if it fails.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/ingest-account-detection.test.ts`
Expected: FAIL — `Cannot find module '@/lib/actions/ingest-statement'`.

- [ ] **Step 3: Create `lib/actions/ingest-statement.ts`**

Full file:

```ts
"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { categories, categoryRules, financialAccounts, statements, transactions, users } from "@/lib/db/schema";
import { putStatementPdf } from "@/lib/storage/minio";
import { sha256Hex } from "@/lib/statements/hash";
import { extractFromPdf, resolveDirection } from "@/lib/llm/extraction";
import { resolveCategory } from "@/lib/categories/resolve";
import { resolveAccount } from "@/lib/accounts/resolve-account";
import { ALLOWED_MODEL_IDS, DEFAULT_MODEL, type ModelId } from "@/lib/llm/models";
import { reconcile, type ReconciliationStatus } from "@/lib/statements/reconcile";

const InputSchema = z.object({
  financialAccountId: z.string().uuid().optional(),
  modelOverride: z.string().optional(),
});

const MAX_BYTES = 10 * 1024 * 1024;

export type IngestResult = {
  statementId: string;
  duplicate: boolean;
  account: { id: string; name: string; autoCreated: boolean };
  needsReview: boolean;
  txnCount: number;
  reconciliation: { status: ReconciliationStatus; delta: number | null };
};

function autoCreateName(institution: string | undefined, last4: string | undefined, filename: string): string {
  if (institution && last4) return `${institution} ··${last4}`;
  if (institution) return institution;
  return filename.replace(/\.pdf$/i, "");
}

export async function ingestStatement(formData: FormData): Promise<IngestResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  const userId = session.user.id;

  const parsed = InputSchema.parse({
    financialAccountId: (formData.get("financialAccountId") as string) || undefined,
    modelOverride: (formData.get("modelOverride") as string) || undefined,
  });

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Missing file");
  if (file.type !== "application/pdf") throw new Error("Only PDF files are allowed");
  if (file.size > MAX_BYTES) throw new Error("File exceeds 10 MB");

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = sha256Hex(buffer);

  // Identical PDF already ingested? Return the existing statement with its
  // current account + reconciliation, no re-extraction (cost) or duplicate row.
  const [dup] = await db
    .select({
      id: statements.id,
      accountId: financialAccounts.id,
      accountName: financialAccounts.name,
      reconciliationStatus: statements.reconciliationStatus,
      reconciliationDelta: statements.reconciliationDelta,
    })
    .from(statements)
    .innerJoin(financialAccounts, eq(statements.financialAccountId, financialAccounts.id))
    .where(and(eq(statements.userId, userId), eq(statements.contentHash, contentHash), eq(statements.extractionStatus, "succeeded")))
    .limit(1);
  if (dup) {
    const [{ value: txnCount }] = await db
      .select({ value: count() })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.statementId, dup.id)));
    return {
      statementId: dup.id,
      duplicate: true,
      account: { id: dup.accountId, name: dup.accountName, autoCreated: false },
      needsReview: false,
      txnCount,
      reconciliation: {
        status: (dup.reconciliationStatus as ReconciliationStatus | null) ?? "not_available",
        delta: dup.reconciliationDelta == null ? null : Number(dup.reconciliationDelta),
      },
    };
  }

  const [me] = await db.select({ preferredModel: users.preferredModel }).from(users).where(eq(users.id, userId)).limit(1);
  const wanted = parsed.modelOverride ?? me?.preferredModel ?? DEFAULT_MODEL;
  if (!ALLOWED_MODEL_IDS.has(wanted as ModelId)) throw new Error("Model not allowed");
  const model = wanted as ModelId;

  const statementId = randomUUID();
  const stored = await putStatementPdf({ userId, statementId, body: buffer });

  const cats = await db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.userId, userId));
  const rules = await db
    .select({ keyword: categoryRules.keyword, categoryId: categoryRules.categoryId })
    .from(categoryRules)
    .where(eq(categoryRules.userId, userId))
    .orderBy(desc(categoryRules.createdAt));

  let result;
  try {
    result = await extractFromPdf({ pdf: buffer, model, filename: file.name, categoryNames: cats.map((c) => c.name) });
  } catch (err) {
    // Record the failure durably. We have no extracted institution/last4 here,
    // so attach it to the override account if supplied, else a per-user
    // "Unsorted" fallback (created lazily).
    const failAccountId = parsed.financialAccountId ?? (await getOrCreateUnsorted(userId)).id;
    await db.insert(statements).values({
      id: statementId, userId, financialAccountId: failAccountId,
      sourceFilename: file.name, storageBucket: stored.bucket, storageKey: stored.key,
      contentHash, modelUsed: model, extractionStatus: "failed",
      extractionError: `Extraction failed: ${(err as Error).message}`,
    });
    throw err;
  }

  // Resolve the account: manual override → matched → ambiguous → auto-create.
  let account: typeof financialAccounts.$inferSelect;
  let autoCreated = false;
  let needsReview = false;

  if (parsed.financialAccountId) {
    const [a] = await db.select().from(financialAccounts)
      .where(and(eq(financialAccounts.id, parsed.financialAccountId), eq(financialAccounts.userId, userId))).limit(1);
    if (!a) throw new Error("Account not found");
    account = a;
  } else {
    const accts = await db.select().from(financialAccounts).where(eq(financialAccounts.userId, userId));
    const match = resolveAccount({
      extracted: { institution: result.account_summary.institution, last4: result.account_summary.last4 },
      accounts: accts,
    });
    if (match.kind === "matched") {
      account = accts.find((a) => a.id === match.account.id)!;
    } else if (match.kind === "ambiguous") {
      account = accts.find((a) => a.id === match.account.id)!;
      needsReview = true;
    } else {
      const [created] = await db.insert(financialAccounts).values({
        userId,
        name: autoCreateName(result.account_summary.institution, result.account_summary.last4, file.name),
        kind: result.account_summary.account_type ?? "checking",
        institution: result.account_summary.institution ?? null,
        last4: result.account_summary.last4 ?? null,
        currency: result.account_summary.currency,
      }).returning();
      account = created;
      autoCreated = true;
    }
  }

  const rec = reconcile({
    kind: account.kind,
    opening: result.account_summary.opening_balance ?? null,
    closing: result.account_summary.closing_balance ?? null,
    amounts: result.transactions.map((t) => t.amount),
  });

  await db.transaction(async (tx) => {
    await tx.insert(statements).values({
      id: statementId, userId, financialAccountId: account.id,
      sourceFilename: file.name, storageBucket: stored.bucket, storageKey: stored.key,
      contentHash, modelUsed: model,
      periodStart: result.account_summary.period_start, periodEnd: result.account_summary.period_end,
      openingBalance: result.account_summary.opening_balance?.toFixed(2) ?? null,
      closingBalance: result.account_summary.closing_balance?.toFixed(2) ?? null,
      reconciliationStatus: rec.status,
      reconciliationDelta: rec.delta == null ? null : rec.delta.toFixed(2),
      extractionStatus: "succeeded", extractedAt: new Date(),
    });

    if (result.transactions.length > 0) {
      await tx.insert(transactions).values(
        result.transactions.map((t) => ({
          userId, financialAccountId: account.id, statementId,
          postedAt: t.posted_at, description: t.description, merchant: t.merchant ?? null,
          amount: t.amount.toFixed(2), direction: resolveDirection(t),
          currency: result.account_summary.currency,
          ...(() => {
            const r = resolveCategory({ description: t.description, suggestedLabel: t.suggested_category, rules, categories: cats });
            return { categoryId: r.categoryId, categorySource: r.source };
          })(),
          rawExtraction: t,
        })),
      ).onConflictDoNothing({
        target: [transactions.userId, transactions.financialAccountId, transactions.postedAt, transactions.amount, transactions.description],
      });
    }
  });

  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");

  return {
    statementId, duplicate: false,
    account: { id: account.id, name: account.name, autoCreated },
    needsReview, txnCount: result.transactions.length,
    reconciliation: { status: rec.status, delta: rec.delta },
  };
}

async function getOrCreateUnsorted(userId: string): Promise<typeof financialAccounts.$inferSelect> {
  const [existing] = await db.select().from(financialAccounts)
    .where(and(eq(financialAccounts.userId, userId), eq(financialAccounts.name, "Unsorted"))).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(financialAccounts).values({
    userId, name: "Unsorted", kind: "checking", currency: "USD",
  }).returning();
  return created;
}
```

- [ ] **Step 4: Delete the old action and update all importers**

```bash
git rm lib/actions/extract-statement.ts
```

In `components/upload-statement-dialog.tsx`: change the import to `import { ingestStatement } from "@/lib/actions/ingest-statement";` and the call from `await extractStatement(fd)` to `await ingestStatement(fd)`. (Destructuring `{ statementId, duplicate }` still works — extra fields are ignored.)

For each test file found by `rg -l "extract-statement" tests`, change the import path to `@/lib/actions/ingest-statement` and every `extractStatement(` call to `ingestStatement(`. Those tests pass `financialAccountId` explicitly, which is still accepted (now optional).

- [ ] **Step 5: Run the full ingest + existing extract suites**

Run: `pnpm vitest run tests/integration/ingest-account-detection.test.ts tests/integration/extract-statement.test.ts tests/integration/dedupe-upload.test.ts tests/integration/reconcile-extract.test.ts tests/integration/merchant-extract.test.ts tests/integration/category-rules-extract.test.ts`
Expected: PASS. Then `pnpm exec tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/ingest-statement.ts components/upload-statement-dialog.tsx tests/
git rm lib/actions/extract-statement.ts 2>/dev/null; true
git commit -m "feat(ingest): rename extractStatement→ingestStatement, resolve account after extraction

Account becomes optional; unmatched statements auto-create an account with the
extracted account_type. Extraction failures are recorded against the override
or a lazily-created Unsorted account.

Refs ARC-247"
```

---

### Task 4: `reassignStatementAccount` action

**Files:**
- Create: `lib/actions/reassign-statement-account.ts`
- Test: `tests/integration/reassign-statement-account.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function reassignStatementAccount(input: { statementId: string; accountId: string }):
    Promise<{ reconciliation: { status: ReconciliationStatus; delta: number | null } }>;
  ```
  Consumed by Task 6 (inline override).

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/reassign-statement-account.test.ts` (same env/mocks header as Task 3's test — copy the `beforeAll`/`afterAll`, and the `auth`/`next/headers`/`next/cache` mocks; NO extraction mock needed). Body:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/reassign-statement-account.test.ts`
Expected: FAIL — `Cannot find module '@/lib/actions/reassign-statement-account'`.

- [ ] **Step 3: Implement**

Create `lib/actions/reassign-statement-account.ts`:

```ts
"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { financialAccounts, statements, transactions } from "@/lib/db/schema";
import { reconcile, type ReconciliationStatus } from "@/lib/statements/reconcile";

const Input = z.object({ statementId: z.string().uuid(), accountId: z.string().uuid() });

export async function reassignStatementAccount(
  input: { statementId: string; accountId: string },
): Promise<{ reconciliation: { status: ReconciliationStatus; delta: number | null } }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  const userId = session.user.id;
  const { statementId, accountId } = Input.parse(input);

  const [stmt] = await db.select().from(statements)
    .where(and(eq(statements.id, statementId), eq(statements.userId, userId))).limit(1);
  if (!stmt) throw new Error("Statement not found");

  const [account] = await db.select().from(financialAccounts)
    .where(and(eq(financialAccounts.id, accountId), eq(financialAccounts.userId, userId))).limit(1);
  if (!account) throw new Error("Account not found");

  const txns = await db.select({ amount: transactions.amount }).from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.statementId, statementId)));

  const rec = reconcile({
    kind: account.kind,
    opening: stmt.openingBalance == null ? null : Number(stmt.openingBalance),
    closing: stmt.closingBalance == null ? null : Number(stmt.closingBalance),
    amounts: txns.map((t) => Number(t.amount)),
  });

  await db.transaction(async (tx) => {
    await tx.update(transactions).set({ financialAccountId: accountId })
      .where(and(eq(transactions.userId, userId), eq(transactions.statementId, statementId)));
    await tx.update(statements).set({
      financialAccountId: accountId,
      reconciliationStatus: rec.status,
      reconciliationDelta: rec.delta == null ? null : rec.delta.toFixed(2),
    }).where(and(eq(statements.id, statementId), eq(statements.userId, userId)));
  });

  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  return { reconciliation: { status: rec.status, delta: rec.delta } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/reassign-statement-account.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/reassign-statement-account.ts tests/integration/reassign-statement-account.test.ts
git commit -m "feat(ingest): reassignStatementAccount re-keys statement + txns and re-reconciles

Refs ARC-247"
```

---

### Task 5: Client orchestration utils (`runBatch` + `validateUploadFile`)

**Files:**
- Create: `lib/upload/run-batch.ts`
- Create: `lib/upload/validate-file.ts`
- Test: `tests/unit/run-batch.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // run-batch.ts
  export async function runBatch<T>(items: T[], worker: (item: T, index: number) => Promise<void>, opts: { concurrency: number }): Promise<void>;
  // validate-file.ts
  export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
  export function validateUploadFile(file: { type: string; size: number }): { ok: true } | { ok: false; error: string };
  ```
  Consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/run-batch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runBatch } from "@/lib/upload/run-batch";
import { validateUploadFile, MAX_UPLOAD_BYTES } from "@/lib/upload/validate-file";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runBatch", () => {
  it("never exceeds the concurrency cap", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await runBatch(items, async () => {
      active++;
      peak = Math.max(peak, active);
      await sleep(5);
      active--;
    }, { concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("runs every item even when one worker throws", async () => {
    const done: number[] = [];
    await runBatch([0, 1, 2], async (i) => {
      if (i === 1) throw new Error("boom");
      done.push(i);
    }, { concurrency: 2 });
    expect(done.sort()).toEqual([0, 2]);
  });
});

describe("validateUploadFile", () => {
  it("rejects non-PDF", () => {
    expect(validateUploadFile({ type: "image/png", size: 10 })).toEqual({ ok: false, error: "Only PDF files are allowed" });
  });
  it("rejects oversize", () => {
    expect(validateUploadFile({ type: "application/pdf", size: MAX_UPLOAD_BYTES + 1 })).toEqual({ ok: false, error: "File exceeds 10 MB" });
  });
  it("accepts a valid PDF", () => {
    expect(validateUploadFile({ type: "application/pdf", size: 100 })).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/run-batch.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Create `lib/upload/validate-file.ts`:

```ts
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function validateUploadFile(file: { type: string; size: number }): { ok: true } | { ok: false; error: string } {
  if (file.type !== "application/pdf") return { ok: false, error: "Only PDF files are allowed" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "File exceeds 10 MB" };
  return { ok: true };
}
```

Create `lib/upload/run-batch.ts`:

```ts
/**
 * Runs `worker` over `items` with at most `concurrency` in flight at once.
 * A worker that rejects is swallowed so one failure never stops the batch —
 * workers report their own success/failure via side effects (status updates).
 */
export async function runBatch<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  opts: { concurrency: number },
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(opts.concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        await worker(items[i], i);
      } catch {
        // worker owns its own error reporting
      }
    }
  });
  await Promise.all(runners);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/run-batch.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add lib/upload/ tests/unit/run-batch.test.ts
git commit -m "feat(upload): concurrency-limited runBatch + validateUploadFile

Refs ARC-247"
```

---

### Task 6: Bulk upload dialog + wiring

**Files:**
- Create: `components/bulk-upload-dialog.tsx`
- Delete: `components/upload-statement-dialog.tsx`
- Modify: `components/app-sidebar.tsx` (swap the dialog; add `kind`/`last4` to the accounts prop so the override dropdown can label rows — minimal: keep existing `{id,name,institution}` shape, that's enough for the dropdown)

**Interfaces:**
- Consumes: `ingestStatement`/`IngestResult` (Task 3), `reassignStatementAccount` (Task 4), `runBatch`/`validateUploadFile` (Task 5).

- [ ] **Step 1: Implement the dialog**

Create `components/bulk-upload-dialog.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ingestStatement, type IngestResult } from "@/lib/actions/ingest-statement";
import { reassignStatementAccount } from "@/lib/actions/reassign-statement-account";
import { runBatch } from "@/lib/upload/run-batch";
import { validateUploadFile } from "@/lib/upload/validate-file";

type Account = { id: string; name: string; institution: string | null };
type Status = "queued" | "uploading" | "extracting" | "done" | "duplicate" | "error";
type Item = { id: string; file: File; status: Status; error?: string; result?: IngestResult };

const CONCURRENCY = 3;

const labels: Record<Status, string> = {
  queued: "Queued", uploading: "Uploading", extracting: "Extracting",
  done: "Done", duplicate: "Already uploaded", error: "Failed",
};

export function BulkUploadDialog({
  accounts: initialAccounts,
  trigger,
}: {
  accounts: Account[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [running, setRunning] = useState(false);
  const [, startReassign] = useTransition();
  const router = useRouter();

  function patch(id: string, next: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...next } : it)));
  }

  function addFiles(files: FileList | null) {
    if (!files) return;
    const added: Item[] = Array.from(files).map((file) => {
      const v = validateUploadFile(file);
      return {
        id: crypto.randomUUID(), file,
        status: v.ok ? "queued" : "error",
        error: v.ok ? undefined : v.error,
      };
    });
    setItems((prev) => [...prev, ...added]);
  }

  async function start() {
    setRunning(true);
    const queued = items.filter((it) => it.status === "queued");
    await runBatch(queued, async (it) => {
      patch(it.id, { status: "uploading" });
      const fd = new FormData();
      fd.append("file", it.file);
      patch(it.id, { status: "extracting" });
      try {
        const res = await ingestStatement(fd);
        patch(it.id, { status: res.duplicate ? "duplicate" : "done", result: res });
        if (res.account.autoCreated) {
          setAccounts((prev) =>
            prev.some((a) => a.id === res.account.id)
              ? prev
              : [...prev, { id: res.account.id, name: res.account.name, institution: null }]);
        }
      } catch (e) {
        patch(it.id, { status: "error", error: (e as Error).message });
      }
    }, { concurrency: CONCURRENCY });
    setRunning(false);
    router.refresh();
  }

  function reassign(it: Item, accountId: string) {
    if (!it.result) return;
    const acct = accounts.find((a) => a.id === accountId);
    startReassign(async () => {
      try {
        await reassignStatementAccount({ statementId: it.result!.statementId, accountId });
        patch(it.id, {
          result: { ...it.result!, account: { id: accountId, name: acct?.name ?? "", autoCreated: false }, needsReview: false },
        });
        toast.success(`Moved to ${acct?.name ?? "account"}`);
        router.refresh();
      } catch (e) {
        toast.error("Could not move statement", { description: (e as Error).message });
      }
    });
  }

  const summary = {
    done: items.filter((i) => i.status === "done").length,
    duplicate: items.filter((i) => i.status === "duplicate").length,
    error: items.filter((i) => i.status === "error").length,
  };
  const hasQueued = items.some((i) => i.status === "queued");

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setItems([]); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Upload statements</DialogTitle></DialogHeader>

        <div className="grid gap-3">
          <Input
            type="file" accept="application/pdf" multiple
            onChange={(e) => addFiles(e.target.files)}
            disabled={running}
          />
          <p className="text-xs text-muted-foreground">
            Drop multiple PDFs. The account is detected from each statement; review and override below.
          </p>

          {items.length > 0 && (
            <ul className="max-h-80 divide-y overflow-y-auto rounded border text-sm">
              {items.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-3 p-2">
                  <span className="min-w-0 flex-1 truncate" title={it.file.name}>{it.file.name}</span>
                  <span className={`shrink-0 text-xs ${it.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                    {it.error ? `${labels[it.status]}: ${it.error}` : labels[it.status]}
                  </span>
                  {(it.status === "done" || it.status === "duplicate") && it.result && (
                    <Select value={it.result.account.id} onValueChange={(v) => reassign(it, v)}>
                      <SelectTrigger className="h-7 w-44 shrink-0 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </li>
              ))}
            </ul>
          )}

          {(summary.done + summary.duplicate + summary.error) > 0 && (
            <p className="text-xs text-muted-foreground">
              {summary.done} done · {summary.duplicate} already uploaded · {summary.error} failed
            </p>
          )}
        </div>

        <DialogFooter>
          <Button onClick={start} disabled={running || !hasQueued}>
            {running ? "Processing…" : `Upload ${items.filter((i) => i.status === "queued").length || ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire into the sidebar and remove the old dialog**

In `components/app-sidebar.tsx`: replace the `UploadStatementDialog` import with `import { BulkUploadDialog } from "@/components/bulk-upload-dialog";`, and replace its usage:

```tsx
        <BulkUploadDialog
          accounts={accounts}
          trigger={<Button size="sm" className="w-full">Upload statements</Button>}
        />
```

(The `preferredModel` prop is no longer needed by the dialog; leave the sidebar's other props untouched.)

```bash
git rm components/upload-statement-dialog.tsx
```

- [ ] **Step 3: Verify build + types + full suite**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

Run: `pnpm vitest run`
Expected: all PASS.

- [ ] **Step 4: Manual verification**

Run `pnpm dev` and, signed in:
1. Open "Upload statements", select 3–5 PDFs at once.
2. Confirm each row transitions `queued → extracting → done/duplicate`, no more than 3 active at once.
3. Confirm a statement with an unknown account auto-creates one (visible in the row's dropdown and on `/accounts`).
4. Override one row's account via the dropdown; confirm the toast and that `/transactions` shows the moved rows under the new account.
5. Add a non-PDF — confirm it shows `Failed: Only PDF files are allowed` and is never uploaded.
6. Re-upload an already-ingested PDF — confirm `Already uploaded`.

- [ ] **Step 5: Commit**

```bash
git add components/bulk-upload-dialog.tsx components/app-sidebar.tsx
git rm components/upload-statement-dialog.tsx 2>/dev/null; true
git commit -m "feat(upload): bulk upload dialog with per-file status + account override

Refs ARC-247"
```

---

## Self-Review

**Spec coverage:**
- Bulk dialog + drag-drop/multi-select + per-file status + inline override → Task 6. ✓
- Concurrency-limited runner (cap 3) → Task 5 (`runBatch`) + Task 6 (wiring). ✓
- Account optional + reordered pipeline + match/ambiguous/auto-create → Task 3. ✓
- `account_type` in extraction → Task 1. ✓
- `resolveAccount` (normalization, exact last4, ambiguous→most-recent, missing last4→none) → Task 2. ✓
- `reassignStatementAccount` (re-key + re-reconcile, asset vs credit) → Task 4. ✓
- Dedup short-circuit preserved → Task 3 (test + code). ✓
- Failure persistence via override or "Unsorted" fallback → Task 3. ✓
- Client + server validation → Task 5 (`validateUploadFile`) + Task 3 (server checks). ✓
- Auto-created naming `"<institution> ··<last4>"` w/ filename fallback → Task 3 (`autoCreateName`). ✓

**Type consistency:** `IngestResult` (Task 3) is the shape Task 6 consumes; `resolveAccount`/`AccountMatch`/`MatchableAccount` (Task 2) match the call in Task 3; `reconcile`/`ReconciliationStatus` reused from existing `lib/statements/reconcile.ts`; `runBatch`/`validateUploadFile` signatures (Task 5) match Task 6 usage. ✓

**Known limitation (documented in spec):** two files in one batch that both auto-create the *same* new account can race (concurrency 3) and create two accounts; user merges later. Not solved in v1.
