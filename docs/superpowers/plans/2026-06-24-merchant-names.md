# Simplified Merchant Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a short LLM-derived merchant name per transaction, show it as the primary label (raw description as subtitle), and backfill existing rows.

**Architecture:** Additive `transactions.merchant` (nullable). Extraction returns an optional `merchant` per row; both server actions persist `merchant ?? null`. The table renders `merchant ?? description` with the raw description as a muted subtitle. A one-off dry-run-first script backfills existing rows via a cheap batched LLM call.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM + Postgres, Zod, OpenRouter (OpenAI-compatible SDK), shadcn/ui, Vitest + Testcontainers.

## Global Constraints

- `merchant` is **read-only** in v1 (no edit UI, no manual-source tracking).
- `transactions.merchant` is `text`, **nullable**; `null` means "show the raw description".
- `merchant` is additive — it must NOT change direction, reconciliation, dedup (the unique key is unchanged), or category resolution.
- Display: primary line = `merchant ?? description`; raw `description` shown as a muted subtitle only when `merchant` is non-null.
- Backfill script is **dry-run by default**; `--apply` writes; idempotent (`merchant IS NULL` only).
- This branch is stacked on ARC-245 — `components/transactions-table.tsx` is the redesigned ("quiet ledger") version; edit that, do not reintroduce the Direction column.

---

### Task 1: Schema — `transactions.merchant`

**Files:**
- Modify: `lib/db/schema.ts` (the `transactions` table)
- Create: `drizzle/0005_*.sql` (generated)

**Interfaces:**
- Produces: `transactions.merchant` (`string | null`).

- [ ] **Step 1: Add the column**

In `lib/db/schema.ts`, inside the `transactions` table columns object, add (immediately after the `categorySource: ...` line):

```ts
    merchant: text("merchant"),
```

(`text` is already imported.)

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: prints `drizzle/0005_*.sql`.

- [ ] **Step 3: Verify the migration**

Open `drizzle/0005_*.sql`. Confirm it is exactly `ALTER TABLE "transactions" ADD COLUMN "merchant" text;` (nullable, no default, no other table changes).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat(db): add transactions.merchant

Refs ARC-246"
```

---

### Task 2: Extraction — capture and persist `merchant`

**Files:**
- Modify: `lib/llm/extraction.ts`
- Modify: `lib/actions/extract-statement.ts`, `lib/actions/reprocess-statement.ts`
- Test: `tests/unit/extraction.test.ts`, `tests/integration/merchant-extract.test.ts`

**Interfaces:**
- Consumes: `transactions.merchant` (Task 1).
- Produces: `ExtractionResult.transactions[].merchant?: string`; inserted rows carry `merchant`.

- [ ] **Step 1: Write the failing unit test**

Add inside the `describe("ExtractionResult schema", ...)` block in `tests/unit/extraction.test.ts`:

```ts
  it("captures an optional merchant and tolerates its absence", () => {
    const parsed = ExtractionResult.parse({
      account_summary: { period_start: "2026-04-01", period_end: "2026-04-30", currency: "CAD" },
      transactions: [
        { posted_at: "2026-04-03", description: "AMZN MKTP CA*ZX1 WWW.AMAZON.CA", amount: -42.17, suggested_category: "Shopping", merchant: "Amazon" },
        { posted_at: "2026-04-04", description: "UNKNOWN THING", amount: -1.0, suggested_category: "Other" },
      ],
    });
    expect(parsed.transactions[0].merchant).toBe("Amazon");
    expect(parsed.transactions[1].merchant).toBeUndefined();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/extraction.test.ts -t "merchant"`
Expected: FAIL — `merchant` is `undefined` for row 0 (Zod strips unknown keys).

- [ ] **Step 3: Extend schema + prompt**

In `lib/llm/extraction.ts`:

(a) In the `ExtractionResult` transactions item object, add after `direction: ...`:

```ts
      merchant: z.string().min(1).optional(),
```

(b) In `JSON_SCHEMA.schema.properties.transactions.items.properties`, add (alongside the other per-transaction properties, NOT in that object's `required` array):

```ts
            merchant: { type: "string" },
```

(c) In `BASE_SYSTEM_PROMPT`, add a bullet just before the final `- Include every transaction...` line:

```
- Also return \`merchant\`: a short, human-friendly business or brand name for the transaction (e.g. "Amazon", "A&W", "Spotify", "Interest charge"). Strip store numbers, URLs, cities and province codes. Omit it only when no sensible name can be derived.
```

- [ ] **Step 4: Run unit test to verify it passes**

Run: `npx vitest run tests/unit/extraction.test.ts`
Expected: PASS.

- [ ] **Step 5: Persist in both actions**

In `lib/actions/extract-statement.ts`, in the `transactions` insert `.values(result.transactions.map((t) => ({ ... })))`, add this line (e.g. right after `description: t.description,`):

```ts
            merchant: t.merchant ?? null,
```

In `lib/actions/reprocess-statement.ts`, make the identical addition in its insert map (after `description: t.description,`).

- [ ] **Step 6: Write the failing integration test**

Create `tests/integration/merchant-extract.test.ts`:

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

vi.mock("@/lib/llm/extraction", async (orig) => {
  const real = await orig<typeof import("@/lib/llm/extraction")>();
  return {
    ...real,
    extractFromPdf: vi.fn(async () => ({
      account_summary: { period_start: "2026-04-01", period_end: "2026-04-30", currency: "USD" },
      transactions: [
        { posted_at: "2026-04-03", description: "AMZN MKTP CA*ZX1 WWW.AMAZON.CA", amount: -42.17, suggested_category: "Shopping", direction: "outflow", merchant: "Amazon" },
        { posted_at: "2026-04-04", description: "MYSTERY CHARGE", amount: -9.99, suggested_category: "Other", direction: "outflow" },
      ],
    })),
  };
});

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: "u1", name: "T", email: "t@x" } })) } },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

