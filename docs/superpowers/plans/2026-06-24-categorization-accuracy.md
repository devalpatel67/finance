# Categorization Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make categorization accurate and self-improving: merchant rules, prompt grounding with the user's real categories, learn-from-edits, and preservation of manual categorizations across reprocess.

**Architecture:** A `categorySource` enum (`suggested|rule|manual`) on each transaction drives a precedence model (manual > rule > suggested). A pure `resolveCategory()` applies rules (substring match) then the LLM label; both actions use it. Recategorizing marks a row `manual` and offers to create a rule (which backfills non-manual matches). Reprocess preserves `manual` rows by normalized key.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM + Postgres, Zod, shadcn/ui, Vitest + Testcontainers.

## Global Constraints

- Precedence: `manual` > `rule` > `suggested`. `resolveCategory()` NEVER emits `manual` (only user edits / reprocess-preservation set it).
- Rule match: substring/contains on the normalized description, case-insensitive. Longest keyword wins; ties broken by newest (callers pass rules newest-first).
- `normalizeDescription`: lowercase, trim, collapse internal whitespace to single spaces. Shared by rule matching, backfill, and reprocess key-matching.
- `categorySource` column: `text` enum `suggested|rule|manual`, `NOT NULL default 'suggested'`; migration backfills existing rows to `suggested`.
- `category_rules`: `(userId, keyword)` unique; `keyword` stored already-normalized.
- Rule backfill updates matching transactions EXCEPT `categorySource = 'manual'`.
- Deleting a rule is non-retroactive (transactions keep their category/source).
- Reuse existing helpers: `normalizeDescription` (new, Task 1), the `@/` import alias, `scopedDb` for page reads, `formatCurrency` where money is shown.

---

### Task 1: Normalization + `resolveCategory` (pure)

**Files:**
- Create: `lib/categories/normalize.ts`
- Modify: `lib/categories/resolve.ts` (add `resolveCategory`; keep `pickCategoryId` for now)
- Test: `tests/unit/normalize.test.ts`, `tests/unit/resolve-category.test.ts`

**Interfaces:**
- Produces: `normalizeDescription(s: string): string`; `resolveCategory(input: { description: string; suggestedLabel: string; rules: RuleRef[]; categories: CategoryRef[] }): { categoryId: string | null; source: CategorySource }`; types `CategorySource = "suggested"|"rule"|"manual"`, `RuleRef = { keyword: string; categoryId: string }`, existing `CategoryRef = { id: string; name: string }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeDescription } from "@/lib/categories/normalize";

describe("normalizeDescription", () => {
  it("lowercases, trims, and collapses internal whitespace", () => {
    expect(normalizeDescription("  STARBUCKS   57744  ")).toBe("starbucks 57744");
    expect(normalizeDescription("AMZN  MKTP\tCA")).toBe("amzn mktp ca");
  });
});
```

Create `tests/unit/resolve-category.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveCategory } from "@/lib/categories/resolve";

const cats = [
  { id: "dining", name: "Dining" },
  { id: "shopping", name: "Shopping" },
  { id: "uncat", name: "Uncategorized" },
];

describe("resolveCategory", () => {
  it("a matching rule beats the LLM suggestion", () => {
    const r = resolveCategory({
      description: "STARBUCKS 57744 NIAGARA FALLS ON",
      suggestedLabel: "Shopping",
      rules: [{ keyword: "starbucks", categoryId: "dining" }],
      categories: cats,
    });
    expect(r).toEqual({ categoryId: "dining", source: "rule" });
  });

  it("longest keyword wins among multiple matching rules", () => {
    const r = resolveCategory({
      description: "AMZN MKTP CA*ZX1 WWW.AMAZON.CA",
      suggestedLabel: "Other",
      rules: [
        { keyword: "amzn", categoryId: "shopping" },
        { keyword: "amzn mktp", categoryId: "dining" },
      ],
      categories: cats,
    });
    expect(r.categoryId).toBe("dining");
    expect(r.source).toBe("rule");
  });

  it("breaks keyword-length ties by newest (rules passed newest-first)", () => {
    const r = resolveCategory({
      description: "abcd wxyz store",
      suggestedLabel: "Other",
      rules: [
        { keyword: "abcd", categoryId: "dining" }, // newer
        { keyword: "wxyz", categoryId: "shopping" }, // older
      ],
      categories: cats,
    });
    expect(r.categoryId).toBe("dining");
  });

  it("falls back to an exact LLM-label category match", () => {
    const r = resolveCategory({
      description: "Some Shop",
      suggestedLabel: "dining",
      rules: [],
      categories: cats,
    });
    expect(r).toEqual({ categoryId: "dining", source: "suggested" });
  });

  it("falls back to Uncategorized when nothing matches", () => {
    const r = resolveCategory({
      description: "Mystery",
      suggestedLabel: "Nonexistent",
      rules: [],
      categories: cats,
    });
    expect(r).toEqual({ categoryId: "uncat", source: "suggested" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/normalize.test.ts tests/unit/resolve-category.test.ts`
