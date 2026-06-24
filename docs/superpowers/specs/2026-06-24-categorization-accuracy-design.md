# Categorization Accuracy — Design

**Linear:** ARC-241
**Status:** Approved design, pending implementation plan
**Date:** 2026-06-24

## Problem

Categorization today (`lib/categories/resolve.ts`) is a case-insensitive exact-name
match of the LLM's free-text `suggested_category` against the user's categories,
falling back to "Uncategorized". Weaknesses:

- **Label drift** — the model says "Restaurants", the category is "Dining" → Uncategorized.
- **Custom categories are invisible to the model** — only the 15 seeded labels are in the prompt.
- **No learning** — recategorizing one transaction (`updateTransactionCategory`) sets one row's `categoryId`; nothing persists for next time.
- **Reprocess wipes edits** — `reprocessStatement` deletes the statement's transactions and re-inserts, discarding manual categorizations.

This is the categorization half of the accuracy effort (the capture half is ARC-240 reconciliation).

## Unifying model: category-assignment precedence

Every transaction's category carries a **source**, and a higher source is never
overwritten by an automatic lower-source assignment:

```
manual    (user set it)         — highest; never auto-overwritten
rule      (a merchant rule)     — overwrites suggested / uncategorized
suggested (LLM label → category)— overwrites uncategorized only
(no match → Uncategorized, source = suggested)
```

This single `categorySource` field drives precedence, rule backfill, and
reprocess preservation.

## Data model

- **New table `category_rules`:**
  - `id uuid pk`
  - `userId text` → users (cascade)
  - `keyword text` — normalized (lowercased, trimmed, internal whitespace collapsed)
  - `categoryId uuid` → categories (cascade)
  - `createdAt timestamp`
  - Unique index on `(userId, keyword)`.
- **New column `transactions.categorySource`** — enum `suggested | rule | manual`,
  `NOT NULL default 'suggested'`. The migration backfills existing rows to `suggested`.

## Normalization (shared)

A single helper normalizes description text for both rule matching and reprocess
key-matching: lowercase, trim, collapse internal whitespace to single spaces.
(Note: this is intentionally lighter than the cleanup-script normalization — we
keep word boundaries so substring keywords like `"amzn mktp"` remain meaningful.)
Rule keywords are stored already-normalized; matching is `normalizedDescription.includes(keyword)`.

## Resolution pipeline

Pure function replacing `pickCategoryId`:

```ts
type CategorySource = "suggested" | "rule" | "manual";
type CategoryRef = { id: string; name: string };
type RuleRef = { keyword: string; categoryId: string };

function resolveCategory(input: {
  description: string;
  suggestedLabel: string;
  rules: RuleRef[];
  categories: CategoryRef[];
}): { categoryId: string | null; source: CategorySource };
```

Logic:
1. Normalize the description. Among rules whose `keyword` is a substring, pick the
   **longest keyword** (ties broken by the rule order passed in — callers pass
   rules newest-first). Match → `{ categoryId, source: "rule" }`.
2. Else exact (case-insensitive) match of `suggestedLabel` to a category name →
   `{ categoryId, source: "suggested" }`.
3. Else "Uncategorized" category id if present, else null →
   `{ categoryId, source: "suggested" }`.

`manual` is never produced here — it is set only by user edits and by reprocess
preservation.

## Prompt grounding (`lib/llm/extraction.ts`)

The extraction call already has the user id available via the action. Pass the
user's category names (including custom) into the system/user prompt and instruct
the model: "Choose `suggested_category` from this list when one fits: <names>.
If none fit, use a short free-text label." The schema stays free-text (the
resolver maps it); this just biases the model toward real categories. The action
fetches category names (already does) and threads them into `extractFromPdf`.

## Applying at extract and reprocess

Both `extractStatement` and `reprocessStatement`:
- Fetch the user's `category_rules` (newest-first) and categories.
- For each extracted transaction, call `resolveCategory(...)` and insert with the
  resulting `categoryId` and `categorySource`.

## Learn-from-edits + backfill

- `updateTransactionCategory` sets the row's `categoryId` **and `categorySource = 'manual'`**.
- After a manual edit, the transactions UI offers: "Always categorize transactions
  containing [keyword] → <Category>?" with `keyword` pre-filled from the edited
  row's description (default heuristic: the leading run of the normalized
  description up to the first digit or `*`/`#` — e.g. `STARBUCKS 57744 …` →
  `starbucks`, `AMZN MKTP CA*…` → `amzn mktp ca`; always user-editable) and the
  chosen category.
- A new server action `createCategoryRule({ keyword, categoryId })`:
  - Upserts the normalized rule (unique on `(userId, keyword)`; re-creating an existing keyword updates its category).
  - **Backfills**: updates all of the user's transactions whose normalized
    description contains the keyword **and whose `categorySource <> 'manual'`** →
    set `categoryId` and `categorySource = 'rule'`.
- **Rules manager**: a minimal list of rules (keyword → category) with delete, on a
  `Rules` page (or a section of Settings). Deleting a rule does not retroactively
  un-categorize transactions (they keep their current category; source stays).

## Preserve manual edits across reprocess

In `reprocessStatement`, before deleting the statement's transactions:
1. Capture rows where `categorySource = 'manual'` as
   `{ key: normalized(description) + '|' + amount + '|' + postedAt, categoryId }`.
2. Delete + re-extract + insert as today, running `resolveCategory` for each new row.
3. After insert, for each new row whose normalized key matches a captured manual
   entry, set its `categoryId` to the captured value and `categorySource = 'manual'`
   (manual re-applied on top of rules/suggestions).

The normalized key tolerates the model's description noise (`FALLS ON` vs
`FALLSON` differ only by whitespace, which normalization collapses; larger drift
may miss, which is acceptable — the row simply falls back to rule/suggested).

## Components / files

- `lib/categories/normalize.ts` (new) — `normalizeDescription(s)`.
- `lib/categories/resolve.ts` (rewrite) — `resolveCategory(...)`; remove `pickCategoryId`.
- `lib/db/schema.ts` — `category_rules` table + `transactions.categorySource`.
- `lib/llm/extraction.ts` — accept category names, add to prompt.
- `lib/actions/extract-statement.ts`, `lib/actions/reprocess-statement.ts` — use resolver + rules; reprocess preservation.
- `lib/actions/update-transaction.ts` — set `categorySource = 'manual'`.
- `lib/actions/category-rules.ts` (new) — `createCategoryRule`, `deleteCategoryRule`.
- `lib/queries` — fetch rules; (rules list page query).
- UI: rule-offer prompt after recategorize (`components/transactions-table.tsx` / `category-picker.tsx`); Rules manager page + component.

## Testing

- **Unit** (`resolveCategory`): rule beats suggested; longest-keyword wins; tie → newest; suggested exact-match; Uncategorized fallback; never emits `manual`. Normalization cases (case, whitespace collapse).
- **Integration:**
  - extract applies a matching rule (row gets `rule` source + the rule's category).
  - `createCategoryRule` backfills non-manual matches and leaves `manual` rows untouched.
  - reprocess preserves a `manual` categorization (and lets rules re-apply to non-manual rows).
  - `updateTransactionCategory` sets `categorySource = 'manual'`.

## Out of scope (YAGNI)

- Regex rules; manual rule priority/ordering UI (beyond longest-match).
- ML / automatic rule inference without confirmation.
- Category-hierarchy-aware matching.
- Retroactive un-categorization when a rule is deleted.
