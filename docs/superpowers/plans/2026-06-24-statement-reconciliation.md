# Statement Balance Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile each statement extraction against its stated opening/closing balances and flag (non-blocking) when transactions don't tie out.

**Architecture:** A pure `reconcile()` function computes a status + delta from the account kind, extracted balances, and signed transaction amounts. Extraction is extended to capture opening/closing balances. Both server actions persist the result onto `statements`; the statement detail page renders a banner. Reconciliation status is independent of `extractionStatus` and never blocks import.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM + Postgres, Zod, OpenRouter (OpenAI-compatible SDK), Vitest + Testcontainers.

## Global Constraints

- Tie-out is **exact to the cent** — `delta === 0` → `reconciled`, else `discrepancy`. Compute in integer cents to avoid float noise.
- Reconciliation identity: asset (`checking`, `savings`) → `expected_closing = opening + Σ(amounts)`; `credit` → `expected_closing = opening − Σ(amounts)`. `amounts` are signed (outflows negative, inflows positive).
- `investment` → `not_applicable`. Missing opening or closing balance → `not_available`.
- Asset vs. liability is derived from `financialAccounts.kind` — never guessed by the model.
- `reconciliationStatus` is a separate column from `extractionStatus`. Import of transactions is never blocked by reconciliation.
- Status enum values, verbatim: `reconciled | discrepancy | not_available | not_applicable`.
- New numeric columns are `numeric(14, 2)` (Drizzle returns/accepts these as strings).
- One statement = one currency (`account_summary.currency`); no cross-currency math.

---

### Task 1: Pure `reconcile()` function

**Files:**
- Create: `lib/statements/reconcile.ts`
- Test: `tests/unit/reconcile.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no imports).
- Produces:
  - `type ReconciliationStatus = "reconciled" | "discrepancy" | "not_available" | "not_applicable"`
  - `type AccountKind = "checking" | "savings" | "credit" | "investment"`
  - `reconcile(input: { kind: AccountKind; opening: number | null; closing: number | null; amounts: number[] }): { status: ReconciliationStatus; delta: number | null }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/reconcile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reconcile } from "@/lib/statements/reconcile";