Expected: FAIL — `normalizeDescription` / `resolveCategory` not exported.

- [ ] **Step 3: Implement**

Create `lib/categories/normalize.ts`:

```ts
/** Normalizes description text for rule matching and reprocess key-matching. */
export function normalizeDescription(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}
```

In `lib/categories/resolve.ts`, ADD (keep the existing `CategoryRef` type and `pickCategoryId` function — they are removed in Task 3):

```ts
import { normalizeDescription } from "./normalize";

export type CategorySource = "suggested" | "rule" | "manual";
export type RuleRef = { keyword: string; categoryId: string };

/**
 * Resolves a category by precedence: a matching rule (longest keyword wins;
 * callers pass rules newest-first so ties pick the newest) beats the LLM's
 * suggested label, which beats Uncategorized. Never returns source "manual".
 */
export function resolveCategory(input: {
  description: string;
  suggestedLabel: string;
  rules: RuleRef[];
  categories: CategoryRef[];
}): { categoryId: string | null; source: CategorySource } {
  const norm = normalizeDescription(input.description);
  const matched = input.rules
    .filter((r) => r.keyword.length > 0 && norm.includes(r.keyword))
    .sort((a, b) => b.keyword.length - a.keyword.length); // stable: ties keep input (newest-first) order
  if (matched.length > 0) {
    return { categoryId: matched[0].categoryId, source: "rule" };
  }

  const lower = input.suggestedLabel.trim().toLowerCase();
  const hit = input.categories.find((c) => c.name.toLowerCase() === lower);
  if (hit) return { categoryId: hit.id, source: "suggested" };

  const fallback = input.categories.find((c) => c.name.toLowerCase() === "uncategorized");
  return { categoryId: fallback?.id ?? null, source: "suggested" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/normalize.test.ts tests/unit/resolve-category.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/categories/normalize.ts lib/categories/resolve.ts tests/unit/normalize.test.ts tests/unit/resolve-category.test.ts
git commit -m "feat(categories): normalizeDescription + resolveCategory precedence

Refs ARC-241"
```

---

### Task 2: Schema — `category_rules` + `transactions.categorySource`

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/scoped.ts` (add `categoryRules` to the scoped-table union)
- Create: `drizzle/0004_*.sql` (generated)

**Interfaces:**
- Produces: `categoryRules` table (`id`, `userId`, `keyword`, `categoryId`, `createdAt`); `transactions.categorySource` (`"suggested"|"rule"|"manual"`, not null, default `"suggested"`).

- [ ] **Step 1: Add the column and table**

In `lib/db/schema.ts`, add `categorySource` to the `transactions` columns object, immediately after the `categoryId: ...` line:

```ts
    categorySource: text("category_source", {
      enum: ["suggested", "rule", "manual"],
    }).notNull().default("suggested"),
```

After the `categories` table definition (and before `transactions`, or anywhere among the business tables), add the new table:

```ts
export const categoryRules = pgTable(
  "category_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userKeywordIdx: uniqueIndex("category_rules_user_keyword").on(t.userId, t.keyword),
  }),
);
```

(`uniqueIndex` is already imported in this file.)

- [ ] **Step 2: Add `categoryRules` to the scoped-table union**

In `lib/db/scoped.ts`, add `categoryRules` to the `ScopedTable` union:

```ts
type ScopedTable =
  | typeof schema.financialAccounts
  | typeof schema.statements
  | typeof schema.transactions
  | typeof schema.categories
  | typeof schema.budgets
  | typeof schema.categoryRules;
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: prints `drizzle/0004_*.sql`.

- [ ] **Step 4: Verify the migration SQL**

Open `drizzle/0004_*.sql`. Confirm it: `CREATE TABLE "category_rules"` (+ the unique index), and `ALTER TABLE "transactions" ADD COLUMN "category_source" text DEFAULT 'suggested' NOT NULL`. No drops, no other table changes.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts lib/db/scoped.ts drizzle/
git commit -m "feat(db): category_rules table + transactions.categorySource

Refs ARC-241"
```

---

### Task 3: Apply `resolveCategory` in both actions; remove `pickCategoryId`

**Files:**
- Modify: `lib/actions/extract-statement.ts`
- Modify: `lib/actions/reprocess-statement.ts`
- Modify: `lib/categories/resolve.ts` (remove `pickCategoryId`)
- Delete: `tests/unit/categories-resolve.test.ts` (covered by Task 1's `resolve-category.test.ts`)
- Test: `tests/integration/category-rules-extract.test.ts`

**Interfaces:**
- Consumes: `resolveCategory`, `RuleRef` (Task 1); `categoryRules`, `transactions.categorySource` (Task 2).
- Produces: inserted transactions carry `categoryId` + `categorySource` from `resolveCategory`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/category-rules-extract.test.ts`:

