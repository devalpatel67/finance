# Finance Tracker — Design

**Status:** Draft
**Date:** 2026-05-25
**Scope:** v1 ("playable MVP") — end-to-end PDF ingestion slice

## Overview

Multi-tenant personal finance tracker. Users sign in with Google, upload PDF bank/credit-card statements, and get back a categorized transaction list, basic spending breakdowns, and a foundation for trends/budgets/net-worth in later iterations.

Statements are extracted via an LLM through OpenRouter (per-user model selection from a curated PDF-capable allow-list). PDFs are stored in MinIO as source-of-truth so extractions can be re-run with a different model without re-uploading.

## Goals

- Prove the PDF → structured transactions → DB pipeline end-to-end.
- Multi-tenant from day one (real auth, isolated data), even when running only on localhost.
- Keep raw PDFs as source-of-truth so extraction can be retried with different models.
- Make it obvious what to do on first sign-in (clear empty states + upload CTA).

## Non-Goals (v1)

- Budgets, alerts (data model reserved; no UI).
- Net-worth roll-up dashboard.
- Direct bank connections (Plaid/Teller/etc.).
- Mobile app.
- Background job queue.
- Public deployment.
- Compliance certifications (SOC 2, PCI).

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.2+ (App Router), TypeScript |
| Database | External Postgres (connection string via env) |
| ORM | Drizzle |
| Auth | Better Auth 1.6+ with Google OAuth (Google-only in v1) |
| UI | Tailwind + shadcn/ui 3.5+ |
| Tables | TanStack Table |
| Charts | Recharts |
| LLM | OpenRouter via OpenAI-compatible SDK |
| Object storage | MinIO via `@aws-sdk/client-s3` |
| Validation | Zod |
| Tests | Vitest + Testcontainers (Postgres, MinIO) |

## Environment Variables

```
# DB
DATABASE_URL=

# Auth
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# LLM
OPENROUTER_API_KEY=

# Object storage
MINIO_ENDPOINT=
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
MINIO_BUCKET=finance-statements
MINIO_REGION=us-east-1
```

## Architecture

Single Next.js process. Server actions handle uploads and mutations; React Server Components fetch read data. No separate worker, no queue.

```
Browser ──upload PDF──> Next.js server action (extractStatement)
                             │
                             ├─> MinIO put (users/<userId>/statements/<statementId>.pdf)
                             ├─> OpenRouter chat completion (PDF + JSON schema)
                             └─> Postgres (Drizzle): statements + transactions
Browser <──redirect──── /statements/<id>
Browser ──fetch──> /dashboard, /accounts, /transactions, /settings
```

## Data Model

Multi-tenant isolation is enforced by `user_id` on every business-data table. No row-level security in Postgres for v1.

Better Auth tables (`users`, `sessions`, `accounts`, `verifications`) are owned by the auth library; we extend `users` with two columns:

```
users (Better Auth + extensions)
  preferred_model       text   default 'google/gemini-2.5-flash'
  default_currency      text   default 'USD'
```

Business tables:

```
financial_accounts
  id              uuid pk
  user_id         text fk users.id
  name            text                    -- "Chase Sapphire", "Ally Checking"
  kind            text                    -- 'checking' | 'savings' | 'credit' | 'investment'
  institution     text
  last4           text
  currency        text
  created_at      timestamptz

statements
  id                    uuid pk
  user_id               text fk users.id
  financial_account_id  uuid fk financial_accounts.id
  period_start          date
  period_end            date
  source_filename       text
  storage_bucket        text                -- MinIO bucket
  storage_key           text                -- users/<userId>/statements/<id>.pdf
  model_used            text                -- e.g. 'google/gemini-2.5-flash'
  extraction_status     text                -- 'pending' | 'succeeded' | 'failed'
  extraction_error      text                -- nullable
  uploaded_at           timestamptz
  extracted_at          timestamptz         -- nullable

transactions
  id                    uuid pk
  user_id               text fk users.id
  financial_account_id  uuid fk financial_accounts.id
  statement_id          uuid fk statements.id
  posted_at             date
  description           text
  amount                numeric(14,2)       -- signed; negative = outflow
  currency              text
  category_id           uuid fk categories.id (nullable)
  raw_extraction        jsonb               -- LLM's original row for re-categorization
  created_at            timestamptz
  UNIQUE (user_id, financial_account_id, posted_at, amount, description)

categories
  id          uuid pk
  user_id     text fk users.id
  name        text
  parent_id   uuid fk categories.id (nullable)
  color       text
  is_system   boolean                       -- seeded defaults on signup

budgets   (schema reserved; no UI in v1)
  id          uuid pk
  user_id     text fk users.id
  category_id uuid fk categories.id
  period      text                          -- 'YYYY-MM'
  amount      numeric(14,2)
  created_at  timestamptz
```