describe("extract persists merchant", () => {
  it("stores the merchant when present and null when absent", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, categories, transactions } = await import("@/lib/db/schema");
    await db.insert(users).values({ id: "u1", name: "T", email: "t@x" });
    const [acc] = await db.insert(financialAccounts)
      .values({ userId: "u1", name: "Visa", kind: "credit", currency: "USD" }).returning();
    await db.insert(categories).values([
      { userId: "u1", name: "Shopping", isSystem: true },
      { userId: "u1", name: "Other", isSystem: true },
      { userId: "u1", name: "Uncategorized", isSystem: true },
    ]);

    const { extractStatement } = await import("@/lib/actions/extract-statement");
    const fd = new FormData();
    fd.append("financialAccountId", acc.id);
    fd.append("file", new File([Buffer.from("%PDF-1.4 x")], "s.pdf", { type: "application/pdf" }));
    const res = await extractStatement(fd);
    expect(res.duplicate).toBe(false);

    const rows = await db.select().from(transactions);
    const amazon = rows.find((r) => r.description.includes("AMZN"))!;
    const mystery = rows.find((r) => r.description.includes("MYSTERY"))!;
    expect(amazon.merchant).toBe("Amazon");
    expect(mystery.merchant).toBeNull();
  }, 90_000);
});
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run tests/integration/merchant-extract.test.ts tests/unit/extraction.test.ts && npx tsc --noEmit`
Expected: PASS + clean. (Docker is running; first container run is slow — allow a few minutes.)

- [ ] **Step 8: Commit**

```bash
git add lib/llm/extraction.ts lib/actions/extract-statement.ts lib/actions/reprocess-statement.ts tests/unit/extraction.test.ts tests/integration/merchant-extract.test.ts
git commit -m "feat(extraction): capture and persist merchant name

Refs ARC-246"
```

---

### Task 3: Display merchant in the table

**Files:**
- Modify: `components/transactions-table.tsx`

**Interfaces:**
- Consumes: `transactions.merchant` (Task 1) — flows in via the full-row selects the pages already do.
- Produces: `Row.merchant: string | null`; two-line description cell.

- [ ] **Step 1: Add `merchant` to the Row type**

In `components/transactions-table.tsx`, add to the `Row` type (after `description: string;`):

```ts
  merchant: string | null;
```

- [ ] **Step 2: Render merchant as primary, description as subtitle**

Replace the description `<TableCell>` (the redesigned one: `<TableCell className="font-medium text-foreground/90" title={r.description}>{r.description}</TableCell>`) with:

```tsx
            <TableCell title={r.description}>
              <div className="font-medium text-foreground/90">{r.merchant ?? r.description}</div>
              {r.merchant && (
                <div className="truncate text-xs text-muted-foreground">{r.description}</div>
              )}
            </TableCell>
```

- [ ] **Step 3: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npx eslint components/transactions-table.tsx && npx vitest run`
Expected: tsc + eslint clean on the file; all tests pass. (The pages feeding `TransactionsTable` already select full transaction rows, so `merchant` is present with no page changes.)

- [ ] **Step 4: Commit**

```bash
git add components/transactions-table.tsx
git commit -m "feat(transactions): show merchant name, raw description as subtitle

Refs ARC-246"
```