```ts
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

vi.mock("@/lib/llm/extraction", async (orig) => {
  const real = await orig<typeof import("@/lib/llm/extraction")>();
  return {
    ...real,
    extractFromPdf: vi.fn(async () => ({
      account_summary: { period_start: "2026-04-01", period_end: "2026-04-30", currency: "USD" },
      transactions: [
        { posted_at: "2026-04-03", description: "STARBUCKS 57744 NIAGARA FALLS ON", amount: -2.73, suggested_category: "Shopping", direction: "outflow" },
        { posted_at: "2026-04-04", description: "UNKNOWN MERCHANT", amount: -9.99, suggested_category: "Shopping", direction: "outflow" },
      ],
    })),
  };
});

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: "u1", name: "T", email: "t@x" } })) } },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));

describe("extract applies category rules", () => {
  it("a matching rule sets category + source 'rule'; non-match stays 'suggested'", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, categories, categoryRules, transactions } = await import("@/lib/db/schema");
    await db.insert(users).values({ id: "u1", name: "T", email: "t@x" });
    const [acc] = await db.insert(financialAccounts)
      .values({ userId: "u1", name: "Visa", kind: "credit", currency: "USD" }).returning();
    const [dining] = await db.insert(categories)
      .values({ userId: "u1", name: "Dining", isSystem: true }).returning();
    await db.insert(categories).values([
      { userId: "u1", name: "Shopping", isSystem: true },
      { userId: "u1", name: "Uncategorized", isSystem: true },
    ]);
    await db.insert(categoryRules).values({ userId: "u1", keyword: "starbucks", categoryId: dining.id });

    const { extractStatement } = await import("@/lib/actions/extract-statement");
    const fd = new FormData();
    fd.append("financialAccountId", acc.id);
    fd.append("file", new File([Buffer.from("%PDF-1.4 x")], "s.pdf", { type: "application/pdf" }));
    try { await extractStatement(fd); } catch (e) {
      if (!/REDIRECT:/.test((e as Error).message)) throw e;
    }

    const rows = await db.select().from(transactions);
    const sbux = rows.find((r) => r.description.includes("STARBUCKS"))!;
    const other = rows.find((r) => r.description.includes("UNKNOWN"))!;
    expect(sbux.categoryId).toBe(dining.id);
    expect(sbux.categorySource).toBe("rule");
    expect(other.categorySource).toBe("suggested");
  }, 90_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/category-rules-extract.test.ts`
Expected: FAIL — `categorySource` is `"suggested"` for the Starbucks row (rules not applied yet) / `pickCategoryId` ignores rules.

- [ ] **Step 3: Wire `extractStatement`**

In `lib/actions/extract-statement.ts`:

(a) Replace the `pickCategoryId` import with:

```ts
import { resolveCategory } from "@/lib/categories/resolve";
```

(b) Add `categoryRules` to the existing `@/lib/db/schema` import, and `desc` to the `drizzle-orm` import.

(c) Where it currently fetches `cats`, also fetch the rules (newest-first). Replace the `cats` fetch block with:

```ts
  const cats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.userId, userId));
  const rules = await db
    .select({ keyword: categoryRules.keyword, categoryId: categoryRules.categoryId })
    .from(categoryRules)
    .where(eq(categoryRules.userId, userId))
    .orderBy(desc(categoryRules.createdAt));
```

(d) In the `transactions` insert `.values(result.transactions.map((t) => ({ ... })))`, replace `categoryId: pickCategoryId(cats, t.suggested_category),` with:

```ts
            ...(() => {
              const r = resolveCategory({
                description: t.description,
                suggestedLabel: t.suggested_category,
                rules,
                categories: cats,
              });
              return { categoryId: r.categoryId, categorySource: r.source };
            })(),
```

- [ ] **Step 4: Wire `reprocessStatement`**

In `lib/actions/reprocess-statement.ts`, make the identical changes:
- Replace `import { pickCategoryId } from "@/lib/categories/resolve";` with `import { resolveCategory } from "@/lib/categories/resolve";`.
- Add `categoryRules` to the `@/lib/db/schema` import and `desc` to the `drizzle-orm` import.
- After the `cats` fetch, add the same `rules` fetch as above (using `session.user.id`).
- In the insert map, replace `categoryId: pickCategoryId(cats, t.suggested_category),` with the same IIFE spread returning `{ categoryId, categorySource }`.

- [ ] **Step 5: Remove `pickCategoryId` and its test**

In `lib/categories/resolve.ts`, delete the `pickCategoryId` function. Delete the file `tests/unit/categories-resolve.test.ts`.