Key choices:
- `amount` is signed `numeric(14,2)`; positive = inflow, negative = outflow.
- `transactions` unique constraint prevents duplicates if a statement is re-uploaded.
- `raw_extraction` stores the LLM's original row JSON so categorization can be re-run without re-parsing.
- A default category set is seeded for each user on first sign-in: **Groceries, Dining, Transport, Utilities, Bills, Subscriptions, Shopping, Entertainment, Health, Travel, Income, Transfers, Fees, Other, Uncategorized**. `is_system=true` on these; users can rename/recolor but not delete the system set.

## Currency Handling (v1)

Each `financial_account` and each `transaction` carries its own ISO currency code. **No cross-currency conversion in v1.** Dashboard aggregations group/sum per currency; if a user has accounts in multiple currencies, the dashboard shows separate per-currency tiles rather than a converted total. Multi-currency conversion (FX rates, base-currency roll-up) is in **Future Work**.

## PDF Ingestion Flow

User flow:
1. User clicks **Upload statement** (global sidebar button).
2. Dialog: pick an existing `financial_account` or create one inline (name, kind, institution, last4, currency).
3. Drop PDF, click **Upload**.
4. UI shows a loading state: *"Extracting with `<preferred_model>`…"*
5. On success: redirect to `/statements/[id]` with the extracted transactions.
6. On failure: show the error, keep the `statements` row with `extraction_status='failed'`, offer **Retry with model…**

Server-side sequence (single server action `extractStatement`):

1. Validate session, file size (≤ 10 MB), mime type (`application/pdf`).
2. Insert `statements` row with `extraction_status='pending'`, `uploaded_at=now()`.
3. Upload PDF to MinIO at `users/<userId>/statements/<statementId>.pdf`.
   - On failure: mark statement `failed`, return error.
4. Call OpenRouter with `users.preferred_model`:
   - PDF as a document message part.
   - `response_format: { type: 'json_schema', schema: ... }` with strict schema:
     ```
     {
       account_summary: {
         institution?: string,
         last4?: string,
         period_start: string (ISO date),
         period_end: string (ISO date),
         currency: string
       },
       transactions: [{
         posted_at: string (ISO date),
         description: string,
         amount: number,                 // signed; negative = outflow
         suggested_category: string
       }]
     }
     ```
   - System prompt: "Extract every transaction. Amount is signed: negative = outflow. Use ISO dates. Return only the JSON."
