# Bulk Statement Upload + Account Auto-Detection — Design Spec

**Linear:** ARC-247
**Date:** 2026-06-24
**Status:** Approved (design)

## Problem

Uploading ~100 PDF statements through today's single-file dialog is too slow: one file per dialog, and the user must pick the account from a dropdown every time. Two coupled needs:

1. **Bulk upload** — drop many PDFs at once and watch them process.
2. **Auto-detect the account** — infer which `financial_account` a statement belongs to instead of asking for every file.

Auto-detection is what makes bulk upload tolerable, so they ship together.

## Current state (what we build on)

- `components/upload-statement-dialog.tsx`: single `<input type=file>`, account `<Select>`, calls `extractStatement(formData)`, then redirects to the statement page.
- `lib/actions/extract-statement.ts` — `extractStatement` runs the whole pipeline **synchronously in one request**: auth → validate → hash → dedup-by-hash → create `pending` statement (requires `financialAccountId`) → store PDF → extract → reconcile → insert transactions. Returns `{ statementId, duplicate }`.
- `lib/llm/extraction.ts` — extraction already returns `account_summary.institution` and `account_summary.last4` (both optional), plus `currency`, `period_*`, balances. It does **not** return an account type.
- `lib/db/schema.ts` — `financial_accounts` has `name`, `kind (checking|savings|credit|investment)`, `institution`, `last4`, `currency`. `statements.financialAccountId` is `NOT NULL`. `transactions.financialAccountId` is `NOT NULL`.
- `lib/statements/reconcile.ts` — `reconcile({ kind, opening, closing, amounts })`; asset kinds use `opening + Σ`, credit uses `opening − Σ`. **`kind` materially changes the result.**
- No background-job infrastructure (no queue, worker, or cron). Extraction blocks the request.

## Architecture

**Client-orchestrated, concurrency-limited.** The browser holds the file list and fires one server action per file with a small concurrency cap. No new server infrastructure. The tab must stay open until the batch finishes; closing it only pauses unstarted/unfinished files — anything already inserted is durable.

### Components / units

| Unit | Responsibility |
|------|----------------|
| `components/bulk-upload-dialog.tsx` (new) | Drag-drop + multi-file picker; holds the per-file model; renders the status list with inline account override; drives the runner. Replaces the single-file dialog as the primary upload entry point. |
| `lib/upload/run-batch.ts` (new, client util) | Concurrency-limited runner: given items + a worker fn + a cap, runs ≤cap at a time, reports per-item progress via callback. Pure, unit-testable. |
| `lib/accounts/resolve-account.ts` (new, pure fn) | `resolveAccount({ extracted, accounts })` → match / no-match / ambiguous. Institution normalization + exact last4. |
| `lib/actions/ingest-statement.ts` (evolved from `extract-statement.ts`) | Server action: `financialAccountId` now **optional**; pipeline reordered so account resolution runs after extraction; auto-creates an account when unmatched. Returns a richer result. |
| `lib/actions/reassign-statement-account.ts` (new) | `reassignStatementAccount(statementId, accountId)` — re-keys the statement + its transactions to a different account and re-runs reconciliation. Backs the inline override. |
| `lib/llm/extraction.ts` (modified) | Add `account_type` to schema + prompt. |

> Naming: we rename the action `extractStatement` → `ingestStatement` to reflect that it now also resolves/creates accounts. The single-file dialog is removed; the bulk dialog covers the n=1 case.

### Server action: `ingestStatement(formData)`

Input: `file` (required), `financialAccountId` (optional — present only when the user overrides), `modelOverride` (optional).

Pipeline (reordered from today):