---

### Task 4: Backfill script for existing rows

**Files:**
- Create: `scripts/backfill-merchants.mjs`

**Interfaces:**
- Consumes: `transactions.merchant`, `transactions.description`; `DATABASE_URL` + `OPENROUTER_API_KEY` from `.env.local`.

- [ ] **Step 1: Write the script**

Create `scripts/backfill-merchants.mjs`:

```js
/**
 * One-off backfill of transactions.merchant for rows that predate the merchant
 * field (ARC-246). Derives a short merchant name from each distinct description
 * via a cheap LLM call — no statement PDFs needed.
 *
 *   node scripts/backfill-merchants.mjs           # dry run (prints proposed names)
 *   node scripts/backfill-merchants.mjs --apply   # write merchant for matching rows
 *
 * Idempotent: only touches rows where merchant IS NULL. Descriptions the model
 * can't name are left null (the row keeps showing its raw description).
 */
import { config } from "dotenv";
import { Pool } from "pg";
import OpenAI from "openai";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (.env.local).");
  process.exit(1);
}
if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is not set (.env.local).");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const MODEL = "google/gemini-2.5-flash";
const BATCH = 80;

const SYSTEM = `You normalize noisy bank/credit-card transaction descriptions into short, human-friendly merchant or brand names.
Return a JSON object mapping each input description (verbatim key) to a short name like "Amazon", "A&W", "Spotify", or "Interest charge".
Use "" (empty string) when no sensible name can be derived. Strip store numbers, URLs, cities, and province codes. Do not invent details.`;

async function nameBatch(descriptions) {
  const completion = await ai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify(descriptions) },
    ],
  });
  const raw = completion.choices[0]?.message?.content ?? "{}";
  return JSON.parse(raw);
}

async function main() {
  const { rows } = await pool.query(
    "SELECT DISTINCT description FROM transactions WHERE merchant IS NULL ORDER BY description",
  );
  const descriptions = rows.map((r) => r.description);
  console.log(`${descriptions.length} distinct un-named description(s).`);
  if (descriptions.length === 0) return;

  const mapping = {};
  for (let i = 0; i < descriptions.length; i += BATCH) {
    const slice = descriptions.slice(i, i + BATCH);
    const m = await nameBatch(slice);
    for (const d of slice) {
      const name = typeof m[d] === "string" ? m[d].trim() : "";
      if (name) mapping[d] = name;
    }
  }

  for (const [d, name] of Object.entries(mapping)) {
    console.log(`  ${name}  ⇐  ${d}`);
  }
  console.log(`\n${Object.keys(mapping).length} description(s) would be named${APPLY ? "" : " (dry run)"}.`);

  if (!APPLY) {
    console.log("Re-run with --apply to write.");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [d, name] of Object.entries(mapping)) {
      await client.query(
        "UPDATE transactions SET merchant = $1 WHERE description = $2 AND merchant IS NULL",
        [name, d],
      );
    }
    await client.query("COMMIT");
    console.log(`Applied ${Object.keys(mapping).length} merchant name(s).`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    pool.end();
    process.exit(1);
  });
```

- [ ] **Step 2: Syntax-check**

Run: `node --check scripts/backfill-merchants.mjs`
Expected: no output (valid). Do NOT run the script itself here — it calls OpenRouter and writes to the dev DB; that's a manual step the user runs (`node scripts/backfill-merchants.mjs` to preview, then `--apply`).

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-merchants.mjs
git commit -m "feat(scripts): backfill merchant names for existing transactions

Refs ARC-246"
```

---

## Self-Review Notes

- **Spec coverage:** schema → Task 1; extraction schema/prompt + persist in both actions → Task 2; display (merchant primary, raw subtitle, description-only when null) → Task 3; backfill (distinct descriptions, batched cheap model, dry-run/`--apply`, idempotent) → Task 4; testing (unit parse + integration persist) → Task 2. Out-of-scope items have no tasks.
- **Type consistency:** `merchant` is `string | null` on the DB row and `Row.merchant`; `ExtractionResult.transactions[].merchant` is `string | undefined` (optional), persisted as `t.merchant ?? null`. The integration test asserts `toBeNull()` for the absent case and the unit test asserts `toBeUndefined()` at the parse layer — consistent with that boundary.
- **Placeholder scan:** none — every code step is complete. The migration filename is `0005_*` (drizzle generates the suffix).
- **Stacking note:** Task 3 edits the ARC-245 redesigned cell (`merchant ?? description` two-line); it must not reintroduce the removed Direction column.