```bash
git rm tests/unit/categories-resolve.test.ts
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/integration/category-rules-extract.test.ts tests/integration/extract-statement.test.ts tests/integration/reconcile-extract.test.ts && npx tsc --noEmit`
Expected: PASS + clean. (The existing extract/reconcile integration tests still pass — they don't define rules, so all rows are `suggested`.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(categories): apply resolveCategory + rules in extract/reprocess

Refs ARC-241"
```

---

### Task 4: Prompt grounding with the user's categories

**Files:**
- Modify: `lib/llm/extraction.ts`
- Modify: `lib/actions/extract-statement.ts`, `lib/actions/reprocess-statement.ts` (pass category names)
- Test: `tests/unit/extraction.test.ts` (add a `buildSystemPrompt` test)

**Interfaces:**
- Produces: `buildSystemPrompt(categoryNames: string[]): string`; `extractFromPdf` accepts an added field `categoryNames: string[]`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/extraction.test.ts` (new `describe` block; import `buildSystemPrompt` from the module):

```ts
import { buildSystemPrompt } from "@/lib/llm/extraction";

describe("buildSystemPrompt", () => {
  it("lists the user's categories when provided", () => {
    const p = buildSystemPrompt(["Dining", "My Custom Cat"]);
    expect(p).toContain("Dining");
    expect(p).toContain("My Custom Cat");
    expect(p.toLowerCase()).toContain("choose");
  });

  it("omits the category-list instruction when none are provided", () => {
    const p = buildSystemPrompt([]);
    expect(p).not.toContain("Choose suggested_category from");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/extraction.test.ts -t buildSystemPrompt`
Expected: FAIL — `buildSystemPrompt` not exported.

- [ ] **Step 3: Implement**

In `lib/llm/extraction.ts`:

(a) Rename the existing `const SYSTEM_PROMPT = \`...\`` to `const BASE_SYSTEM_PROMPT = \`...\`` (keep its content) and add below it:

```ts
export function buildSystemPrompt(categoryNames: string[]): string {
  if (categoryNames.length === 0) return BASE_SYSTEM_PROMPT;
  return (
    BASE_SYSTEM_PROMPT +
    `\n- Choose suggested_category from this list when one fits: ${categoryNames.join(", ")}. If none fit, use a short free-text label.`
  );
}
```

(b) Add `categoryNames: string[]` to the `extractFromPdf` options type, and use it: replace the `{ role: "system", content: SYSTEM_PROMPT }` message with `{ role: "system", content: buildSystemPrompt(opts.categoryNames) }`.

- [ ] **Step 4: Pass names from both actions**

In `lib/actions/extract-statement.ts` and `lib/actions/reprocess-statement.ts`, update the `extractFromPdf({ ... })` call to include the names from the already-fetched `cats`:

```ts
  // extract-statement.ts already fetches `cats` AFTER the extract call today — move the
  // `cats` + `rules` fetch ABOVE the extractFromPdf call so the names are available, then:
  result = await extractFromPdf({ pdf: buffer, model, filename: file.name, categoryNames: cats.map((c) => c.name) });
```

For `extract-statement.ts`: relocate the `cats`/`rules` fetch (added in Task 3) to just before the `extractFromPdf` try/catch so `cats` exists when calling it. For `reprocess-statement.ts`: the `cats` fetch is already before the insert; move it above the `extractFromPdf` call and pass `categoryNames: cats.map((c) => c.name)`.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/unit/extraction.test.ts tests/integration/category-rules-extract.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add lib/llm/extraction.ts lib/actions/extract-statement.ts lib/actions/reprocess-statement.ts tests/unit/extraction.test.ts
git commit -m "feat(extraction): ground the prompt in the user's categories

Refs ARC-241"
```

---

### Task 5: Learn-from-edits backend (manual source + rule create/backfill/delete)

**Files:**
- Modify: `lib/actions/update-transaction.ts`
- Create: `lib/actions/category-rules.ts`
- Test: `tests/integration/category-rules-actions.test.ts`

**Interfaces:**
- Consumes: `normalizeDescription` (Task 1); `categoryRules`, `transactions.categorySource` (Task 2).
- Produces: `updateTransactionCategory` sets `categorySource: "manual"`; `createCategoryRule({ keyword: string; categoryId: string }): Promise<void>`; `deleteCategoryRule(ruleId: string): Promise<void>`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/category-rules-actions.test.ts` (same `beforeAll`/`afterAll`/mocks header as Task 3's test — copy the env setup, the `@/lib/auth` mock with user `u1`, and `next/headers`/`next/cache` mocks; this test needs `next/cache` mocked: `vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))`). Body:

```ts
describe("learn-from-edits", () => {
  it("manual edit sets source=manual; createCategoryRule backfills non-manual only", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, categories, transactions } = await import("@/lib/db/schema");
    await db.insert(users).values({ id: "u1", name: "T", email: "t@x" });
    const [acc] = await db.insert(financialAccounts)
      .values({ userId: "u1", name: "Visa", kind: "credit", currency: "USD" }).returning();
    const [dining] = await db.insert(categories).values({ userId: "u1", name: "Dining", isSystem: true }).returning();
    const [coffee] = await db.insert(categories).values({ userId: "u1", name: "Coffee", isSystem: false }).returning();

    const [a] = await db.insert(transactions).values({
      userId: "u1", financialAccountId: acc.id, postedAt: "2026-04-01",
      description: "STARBUCKS 1 TORONTO ON", amount: "-5.00", direction: "outflow", currency: "USD",
      categorySource: "suggested",
    }).returning();
    const [b] = await db.insert(transactions).values({
      userId: "u1", financialAccountId: acc.id, postedAt: "2026-04-02",
      description: "STARBUCKS 2 OTTAWA ON", amount: "-6.00", direction: "outflow", currency: "USD",
      categorySource: "suggested",
    }).returning();

    const { updateTransactionCategory } = await import("@/lib/actions/update-transaction");
    await updateTransactionCategory({ transactionId: b.id, categoryId: coffee.id });
    const bAfterEdit = (await db.select().from(transactions).where(eq(transactions.id, b.id)))[0];
    expect(bAfterEdit.categorySource).toBe("manual");

    const { createCategoryRule } = await import("@/lib/actions/category-rules");
    await createCategoryRule({ keyword: "STARBUCKS", categoryId: dining.id });

    const aAfter = (await db.select().from(transactions).where(eq(transactions.id, a.id)))[0];
    const bAfter = (await db.select().from(transactions).where(eq(transactions.id, b.id)))[0];
    expect(aAfter.categoryId).toBe(dining.id);
    expect(aAfter.categorySource).toBe("rule");        // non-manual → backfilled
    expect(bAfter.categoryId).toBe(coffee.id);          // manual → untouched
    expect(bAfter.categorySource).toBe("manual");
  }, 90_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/category-rules-actions.test.ts`
Expected: FAIL — `updateTransactionCategory` doesn't set `manual` / `@/lib/actions/category-rules` missing.

- [ ] **Step 3: Set `manual` on edit**

In `lib/actions/update-transaction.ts`, add `categorySource: "manual"` to the `.set({ ... })`:

```ts
    .set({ categoryId: parsed.categoryId, categorySource: "manual" })
```

- [ ] **Step 4: Create the rules action**

Create `lib/actions/category-rules.ts`:

```ts
"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { categories, categoryRules, transactions } from "@/lib/db/schema";
import { normalizeDescription } from "@/lib/categories/normalize";

const CreateInput = z.object({
  keyword: z.string().min(1),
  categoryId: z.string().uuid(),
});

export async function createCategoryRule(input: { keyword: string; categoryId: string }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  const userId = session.user.id;
  const parsed = CreateInput.parse(input);

  const keyword = normalizeDescription(parsed.keyword);
  if (!keyword) throw new Error("Keyword is empty after normalization");

  // category must belong to the user
  const [cat] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, parsed.categoryId), eq(categories.userId, userId)))
    .limit(1);
  if (!cat) throw new Error("Category not found");

  await db
    .insert(categoryRules)
    .values({ userId, keyword, categoryId: parsed.categoryId })
    .onConflictDoUpdate({
      target: [categoryRules.userId, categoryRules.keyword],
      set: { categoryId: parsed.categoryId },
    });

  // Backfill matching transactions that aren't manually categorized.
  const candidates = await db
    .select({ id: transactions.id, description: transactions.description })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), ne(transactions.categorySource, "manual")));
  const ids = candidates
    .filter((t) => normalizeDescription(t.description).includes(keyword))
    .map((t) => t.id);
  if (ids.length > 0) {
    await db
      .update(transactions)
      .set({ categoryId: parsed.categoryId, categorySource: "rule" })
      .where(inArray(transactions.id, ids));
  }

  revalidatePath("/transactions");
  revalidatePath("/rules");
}

export async function deleteCategoryRule(ruleId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  const id = z.string().uuid().parse(ruleId);
  await db
    .delete(categoryRules)
    .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, session.user.id)));
  revalidatePath("/rules");
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/integration/category-rules-actions.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/update-transaction.ts lib/actions/category-rules.ts tests/integration/category-rules-actions.test.ts
git commit -m "feat(categories): manual source on edit + create/backfill/delete rules

Refs ARC-241"
```

---

### Task 6: Preserve manual categorizations across reprocess

**Files:**
- Modify: `lib/actions/reprocess-statement.ts`
- Test: `tests/integration/reprocess-preserve-category.test.ts`

**Interfaces:**
- Consumes: `normalizeDescription` (Task 1); `resolveCategory` (Task 1, already wired in Task 3).

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/reprocess-preserve-category.test.ts`. Header: same env `beforeAll`/`afterAll` as Task 3; mock `@/lib/auth` (user `u1`), `next/headers`, `next/cache` (`revalidatePath`), and `@/lib/storage/minio` (`getStatementPdf: vi.fn(async () => Buffer.from("%PDF-1.4 x"))`), and mock `@/lib/llm/extraction` so `extractFromPdf` returns one row matching the manual edit's description:

```ts
vi.mock("@/lib/llm/extraction", async (orig) => {
  const real = await orig<typeof import("@/lib/llm/extraction")>();
  return {
    ...real,
    extractFromPdf: vi.fn(async () => ({
      account_summary: { period_start: "2026-04-01", period_end: "2026-04-30", currency: "USD" },
      transactions: [
        { posted_at: "2026-04-03", description: "STARBUCKS 57744 NIAGARA FALLSON", amount: -2.73, suggested_category: "Shopping", direction: "outflow" },
      ],
    })),
  };
});
```

Body:

```ts
describe("reprocess preserves manual categorization", () => {
  it("re-applies a manual category by normalized key after reprocess", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, categories, statements, transactions } = await import("@/lib/db/schema");
    await db.insert(users).values({ id: "u1", name: "T", email: "t@x" });
    const [acc] = await db.insert(financialAccounts)
      .values({ userId: "u1", name: "Visa", kind: "credit", currency: "USD" }).returning();
    const [coffee] = await db.insert(categories).values({ userId: "u1", name: "Coffee", isSystem: false }).returning();
    await db.insert(categories).values([
      { userId: "u1", name: "Shopping", isSystem: true },
      { userId: "u1", name: "Uncategorized", isSystem: true },
    ]);
    const [s] = await db.insert(statements).values({
      userId: "u1", financialAccountId: acc.id, sourceFilename: "s.pdf",
      storageBucket: "b", storageKey: "k", modelUsed: "google/gemini-2.5-flash",
      extractionStatus: "succeeded",
    }).returning();

    // existing manually-categorized row; note slightly different whitespace ("FALLS ON")
    await db.insert(transactions).values({
      userId: "u1", financialAccountId: acc.id, statementId: s.id, postedAt: "2026-04-03",
      description: "STARBUCKS 57744 NIAGARA FALLS ON", amount: "-2.73", direction: "outflow",
      currency: "USD", categoryId: coffee.id, categorySource: "manual",
    });

    const { reprocessStatement } = await import("@/lib/actions/reprocess-statement");
    await reprocessStatement(s.id, "google/gemini-2.5-pro");

    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
    expect(rows[0].categoryId).toBe(coffee.id);
    expect(rows[0].categorySource).toBe("manual");
  }, 90_000);
});
```

(The key collapses whitespace, so `… FALLS ON` and `… FALLSON` do NOT match here — wait: normalization only collapses runs of whitespace, it does not delete spaces, so `falls on` ≠ `fallson`. Adjust the seeded description to `"STARBUCKS 57744 NIAGARA  FALLSON"` (double space) so that after whitespace-collapse it equals the extracted `"STARBUCKS 57744 NIAGARA FALLSON"`. Use that seeded description in the test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/reprocess-preserve-category.test.ts`
Expected: FAIL — after reprocess the row's `categorySource` is `suggested`/`rule`, not `manual` (preservation not implemented).