1. Auth; require session.
2. Validate file: `instanceof File`, `type === application/pdf`, `size ≤ 10 MB`.
3. `contentHash = sha256Hex(buffer)`.
4. **Dedup by hash** (scoped to user, `extractionStatus = succeeded`): if found, return `{ statementId, duplicate: true, account, txnCount: <existing> }` — no extraction, no cost.
5. Resolve model (override → user preferred → default; must be allowed).
6. `statementId = randomUUID()`; store PDF in MinIO keyed by `statementId`. **No statement row yet** (we don't know the account).
7. **Extract** (`extractFromPdf`). On failure: insert a `failed` statement row so the failure is durable, then throw. The `failed` row needs an account FK — see "Failure persistence" below.
8. **Resolve account:**
   - `financialAccountId` provided → load + verify ownership; use it. `autoCreated = false`.
   - else `resolveAccount({ extracted, accounts })`:
     - **exactly one match** → use it. `autoCreated = false`.
     - **no match** → auto-create `{ name, kind: account_type ?? "checking", institution, last4, currency }`. `autoCreated = true`.
     - **ambiguous (>1 match)** → use the most-recently-created of the matches; set `needsReview = true`.
9. Reconcile with the resolved `account.kind`.
10. In one DB transaction: insert the `succeeded` statement row (with period, balances, reconciliation) + transactions (`onConflictDoNothing` on the existing unique key), exactly as today.
11. Return `{ statementId, duplicate: false, account: { id, name, autoCreated }, needsReview, txnCount, reconciliation: { status, delta } }`.

**Failure persistence.** Today the `pending` row is created before extraction so a failure is recorded. With account-after-extraction, an extraction failure has no resolved account. Resolution: on extraction failure, insert a `failed` statement row using a resolved-or-best-effort account — but since extraction failed we have no institution/last4. Therefore: when extraction fails and no `financialAccountId` was supplied, record the failure against a per-user **"Unsorted" fallback account** (created lazily, `kind: checking`, `institution: null`). The bulk UI also surfaces the error on the row with Retry, so the fallback row is a durable audit trail, not the primary signal. (If `financialAccountId` was supplied, use it.)

### `resolveAccount` (pure)

```
resolveAccount({ extracted: { institution?, last4? }, accounts: Account[] })
  → { kind: "matched", account } | { kind: "none" } | { kind: "ambiguous", account }
```

- Normalize institution: lowercase, strip non-alphanumerics, and apply a small alias map (`amex` ↔ `american express`, etc.). Configurable constant.
- A candidate matches when **normalized institution is equal AND last4 is equal** (both present).
- If `last4` is absent from the extraction, no match is possible → `none` (forces auto-create / manual).
- 1 candidate → `matched`; >1 → `ambiguous` (caller picks most-recent + flags); 0 → `none`.

### `reassignStatementAccount(statementId, accountId)`

- Verify the user owns both the statement and the target account.
- In one transaction: update `statements.financialAccountId` and every `transactions.financialAccountId` for that statement to `accountId`; recompute reconciliation against the **new account's kind** using the statement's stored opening/closing + the txn amounts; update `reconciliationStatus`/`reconciliationDelta`.
- Return the new reconciliation summary so the row can update.

### Extraction change: `account_type`

- Add optional `account_type: z.enum(["checking","savings","credit","investment"])` to `ExtractionResult.account_summary` and to `JSON_SCHEMA`.
- Prompt: instruct the model to classify the statement as a checking/savings/credit/investment account from its header and layout (e.g. a credit-card statement → `credit`).
- Used only when **auto-creating** an account; never overrides an existing account's kind.

## UI / UX

`bulk-upload-dialog.tsx`:

- A drop zone + "browse" that accept multiple PDFs. Non-PDF or >10 MB files are added as rows already in `error` state (never sent).
- File list, one row each:
  - filename
  - status chip: `queued | uploading | extracting | done | duplicate | error`
  - resolved account name + an inline `<Select>` override (enabled once resolved; calls `reassignStatementAccount`)
  - a subtle "auto-created" / "review" marker where applicable
  - per-row **Retry** on error
- Footer summary: `N done · M duplicate · K failed`, and a "Start" / "Done" affordance.
- The runner (`run-batch`) processes with a concurrency cap of **3**.
- The override `<Select>` lists the user's accounts (including any auto-created during this batch — the dialog refreshes its account list as new ones come back).

## Edge cases

| Case | Handling |
|------|----------|
| Non-PDF / >10 MB | Row added in `error` state client-side; server also re-validates. |
| Duplicate hash | Row → `duplicate`, links existing statement, no extraction. |
| Extraction failure | `failed` statement row persisted (against resolved or "Unsorted" account); row → `error` + Retry. |
| `last4` missing | No match → auto-create with `last4 = null`. |
| Ambiguous match (>1) | Pick most-recently-created match; mark row `needsReview`. |
| Auto-created account name | `"<institution> ··<last4>"`; fall back to source filename (sans extension) if institution absent. |
| Tab closed mid-batch | Finished files durable; re-dropping later hits dedup short-circuit. |
| Two files in one batch auto-create the *same* new account | Resolve sequentially is not guaranteed (concurrency 3). Accept a possible duplicate auto-created account in the rare same-institution+last4-within-one-batch case; user merges/edits later. (Documented limitation, not solved in v1.) |

## Testing

- **Unit — `resolveAccount`:** match / no-match / ambiguous; institution normalization + alias; missing last4 → none.
- **Unit — `run-batch`:** never exceeds the cap; reports every item's terminal state; isolates a throwing worker.
- **Unit — extraction schema:** parses `account_type`; absent is allowed.
- **Integration (Testcontainers):**
  - `ingestStatement` no account + unmatched extraction → auto-creates account with `kind = account_type`; inserts txns.
  - `ingestStatement` no account + matching existing account → reuses it, no new account.
  - duplicate-hash short-circuit returns `duplicate: true`, inserts nothing.
  - `reassignStatementAccount` moves statement + all its txns and re-reconciles (asset vs credit produce different deltas).
- **Light component test** of the dialog's status transitions; drag-drop itself not exhaustively tested.

## Out of scope (YAGNI)

Background queue / worker, resumable server-side jobs, ZIP upload, OCR for scanned PDFs, automatic merge of duplicate auto-created accounts.