5. Zod-validate the response. If invalid: mark `failed`, store error, return.
6. In one DB transaction:
   - Update `statements`: `period_start/end`, `model_used`, `status='succeeded'`, `extracted_at=now()`.
   - Resolve each `suggested_category` to a `category_id` (case-insensitive match against user's categories; create the category if missing under "Uncategorized" parent).
   - Insert `transactions` rows; `ON CONFLICT DO NOTHING` on the uniqueness constraint.
7. Return `statementId`; client redirects.

Re-processing: the `/statements/[id]` page has a **Re-process with…** dropdown that re-reads `storage_key` from MinIO and re-runs step 4 onward with a chosen model. This is the reason PDFs are retained.

## UI Surface

Layout: shadcn sidebar nav + main content area.

| Route | Purpose |
|---|---|
| `/` | Public landing → "Sign in with Google" |
| `/sign-in` | Better Auth Google button |
| `/dashboard` | Last-30d spend-by-category donut, recent 10 transactions, global "Upload statement" CTA |
| `/accounts` | List of financial accounts; "Add account" dialog |
| `/accounts/[id]` | One account: statements list, transactions list |
| `/statements/[id]` | Extracted transactions from one PDF (editable), "Re-process with model…" dropdown, "Download original PDF" (presigned MinIO URL, 5-min expiry) |
| `/transactions` | Full list with date/account/category filters, description search, inline category edit |
| `/categories` | Manage user's categories (rename, color, parent, delete) |
| `/settings` | `preferred_model` picker (allow-listed PDF-capable models with cost/quality labels), `default_currency` |

**Curated model allow-list for `preferred_model`** (v1):

| Model | Label | Notes |
|---|---|---|
| `google/gemini-2.5-flash` | Fast & cheap (default) | Cheapest PDF-capable option; default. |
| `google/gemini-2.5-pro` | Higher quality | Better on dense/messy statements. |
| `anthropic/claude-sonnet-4.6` | High quality | Strong structured-output reliability. |
| `anthropic/claude-opus-4.7` | Highest quality | Most expensive; use for stubborn PDFs. |

The list is a constant in code; adding/removing models is a code change in v1 (not a runtime admin feature).

UI choices:
- **Upload is global** — the same dialog component (account picker + drop zone) is reused on every page.
- **Editable transaction tables** use TanStack Table + shadcn primitives; row-level edits commit via server actions; optimistic UI for category changes.
- **One chart type in v1**: donut (spend by category). Trend/balance charts deferred until we extract balances or compute aggregates over longer history.
- **Empty states** on every page: "No data yet → upload your first statement."

## Security & Multi-Tenant Isolation

- **`user_id` filter on every query**, enforced by a Drizzle helper (`scopedDb(userId)`) so an unscoped query is a type error.
- **MinIO objects keyed by `users/<userId>/...`**; bucket is private; downloads only via server-issued presigned URLs (5-min expiry).
- **Better Auth** owns sessions (httpOnly cookies, CSRF protection). Google is the only IdP in v1.
- **Secrets stay server-side**: OpenRouter key, MinIO creds, DB creds. The model picker sends only a model *name*; the server makes the OpenRouter call.
- **Zod validation at every server action boundary.**
- **File guards** before MinIO upload: ≤ 10 MB, `application/pdf` only.
- **Logging**: structured events (`statement_extracted`, `extraction_failed`) with IDs; never log PDF contents or raw LLM responses.

Documented for later, not in v1:
- At-rest encryption of `raw_extraction` jsonb.
- Audit log.
- GDPR-style export/delete endpoints.
- Rate limiting on extraction endpoint.
- 2FA.

## Testing Strategy

- **Unit (Vitest)**: extraction-result parser/validator (Zod), category resolver, transaction de-dup, signed-amount arithmetic.
- **Integration (Vitest + Testcontainers Postgres + MinIO)**: `extractStatement` server action end-to-end with a stubbed OpenRouter client returning canned JSON.
- **Fixtures**: 3–4 anonymized PDFs in `tests/fixtures/statements/` for manual smoke testing. No real PDFs in CI (no LLM cost).
- **Manual smoke loop on every meaningful change**: sign in → upload → verify extracted rows → edit a category → reload and confirm persistence.
- **No Playwright in v1** — add once UI stabilizes.

## Future Work

- Background job queue (Inngest / Trigger.dev / pg-boss) for extraction.
- Heuristic-first parsing (`pdfjs` + per-bank templates) with LLM fallback (cost optimization).
- Budgets + alerts (delivery channel: email vs in-app TBD).
- Net-worth roll-up dashboard.
- Email/password and other social providers alongside Google.
- At-rest encryption of `raw_extraction`.
- Public deployment + observability.
- Playwright e2e tests.
- Mobile-responsive polish pass.
- Multi-currency conversion (FX rates, base-currency roll-up across accounts).
- Account balance extraction + balance-trend charts.