- [ ] **Step 3: Implement preservation**

In `lib/actions/reprocess-statement.ts`:

(a) Add the import:

```ts
import { normalizeDescription } from "@/lib/categories/normalize";
```

(b) Before the `db.transaction(...)` block, capture manual rows for this statement:

```ts
  const manualRows = await db
    .select({ description: transactions.description, amount: transactions.amount, postedAt: transactions.postedAt, categoryId: transactions.categoryId })
    .from(transactions)
    .where(and(eq(transactions.statementId, s.id), eq(transactions.categorySource, "manual")));
  const manualKey = (description: string, amount: string, postedAt: string) =>
    `${normalizeDescription(description)}|${amount}|${postedAt}`;
  const manualByKey = new Map(
    manualRows.map((r) => [manualKey(r.description, r.amount, r.postedAt), r.categoryId]),
  );
```

(c) In the insert map (which from Task 3 computes `resolveCategory`), override with the manual category when the key matches. Replace the resolution IIFE with:

```ts
            ...(() => {
              const key = manualKey(t.description, t.amount.toFixed(2), t.posted_at);
              const manualCat = manualByKey.get(key);
              if (manualCat !== undefined) {
                return { categoryId: manualCat, categorySource: "manual" as const };
              }
              const r = resolveCategory({
                description: t.description,
                suggestedLabel: t.suggested_category,
                rules,
                categories: cats,
              });
              return { categoryId: r.categoryId, categorySource: r.source };
            })(),
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/integration/reprocess-preserve-category.test.ts tests/integration/category-rules-extract.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/reprocess-statement.ts tests/integration/reprocess-preserve-category.test.ts
git commit -m "feat(reprocess): preserve manual categorizations by normalized key

Refs ARC-241"
```

