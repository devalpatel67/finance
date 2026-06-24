# Statement Balance Reconciliation — Design

**Linear:** ARC-240
**Status:** Approved design, pending implementation plan
**Date:** 2026-06-24

## Problem

Transaction capture is a single LLM pass over a PDF with no verification. Nothing
checks that the extracted transactions actually tie out to the statement, so a
missed or hallucinated row passes silently. We have direct evidence the model is
non-deterministic (the same PDF extracted differently by two models — char
substitutions, truncation, added text). Without a tie-out we can't even *measure*
how accurate capture is.

This is the first step of the broader accuracy effort. Categorization improvements
are tracked separately (see Out of Scope).

## Goal

Reconcile each extraction against the statement's stated opening and closing
balances. Surface a discrepancy without blocking import ("import + flag").

## Behavior

- **Non-blocking.** Transactions import regardless of reconciliation outcome.
- The statement carries a reconciliation status and, on mismatch, the discrepancy.
- Reconciliation status is **separate from `extractionStatus`** — extraction can
  succeed while reconciliation reports a discrepancy.

## Tie-out method: balance-based

Statements virtually always print an opening (previous) and closing (new) balance.
We extract both and check one identity, with the sign depending on whether the
account is an asset or a liability:

```
asset (checking, savings):   expected_closing = opening + Σ(amounts)
credit (liability):          expected_closing = opening − Σ(amounts)
```

`amounts` are the signed transaction amounts already stored today (outflows
negative, inflows positive). Worked example (credit card):

```
opening (previous balance owed):  812.30
Σ(amounts) = −789.55 (purchases) + 393.00 (payment) = −396.55
expected_closing = 812.30 − (−396.55) = 1208.85
statement closing:                1204.55
delta = 1204.55 − 1208.85 = −4.30  → discrepancy
```

- **Tolerance: exact to the cent.** `delta === 0` → reconciled; otherwise
  discrepancy. Printed balances should tie exactly.
- **Single currency.** All rows in a statement share `account_summary.currency`,
  so there is no cross-currency mixing.
- Asset vs. liability is derived from the existing `financialAccounts.kind`
  (which the user sets) — not guessed by the model.

## Statuses

`reconciliationStatus`:

| status | meaning |
| --- | --- |
| `reconciled` | balances tie out exactly |
| `discrepancy` | balances found but don't tie out (delta ≠ 0) |
| `not_available` | opening and/or closing balance not found on the statement |
| `not_applicable` | account kind is `investment` (gains/losses aren't transactions) |

## Data model

New columns on `statements` (new Drizzle migration):

- `opening_balance` — `numeric(14,2)`, nullable
- `closing_balance` — `numeric(14,2)`, nullable
- `reconciliation_status` — `text` enum
  (`reconciled | discrepancy | not_available | not_applicable`), nullable until computed
- `reconciliation_delta` — `numeric(14,2)`, nullable (stated closing − computed closing)

## Extraction schema + prompt (`lib/llm/extraction.ts`)

- Extend `account_summary` with optional `opening_balance` and `closing_balance`
  (numbers; the model may not find them → `not_available`).
- Update the JSON schema and the Zod `ExtractionResult` accordingly.
- Prompt: instruct the model to report the statement's stated previous/opening and
  new/closing balance (for credit cards, the amount owed), as printed.

## Reconciliation logic (`lib/statements/reconcile.ts`)

Pure, dependency-free, unit-testable:

```ts
type ReconcileInput = {
  kind: "checking" | "savings" | "credit" | "investment";
  opening: number | null;
  closing: number | null;
  amounts: number[]; // signed
};
type ReconcileResult = {
  status: "reconciled" | "discrepancy" | "not_available" | "not_applicable";
  delta: number | null; // null unless status is reconciled | discrepancy
};

function reconcile(input: ReconcileInput): ReconcileResult;
```

- `investment` → `not_applicable`.
- `opening == null || closing == null` → `not_available`.
- compute `expected` per asset/liability; `delta = closing − expected`
  (rounded to the cent to avoid float noise); `status = delta === 0 ? reconciled : discrepancy`.

## Wiring

In both `extractStatement` and `reprocessStatement`, after extraction succeeds:
compute reconciliation from `account.kind`, the extracted balances, and the
extracted (signed) amounts; persist `opening_balance`, `closing_balance`,
`reconciliation_status`, `reconciliation_delta` on the statement. Import of
transactions is unaffected.

## UI (`app/(app)/statements/[id]/page.tsx`)

A banner/badge driven by `reconciliationStatus`:

- `discrepancy` → amber banner: "Expected closing CA$1,208.85, statement says
  CA$1,204.55 (off by CA$4.30) — this statement may be incomplete."
- `reconciled` → small green "Balanced ✓".
- `not_available` → muted note: "Couldn't verify — balances not found on the statement."
- `not_applicable` → no banner.

Currency is formatted with the shared `formatCurrency` helper (ARC-239).

## Testing

- **Unit** (`reconcile.ts`): asset tie-out and off-by; credit tie-out and off-by
  (the worked example); `not_available` (missing balance); `not_applicable`
  (investment); float-rounding edge (e.g. `0.1 + 0.2` style sums).
- **Integration** (`extractStatement`): mocked extraction with balances that tie
  out → statement `reconciled`; balances that don't → `discrepancy` **and
  transactions still imported**.

## Out of scope (YAGNI)

- Auto-retry / re-extraction on discrepancy.
- Per-category or stated-totals breakdown (the granular "which side is off" method
  was considered and not chosen).
- Backfilling reconciliation for existing statements — they have no stored
  balances; a future reprocess populates them.
- Categorization accuracy (merchant rules / learn-from-edits, passing the user's
  categories into the prompt, preserving manual categorizations across reprocess).
  These are the next steps in the accuracy effort, tracked as separate issues.
