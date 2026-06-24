# Simplified Merchant Names — Design

**Linear:** ARC-246
**Status:** Approved design, pending implementation plan
**Date:** 2026-06-24
**Stacked on:** ARC-245 (table redesign, PR #12) — this edits the redesigned description cell.

## Problem

Transactions display the raw bank description (`AMZN MKTP CA*AA2264D93 WWW.AMAZON.CA ON`).
It's noisy on desktop and unusable on a phone card. A short brand name ("Amazon")
is far more scannable — and is a prerequisite for the mobile layout.

## Goal

Capture a short, human-friendly merchant/brand name per transaction and show it as
the primary label, keeping the raw description available as a subtitle. Read-only
in v1 (no user editing).

## Data model

Add `transactions.merchant` — `text`, **nullable**. New Drizzle migration.
`null` means "no merchant identified; show the raw description." Additive column;
the migration adds it nullable with no backfill default (existing rows are filled
by the backfill script, below).

## Extraction (new uploads)

`lib/llm/extraction.ts`:
- Add optional `merchant` to the per-transaction object in the Zod `ExtractionResult`
  (`merchant: z.string().min(1).optional()`).
- Add `merchant: { type: "string" }` to the JSON-schema transaction properties
  (NOT in `required` — optional).
- Prompt: add a bullet — *"Also return `merchant`: a short, human-friendly business
  or brand name for the transaction (e.g. 'Amazon', 'A&W', 'Spotify', 'Interest
  charge'). Omit it only when no sensible name can be derived."*

`lib/actions/extract-statement.ts` and `lib/actions/reprocess-statement.ts`:
- In the transactions insert, add `merchant: t.merchant ?? null`.
- No other logic changes — `merchant` is independent of direction, reconciliation,
  dedup (unchanged unique key), and category resolution.

## Display

`components/transactions-table.tsx` — the description cell becomes a two-line block:
- **Primary**: `merchant ?? description` (the existing primary weight/color).
- **Subtitle**: when `merchant` is non-null, show the raw `description` in a small
  muted line beneath. When `merchant` is null, render only the description (no
  subtitle).

The `Row` type gains `merchant: string | null`. Every page that builds rows for
`TransactionsTable` already `select()`s full transaction rows, so `merchant` flows
through automatically (transactions list, statement detail, dashboard recent).

## Backfill (existing rows)

A one-off, dry-run-first Node script `scripts/backfill-merchants.mjs` (same shape as
`scripts/dedupe-transactions.mjs`):

1. Select **distinct** `description` values from `transactions` where `merchant IS NULL`.
2. Send them to a cheap model (Gemini Flash) via the OpenRouter-compatible OpenAI
   SDK (base URL + `OPENROUTER_API_KEY` from `.env.local`), asking for a JSON object
   mapping each description to a short merchant name (or empty string if none).
   Batch (e.g. 80 descriptions per call) to bound prompt size.
3. **Dry-run by default**: print the `description → merchant` mapping and counts;
   change nothing. With `--apply`, `UPDATE transactions SET merchant = $1 WHERE
   description = $2 AND merchant IS NULL` per distinct description.
4. Idempotent and re-runnable (only touches `merchant IS NULL`). Descriptions the
   model returns empty for are left null → those rows keep showing the raw description.

The backfill maps by exact `description`, so the same proposed names can be reviewed
before `--apply` — mirroring the dedupe-script workflow.

## Components / files

- `lib/db/schema.ts` — add `merchant` column.
- `drizzle/00NN_*.sql` — generated migration.
- `lib/llm/extraction.ts` — Zod + JSON schema + prompt.
- `lib/actions/extract-statement.ts`, `lib/actions/reprocess-statement.ts` — store `merchant`.
- `components/transactions-table.tsx` — two-line description cell + `Row.merchant`.
- `scripts/backfill-merchants.mjs` — one-off backfill.

## Testing

- **Unit** (`tests/unit/extraction.test.ts`): `ExtractionResult.parse` captures
  `merchant` when present and tolerates its absence.
- **Integration** (`tests/integration/`): a mocked extraction whose rows include
  `merchant` results in `transactions.merchant` being persisted; a row without
  `merchant` persists `null`.
- Display is a presentational change — verified manually (merchant primary, raw
  subtitle; description-only when merchant is null).
- Backfill script verified via its dry-run against the dev DB.

## Out of scope (YAGNI)

- Editing/correcting merchant names (read-only v1; revisit later, would mirror the
  category manual-edit + reprocess-preservation machinery).
- Merchant-based categorization rules.
- A canonical merchant lookup / normalization table.