describe("reconcile", () => {
  it("reconciles an asset account that ties out", () => {
    expect(reconcile({ kind: "checking", opening: 100, closing: 150, amounts: [70, -20] }))
      .toEqual({ status: "reconciled", delta: 0 });
  });

  it("flags an asset discrepancy with a signed delta", () => {
    expect(reconcile({ kind: "savings", opening: 100, closing: 151, amounts: [70, -20] }))
      .toEqual({ status: "discrepancy", delta: 1 });
  });

  it("reconciles a credit account that ties out", () => {
    expect(reconcile({ kind: "credit", opening: 812.3, closing: 1208.85, amounts: [-789.55, 393] }))
      .toEqual({ status: "reconciled", delta: 0 });
  });

  it("flags a credit discrepancy (worked example)", () => {
    expect(reconcile({ kind: "credit", opening: 812.3, closing: 1204.55, amounts: [-789.55, 393] }))
      .toEqual({ status: "discrepancy", delta: -4.3 });
  });

  it("returns not_available when a balance is missing", () => {
    expect(reconcile({ kind: "checking", opening: null, closing: 150, amounts: [10] }))
      .toEqual({ status: "not_available", delta: null });
    expect(reconcile({ kind: "checking", opening: 0, closing: null, amounts: [10] }))
      .toEqual({ status: "not_available", delta: null });
  });

  it("returns not_applicable for investment accounts", () => {
    expect(reconcile({ kind: "investment", opening: 1000, closing: 1100, amounts: [50] }))
      .toEqual({ status: "not_applicable", delta: null });
  });

  it("is immune to floating-point noise", () => {
    expect(reconcile({ kind: "checking", opening: 0, closing: 0.3, amounts: [0.1, 0.2] }))
      .toEqual({ status: "reconciled", delta: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/reconcile.test.ts`
Expected: FAIL — `Cannot find package '@/lib/statements/reconcile'` (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `lib/statements/reconcile.ts`:

```ts
export type AccountKind = "checking" | "savings" | "credit" | "investment";

export type ReconciliationStatus =
  | "reconciled"
  | "discrepancy"
  | "not_available"
  | "not_applicable";

export type ReconcileInput = {
  kind: AccountKind;
  opening: number | null;
  closing: number | null;
  amounts: number[];
};

export type ReconcileResult = {
  status: ReconciliationStatus;
  delta: number | null;
};

const cents = (n: number): number => Math.round(n * 100);

/**
 * Verifies extracted transactions tie out to the statement's stated balances.
 * Asset accounts: closing = opening + Σ(amounts). Credit (liability): closing =
 * opening − Σ(amounts). Computed in integer cents; exact-to-the-cent tie-out.
 */
export function reconcile(input: ReconcileInput): ReconcileResult {
  if (input.kind === "investment") return { status: "not_applicable", delta: null };
  if (input.opening == null || input.closing == null) {
    return { status: "not_available", delta: null };
  }

  const sumCents = input.amounts.reduce((acc, a) => acc + cents(a), 0);
  const expectedCents =
    input.kind === "credit"
      ? cents(input.opening) - sumCents
      : cents(input.opening) + sumCents;
  const deltaCents = cents(input.closing) - expectedCents;

  return {
    status: deltaCents === 0 ? "reconciled" : "discrepancy",
    delta: deltaCents / 100,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/reconcile.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/statements/reconcile.ts tests/unit/reconcile.test.ts
git commit -m "feat(reconcile): pure balance-reconciliation function

Refs ARC-240"
```

---

### Task 2: Schema columns + migration

**Files:**
- Modify: `lib/db/schema.ts` (the `statements` table)
- Create: `drizzle/0003_*.sql` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: `statements.openingBalance`, `statements.closingBalance` (string | null), `statements.reconciliationStatus` (`ReconciliationStatus` | null), `statements.reconciliationDelta` (string | null).

- [ ] **Step 1: Add the columns**

In `lib/db/schema.ts`, inside the `statements` table object, add these four columns immediately after the `contentHash: text("content_hash"),` line:

```ts
    openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }),
    closingBalance: numeric("closing_balance", { precision: 14, scale: 2 }),
    reconciliationStatus: text("reconciliation_status", {
      enum: ["reconciled", "discrepancy", "not_available", "not_applicable"],
    }),
    reconciliationDelta: numeric("reconciliation_delta", { precision: 14, scale: 2 }),
```

(`numeric` and `text` are already imported in this file.)

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: prints `Your SQL migration file ➜ drizzle/0003_*.sql`.

- [ ] **Step 3: Verify the migration SQL**

Run: `git status --porcelain drizzle`
Expected: a new `drizzle/0003_*.sql` and `drizzle/meta/0003_snapshot.json`, plus modified `drizzle/meta/_journal.json`. Open the `.sql` and confirm it only `ALTER TABLE "statements" ADD COLUMN` for the four new columns (no drops, no changes to other tables).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat(db): add reconciliation columns to statements

Refs ARC-240"
```

---

### Task 3: Extract opening/closing balances

**Files:**
- Modify: `lib/llm/extraction.ts`
- Test: `tests/unit/extraction.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ExtractionResult.account_summary.opening_balance?: number`, `ExtractionResult.account_summary.closing_balance?: number`.

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe("ExtractionResult schema", ...)` block in `tests/unit/extraction.test.ts`:

```ts
  it("captures optional opening and closing balances", () => {
    const parsed = ExtractionResult.parse({
      account_summary: {
        period_start: "2026-04-01",
        period_end: "2026-04-30",
        currency: "CAD",
        opening_balance: 812.3,
        closing_balance: 1204.55,
      },
      transactions: [],
    });
    expect(parsed.account_summary.opening_balance).toBe(812.3);
    expect(parsed.account_summary.closing_balance).toBe(1204.55);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/extraction.test.ts -t "opening and closing"`
Expected: FAIL — `opening_balance` is `undefined` (Zod strips unknown keys), so `expect(...).toBe(812.3)` fails.

- [ ] **Step 3: Extend the Zod schema, JSON schema, and prompt**

In `lib/llm/extraction.ts`:

(a) In the `ExtractionResult` Zod object, add the two fields to `account_summary`, after `currency: z.string().length(3),`:

```ts
    opening_balance: z.number().finite().optional(),
    closing_balance: z.number().finite().optional(),
```

(b) In the `JSON_SCHEMA.schema.properties.account_summary.properties` object, add (after the `currency` property):

```ts
          opening_balance: { type: "number" },
          closing_balance: { type: "number" },
```

(c) Append two bullet lines to `SYSTEM_PROMPT`, just before the final `- Include every transaction...` line:

```
- Report the statement's stated opening/previous balance as `opening_balance` and the closing/new balance as `closing_balance`, as printed. For credit-card statements these are the previous balance and the new balance owed. Omit them only if the statement does not show them.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/extraction.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add lib/llm/extraction.ts tests/unit/extraction.test.ts
git commit -m "feat(extraction): capture opening/closing balances

Refs ARC-240"
```

---

### Task 4: Persist reconciliation in both actions

**Files:**
- Modify: `lib/actions/extract-statement.ts:125-134` (the `tx.update(statements)` in the success transaction)
- Modify: `lib/actions/reprocess-statement.ts` (the `tx.update(statements)` block; add an account-kind fetch)
- Test: `tests/integration/reconcile-extract.test.ts`

**Interfaces:**
- Consumes: `reconcile` from `@/lib/statements/reconcile`; `ExtractionResult.account_summary.opening_balance/closing_balance` (Task 3); `statements.openingBalance/closingBalance/reconciliationStatus/reconciliationDelta` (Task 2).
- Produces: statements rows with reconciliation fields populated after extraction.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/reconcile-extract.test.ts`:

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

const summary = (opening: number, closing: number) => ({
  account_summary: {
    period_start: "2024-12-01", period_end: "2024-12-31", currency: "CAD",
    opening_balance: opening, closing_balance: closing,
  },
  transactions: [
    { posted_at: "2024-12-05", description: "Purchase", amount: -789.55, suggested_category: "Shopping", direction: "outflow" as const },
    { posted_at: "2024-12-20", description: "Payment", amount: 393.0, suggested_category: "Transfers", direction: "transfer" as const },
  ],
});

async function upload(accountId: string, bytes: string) {
  const { extractStatement } = await import("@/lib/actions/extract-statement");
  const fd = new FormData();
  fd.append("financialAccountId", accountId);
  fd.append("file", new File([Buffer.from(bytes)], "s.pdf", { type: "application/pdf" }));
  try { await extractStatement(fd); } catch (e) {
    if (!/REDIRECT:/.test((e as Error).message)) throw e;
  }
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
    extractMock.mockResolvedValueOnce(summary(812.3, 1208.85));
    await upload(acc.id, "%PDF-1.4 TIES-OUT");
    const [ok] = await db.select().from(statements);
    expect(ok.reconciliationStatus).toBe("reconciled");
    expect(ok.reconciliationDelta).toBe("0.00");
    expect(ok.openingBalance).toBe("812.30");

    extractMock.mockResolvedValueOnce(summary(812.3, 1204.55));
    await upload(acc.id, "%PDF-1.4 OFF-BY");
    const offRows = await db.select().from(statements);
    const off = offRows.find((s) => s.id !== ok.id)!;
    expect(off.reconciliationStatus).toBe("discrepancy");
    expect(off.reconciliationDelta).toBe("-4.30");

    // transactions still imported for the discrepant statement
    const offTxns = await db.select().from(transactions).where(eq(transactions.statementId, off.id));
    expect(offTxns.length).toBe(2);
  }, 90_000);
});
```

Add the missing import at the top of the test file (Drizzle `eq`):

```ts
import { eq } from "drizzle-orm";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/reconcile-extract.test.ts`
Expected: FAIL — `ok.reconciliationStatus` is `null` (wiring not implemented yet).

- [ ] **Step 3: Wire reconciliation into `extractStatement`**

In `lib/actions/extract-statement.ts`:

(a) Add imports near the other `@/lib` imports:

```ts
import { reconcile } from "@/lib/statements/reconcile";
```

(b) Replace the `tx.update(statements).set({...})` call inside the `db.transaction` block (currently setting `periodStart`/`periodEnd`/`extractionStatus`/`extractedAt`) with one that also writes the reconciliation fields. Insert this computation just before `await db.transaction(async (tx) => {`:

```ts
  const rec = reconcile({
    kind: account.kind,
    opening: result.account_summary.opening_balance ?? null,
    closing: result.account_summary.closing_balance ?? null,
    amounts: result.transactions.map((t) => t.amount),
  });
```

Then change the `tx.update(statements).set({...})` to:

```ts
      .set({
        periodStart: result.account_summary.period_start,
        periodEnd: result.account_summary.period_end,
        openingBalance: result.account_summary.opening_balance?.toFixed(2) ?? null,
        closingBalance: result.account_summary.closing_balance?.toFixed(2) ?? null,
        reconciliationStatus: rec.status,
        reconciliationDelta: rec.delta == null ? null : rec.delta.toFixed(2),
        extractionStatus: "succeeded",
        extractedAt: new Date(),
      })
```

(`account.kind` is available — `account` is the row fetched earlier in the action.)

- [ ] **Step 4: Wire reconciliation into `reprocessStatement`**

In `lib/actions/reprocess-statement.ts`:

(a) Add imports:

```ts
import { financialAccounts } from "@/lib/db/schema";
import { reconcile } from "@/lib/statements/reconcile";
```

(`statements`, `transactions`, `categories` are already imported; add `financialAccounts` to the existing schema import instead of duplicating if they share one import line.)

(b) After the statement `s` is fetched and before the `db.transaction` block, fetch the account kind and compute reconciliation:

```ts
  const [acct] = await db
    .select({ kind: financialAccounts.kind })
    .from(financialAccounts)
    .where(eq(financialAccounts.id, s.financialAccountId))
    .limit(1);

  const rec = reconcile({
    kind: acct.kind,
    opening: result.account_summary.opening_balance ?? null,
    closing: result.account_summary.closing_balance ?? null,
    amounts: result.transactions.map((t) => t.amount),
  });
```

(c) In the `tx.update(statements).set({...})` call inside the transaction, add these fields alongside the existing ones (`modelUsed`, `periodStart`, `periodEnd`, `extractionStatus`, `extractionError`, `extractedAt`):

```ts
        openingBalance: result.account_summary.opening_balance?.toFixed(2) ?? null,
        closingBalance: result.account_summary.closing_balance?.toFixed(2) ?? null,
        reconciliationStatus: rec.status,
        reconciliationDelta: rec.delta == null ? null : rec.delta.toFixed(2),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/integration/reconcile-extract.test.ts tests/integration/extract-statement.test.ts`
Expected: PASS (reconciliation test + the existing extract test still green).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/actions/extract-statement.ts lib/actions/reprocess-statement.ts tests/integration/reconcile-extract.test.ts
git commit -m "feat(reconcile): compute and persist reconciliation on extract/reprocess

Refs ARC-240"
```

---

### Task 5: Reconciliation banner on the statement page

**Files:**
- Modify: `app/(app)/statements/[id]/page.tsx`

**Interfaces:**
- Consumes: `statements.reconciliationStatus/openingBalance/closingBalance/reconciliationDelta` (Task 2, 4); `formatCurrency` from `@/lib/format/currency` (ARC-239); `acc.currency`.
- Produces: a visible banner/badge. No new exports.

- [ ] **Step 1: Add the banner**

In `app/(app)/statements/[id]/page.tsx`:

(a) Add the import near the other `@/lib` imports:

```ts
import { formatCurrency } from "@/lib/format/currency";
```

(b) The page already fetches `s` (statement) and `acc` (financial account). Just before the existing `{s.extractionStatus === "failed" && ...}` block in the returned JSX, insert this reconciliation banner:

```tsx
      {s.reconciliationStatus === "discrepancy" && s.closingBalance && s.reconciliationDelta && (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          This statement may be incomplete. Expected closing balance{" "}
          {formatCurrency(
            Number(s.closingBalance) - Number(s.reconciliationDelta),
            acc?.currency ?? "USD",
          )}
          , but the statement shows {formatCurrency(s.closingBalance, acc?.currency ?? "USD")} (off by{" "}
          {formatCurrency(s.reconciliationDelta, acc?.currency ?? "USD")}).
        </p>
      )}
      {s.reconciliationStatus === "reconciled" && (
        <p className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
          Balanced ✓ — transactions tie out to the statement balances.
        </p>
      )}
      {s.reconciliationStatus === "not_available" && (
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t verify completeness — balances weren&apos;t found on the statement.
        </p>
      )}
```

(`formatCurrency` takes `string | number`; `s.closingBalance` and `s.reconciliationDelta` are strings, `Number(...) - Number(...)` is a number — all accepted. `not_applicable` and `null` render nothing.)

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint "app/(app)/statements/[id]/page.tsx"`
Expected: both clean.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS (all files).

- [ ] **Step 4: Manual verification**

Start the dev server (`pnpm dev`), upload a statement whose balances tie out → green "Balanced ✓"; one that doesn't → amber discrepancy banner with the expected vs. stated figures; transactions appear in both cases.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/statements/[id]/page.tsx"
git commit -m "feat(reconcile): show reconciliation banner on statement page

Refs ARC-240"
```

---

## Self-Review Notes

- **Spec coverage:** data model → Task 2; extraction schema/prompt → Task 3; `reconcile()` logic → Task 1; wiring in both actions → Task 4; UI statuses (`discrepancy`/`reconciled`/`not_available`, `not_applicable` renders nothing) → Task 5; testing (unit + integration with import-not-blocked assertion) → Tasks 1, 4. Out-of-scope items intentionally have no tasks.
- **Type consistency:** `reconcile` signature and `ReconciliationStatus` values are identical across Tasks 1, 4; enum column values in Task 2 match. Numeric columns are strings (`toFixed(2)` on write, `"0.00"`/`"-4.30"` on read), reflected in the Task 4 assertions.