---

### Task 7: Learn-from-edits UI (keyword helper + rule-suggest prompt)

**Files:**
- Create: `lib/categories/keyword.ts`
- Test: `tests/unit/keyword.test.ts`
- Modify: `components/category-picker.tsx`, `components/transactions-table.tsx`

**Interfaces:**
- Consumes: `normalizeDescription` (Task 1); `createCategoryRule` (Task 5).
- Produces: `suggestKeyword(description: string): string`; CategoryPicker offers rule creation after a non-empty recategorization.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/keyword.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { suggestKeyword } from "@/lib/categories/keyword";

describe("suggestKeyword", () => {
  it("takes the leading run up to the first digit/*/#", () => {
    expect(suggestKeyword("STARBUCKS 57744 NIAGARA FALLS ON")).toBe("starbucks");
    expect(suggestKeyword("AMZN MKTP CA*ZX1 WWW.AMAZON.CA")).toBe("amzn mktp ca");
    expect(suggestKeyword("TIM HORTONS #4189 AJAX ON")).toBe("tim hortons");
  });

  it("returns the whole normalized string when there is no digit/*/#", () => {
    expect(suggestKeyword("Local Coffee Shop")).toBe("local coffee shop");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/keyword.test.ts`
Expected: FAIL — `suggestKeyword` not exported.

- [ ] **Step 3: Implement the helper**

Create `lib/categories/keyword.ts`:

```ts
import { normalizeDescription } from "./normalize";

/** Suggests a rule keyword: the leading run of the normalized description up to the first digit, '*' or '#'. */
export function suggestKeyword(description: string): string {
  const norm = normalizeDescription(description);
  const m = norm.match(/^[^0-9*#]+/);
  return (m ? m[0] : norm).trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/keyword.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the rule-suggest prompt into the UI**

Pass the transaction description to `CategoryPicker` and, after a recategorization to a non-empty category, open a small dialog offering rule creation.

In `components/transactions-table.tsx`, pass the row description and category name to the picker. Change the `<CategoryPicker .../>` usage to include `description={r.description}`:

```tsx
              <CategoryPicker
                transactionId={r.id}
                categoryId={r.categoryId}
                categories={categories}
                description={r.description}
              />
```

Rewrite `components/category-picker.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateTransactionCategory } from "@/lib/actions/update-transaction";
import { createCategoryRule } from "@/lib/actions/category-rules";
import { suggestKeyword } from "@/lib/categories/keyword";

type Category = { id: string; name: string; color: string };

export function CategoryPicker({
  transactionId,
  categoryId,
  categories,
  description,
}: {
  transactionId: string;
  categoryId: string | null;
  categories: Category[];
  description: string;
}) {
  const [, start] = useTransition();
  const [prompt, setPrompt] = useState<{ keyword: string; categoryId: string; categoryName: string } | null>(null);

  return (
    <>
      <Select
        value={categoryId ?? undefined}
        onValueChange={(v) => {
          start(() => updateTransactionCategory({ transactionId, categoryId: v || null }));
          const cat = categories.find((c) => c.id === v);
          if (v && cat) setPrompt({ keyword: suggestKeyword(description), categoryId: v, categoryName: cat.name });
        }}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Uncategorized" />
        </SelectTrigger>
        <SelectContent>
          {categories.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: c.color }} />
                {c.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog open={prompt !== null} onOpenChange={(o) => !o && setPrompt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make this a rule?</DialogTitle>
          </DialogHeader>
          {prompt && (
            <div className="space-y-3 text-sm">
              <p>
                Always categorize transactions containing this keyword as{" "}
                <span className="font-medium">{prompt.categoryName}</span>:
              </p>
              <Input
                value={prompt.keyword}
                onChange={(e) => setPrompt({ ...prompt, keyword: e.target.value })}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPrompt(null)}>No thanks</Button>
            <Button
              onClick={() => {
                if (!prompt) return;
                const p = prompt;
                setPrompt(null);
                start(() => createCategoryRule({ keyword: p.keyword, categoryId: p.categoryId }));
              }}
            >
              Create rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 6: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npx eslint components/category-picker.tsx components/transactions-table.tsx lib/categories/keyword.ts && npx vitest run`
Expected: clean + all tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/categories/keyword.ts tests/unit/keyword.test.ts components/category-picker.tsx components/transactions-table.tsx
git commit -m "feat(categories): offer to create a rule after recategorizing

Refs ARC-241"
```

---

### Task 8: Rules manager page

**Files:**
- Create: `app/(app)/rules/page.tsx`
- Create: `components/rules-manager.tsx`
- Modify: `components/app-sidebar.tsx` (add a nav link)

**Interfaces:**
- Consumes: `scopedDb` (`selectAll`), `categoryRules`, `categories`; `deleteCategoryRule` (Task 5).

- [ ] **Step 1: Add the nav link**

In `components/app-sidebar.tsx`, add to the `nav` array (after Categories):

```ts
  { href: "/rules", label: "Rules" },
```

- [ ] **Step 2: Create the page**

Create `app/(app)/rules/page.tsx`:

```tsx
import { headers } from "next/headers";
import { asc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db/scoped";
import { categoryRules, categories } from "@/lib/db/schema";
import { RulesManager } from "@/components/rules-manager";

export default async function RulesPage() {
  const session = (await auth.api.getSession({ headers: await headers() }))!;
  const sdb = scopedDb(session.user.id);

  const [rules, cats] = await Promise.all([
    sdb.selectAll(categoryRules, { orderBy: asc(categoryRules.keyword) }),
    sdb.selectAll(categories),
  ]);
  const catById = new Map(cats.map((c) => [c.id, c]));
  const rows = rules.map((r) => ({
    id: r.id,
    keyword: r.keyword,
    categoryName: catById.get(r.categoryId)?.name ?? "—",
    color: catById.get(r.categoryId)?.color ?? "#9ca3af",
  }));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Rules</h1>
      <p className="text-sm text-muted-foreground">
        Transactions whose description contains a keyword are categorized automatically.
        Your manual category edits are always kept.
      </p>
      <RulesManager rules={rows} />
    </div>
  );
}
```

- [ ] **Step 3: Create the manager component**

Create `components/rules-manager.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { deleteCategoryRule } from "@/lib/actions/category-rules";

type Rule = { id: string; keyword: string; categoryName: string; color: string };

export function RulesManager({ rules }: { rules: Rule[] }) {
  const [, start] = useTransition();

  if (rules.length === 0) {
    return (
      <EmptyState
        title="No rules yet"
        description="Recategorize a transaction and choose “Create rule” to add one."
      />
    );
  }

  return (
    <ul className="divide-y rounded border">
      {rules.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-4 p-3 text-sm">
          <div className="flex items-center gap-2">
            <span>contains</span>
            <code className="rounded bg-muted px-1.5 py-0.5">{r.keyword}</code>
            <span>→</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />
              {r.categoryName}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => start(() => deleteCategoryRule(r.id))}
          >
            Delete
          </Button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Typecheck, lint, full suite**

Run: `npx tsc --noEmit && npx eslint app components && npx vitest run`
Expected: tsc clean; eslint clean except the 2 pre-existing `lib/db/schema.ts` and `lib/llm/extraction.ts` `any` errors (unrelated, also on `main`); all tests pass.

- [ ] **Step 5: Manual verification**

Start `pnpm dev`. Recategorize a transaction → the "Make this a rule?" dialog appears with a pre-filled keyword → Create → visit `/rules` to see it; other matching transactions are recategorized (except ones you set manually). Delete a rule on `/rules`.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/rules/page.tsx" components/rules-manager.tsx components/app-sidebar.tsx
git commit -m "feat(categories): rules manager page

Refs ARC-241"
```

---

## Self-Review Notes

- **Spec coverage:** `categorySource` + precedence → Tasks 1, 2; resolution pipeline → Task 1; apply at extract/reprocess → Task 3; prompt grounding → Task 4; learn-from-edits (manual source, rule create/backfill respecting manual, delete) → Task 5; reprocess preservation → Task 6; learn-from-edits UI (offer with editable keyword) → Task 7; rules manager (list/delete) → Task 8; normalization shared helper → Task 1. Out-of-scope items have no tasks.
- **Type consistency:** `CategorySource`/`resolveCategory` signatures match across Tasks 1, 3, 6. `categoryRules`/`categorySource` names match across Tasks 2, 3, 5, 6, 8. `createCategoryRule({ keyword, categoryId })` / `deleteCategoryRule(ruleId)` match between Tasks 5, 7, 8. `suggestKeyword` and `normalizeDescription` consistent. Rules passed newest-first (`orderBy desc(createdAt)`) so `resolveCategory`'s stable sort breaks ties by newest, per Global Constraints.
- **Placeholder scan:** none — every code step contains complete code.
- **Reprocess key note:** the Task 6 test description uses a double space so whitespace-collapse makes the normalized keys equal; normalization collapses runs of whitespace but does not delete single spaces (so `falls on` ≠ `fallson`) — this is intentional and called out in the test step.
