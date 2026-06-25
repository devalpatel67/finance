# Tabula

Tabula (tabulafinance.com) — a multi-tenant personal finance tracker. Users sign in with Google, upload PDF bank/credit-card statements, and get back categorized transactions, reconciliation, and spending insights. Product/brand name is **Tabula**; the Linear project is still named "Finance Tracker" (see below).

V1 design spec: [`docs/superpowers/specs/2026-05-25-finance-tracker-design.md`](docs/superpowers/specs/2026-05-25-finance-tracker-design.md)

## Linear Project

- **Workspace:** `arc10`
- **Project:** `Finance Tracker`
- **Team prefix:** `ARC`

## Stack (v1)

- Next.js 16.2+ (App Router), TypeScript
- Postgres (external) + Drizzle ORM
- Better Auth 1.6+ with Google OAuth (Google-only in v1)
- Tailwind + shadcn/ui 3.5+
- OpenRouter via OpenAI-compatible SDK (per-user model selection, PDF-capable models only)
- MinIO via `@aws-sdk/client-s3` for raw PDF storage
- Zod for validation, Vitest + Testcontainers for tests
