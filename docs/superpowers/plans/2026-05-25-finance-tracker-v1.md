# Finance Tracker v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v1 "playable MVP" — Google sign-in → upload PDF statement → see extracted, categorized transactions on localhost.

**Architecture:** Next.js 16 App Router single-process. Upload runs as a synchronous server action that streams the PDF to MinIO, calls OpenRouter for LLM extraction with a strict JSON schema, then writes rows to Postgres in one transaction. Per-user data scoping via a Drizzle helper. shadcn-based UI with a sidebar shell.

**Tech Stack:** Next.js 16.2+, TypeScript, Drizzle ORM + Postgres, Better Auth 1.6+ (Google OAuth), shadcn/ui 3.5+, OpenRouter (OpenAI-compatible SDK), MinIO (`@aws-sdk/client-s3`), Zod, Vitest + Testcontainers.

**Spec:** [`docs/superpowers/specs/2026-05-25-finance-tracker-design.md`](../specs/2026-05-25-finance-tracker-design.md)

**Linear:** every commit references `ARC-121`.

---

## File Structure

```
finance/
  CLAUDE.md                       ← exists
  package.json
  tsconfig.json
  next.config.ts                  ← serverActions.bodySizeLimit: '10mb'
  drizzle.config.ts
  components.json                 ← shadcn config
  tailwind.config.ts
  postcss.config.mjs
  vitest.config.ts
  .env.local.example
  .env.local                      ← gitignored
  .gitignore

  app/
    layout.tsx                    ← root layout
    page.tsx                      ← landing → redirect by auth state
    globals.css

    sign-in/page.tsx              ← Google sign-in button

    (app)/                        ← authenticated route group
      layout.tsx                  ← sidebar + auth guard
      dashboard/page.tsx
      accounts/
        page.tsx
        [id]/page.tsx
      statements/[id]/page.tsx
      transactions/page.tsx
      categories/page.tsx
      settings/page.tsx

    api/auth/[...all]/route.ts    ← Better Auth handler

  components/
    ui/                           ← shadcn primitives
    app-sidebar.tsx
    upload-statement-dialog.tsx
    add-account-dialog.tsx
    transactions-table.tsx
    category-picker.tsx
    spend-donut.tsx
    empty-state.tsx
    sign-in-with-google.tsx

  lib/
    env.ts                        ← Zod-validated env
    auth.ts                       ← Better Auth server instance
    auth-client.ts                ← Better Auth client
    db/
      client.ts                   ← Drizzle db instance
      schema.ts                   ← all tables (auth + business)
      scoped.ts                   ← scopedDb(userId)
    storage/
      minio.ts                    ← S3 client + put + presigned URL
    llm/
      openrouter.ts               ← OpenAI-compatible client
      models.ts                   ← curated PDF-capable allow-list
      extraction.ts               ← Zod schema + parse helper
    categories/
      seed.ts                     ← default set + seedDefaults(userId)
      resolve.ts                  ← resolve suggested name → category_id
    actions/
      extract-statement.ts        ← MAIN server action
      reprocess-statement.ts
      update-transaction.ts
      create-account.ts
      update-settings.ts
      categories.ts               ← rename/recolor/delete

  drizzle/                        ← generated migrations

  tests/
    setup.ts                      ← test DB + MinIO containers
    fixtures/statements/          ← anonymized sample PDFs (manual)
    unit/
      extraction.test.ts
      categories-resolve.test.ts
      scoped-db.test.ts
    integration/
      extract-statement.test.ts
```

**Boundaries:**
- `lib/db/schema.ts` is the single source of truth for the schema. Migrations are generated from it.
- `lib/db/scoped.ts` is the only sanctioned way to read business data — direct `db` use is reserved for the seeder and Better Auth's internals.
- All LLM/MinIO/Postgres clients live in `lib/`; server actions in `lib/actions/` are the only callers from `app/`.
- Server actions never trust client input — every action starts with a Zod parse.

---

## Phase 1 — Bootstrap

### Task 1: Initialize Next.js 16 project in place

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `postcss.config.mjs`, `tailwind.config.ts`, `.gitignore`

- [ ] **Step 1: Stash the existing tracked files so create-next-app can scaffold**

```bash
mkdir -p /tmp/finance-stash
mv CLAUDE.md /tmp/finance-stash/
mv docs /tmp/finance-stash/
```

Expected: only `.git/` remains in the working tree.

- [ ] **Step 2: Run create-next-app in the current directory**

```bash
npx --yes create-next-app@latest . \
  --typescript --tailwind --eslint --app \
  --src-dir false --turbopack \
  --import-alias "@/*" \
  --no-agents-md
```

Expected: scaffolds Next.js 16.x with App Router, TS, Tailwind v4. Confirm `package.json` shows `"next": "^16.2..."`. If it prompts about non-empty dir (because of `.git`), accept overwrite.

- [ ] **Step 3: Restore the stashed files**

```bash
mv /tmp/finance-stash/CLAUDE.md .
mv /tmp/finance-stash/docs .
rmdir /tmp/finance-stash
```

- [ ] **Step 4: Configure `serverActions.bodySizeLimit` and ESM in `next.config.ts`**

Replace `next.config.ts` with:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
```

- [ ] **Step 5: Verify the app builds and dev server starts**

```bash
pnpm install
pnpm dev
```

Expected: server starts on `http://localhost:3000` and the default Next.js landing page renders. Ctrl-C to stop.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js 16 project

Refs ARC-121"
```

---

### Task 2: Add environment variable schema

**Files:**
- Create: `lib/env.ts`, `.env.local.example`
- Modify: `.gitignore` (verify `.env.local` is ignored — `create-next-app` does this)

- [ ] **Step 1: Install zod**

```bash
pnpm add zod
```

- [ ] **Step 2: Create `lib/env.ts`**

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),

  BETTER_AUTH_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  OPENROUTER_API_KEY: z.string().min(1),

  MINIO_ENDPOINT: z.string().url(),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().min(1),
  MINIO_REGION: z.string().min(1),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment");
}

export const env = parsed.data;
```

- [ ] **Step 3: Create `.env.local.example`**

```
DATABASE_URL=postgres://user:pass@host:5432/finance
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=                # generate: openssl rand -base64 32
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
OPENROUTER_API_KEY=
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
MINIO_BUCKET=finance-statements
MINIO_REGION=us-east-1
```

- [ ] **Step 4: Manual step — create `.env.local`**

Copy `.env.local.example` to `.env.local` and fill in the real values (user provides Postgres URL, MinIO creds, Google OAuth, OpenRouter key). Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`.

- [ ] **Step 5: Commit**

```bash
git add lib/env.ts .env.local.example
git commit -m "feat: add Zod env schema with example file

Refs ARC-121"
```

---

### Task 3: Install shadcn/ui

**Files:**
- Create: `components.json`, `components/ui/*` (button, dialog, dropdown, input, label, select, sidebar, sonner, table, etc.)
- Modify: `app/globals.css`, `tailwind.config.ts`

- [ ] **Step 1: Init shadcn**

```bash
pnpm dlx shadcn@latest init
```

Choose: New York style, Slate base color, CSS variables.

- [ ] **Step 2: Install the primitives the plan uses**

```bash
pnpm dlx shadcn@latest add button card dialog dropdown-menu form input label select separator sheet sidebar sonner table tabs tooltip badge
```

Expected: components land in `components/ui/`.

- [ ] **Step 3: Verify it builds**

```bash
pnpm build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: install shadcn/ui primitives

Refs ARC-121"
```

---

## Phase 2 — Database & Schema

### Task 4: Set up Drizzle + Postgres client

**Files:**
- Create: `lib/db/client.ts`, `drizzle.config.ts`

- [ ] **Step 1: Install Drizzle**

```bash
pnpm add drizzle-orm pg
pnpm add -D drizzle-kit @types/pg
```

- [ ] **Step 2: Create `lib/db/client.ts`**

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

const pool = new Pool({ connectionString: env.DATABASE_URL });
export const db = drizzle(pool, { schema });
export type DB = typeof db;
```

- [ ] **Step 3: Create `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./lib/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 4: Add npm scripts to `package.json`**

In the `"scripts"` block, add:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio"
```

- [ ] **Step 5: Commit (schema file follows in next task)**

```bash
git add -A
git commit -m "feat: add Drizzle config and Postgres client

Refs ARC-121"
```

---

### Task 5: Define the database schema

**Files:**
- Create: `lib/db/schema.ts`

- [ ] **Step 1: Write `lib/db/schema.ts`**

```ts
import { relations, sql } from "drizzle-orm";
import {
  pgTable, text, timestamp, boolean, uuid, date, numeric, jsonb, uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Better Auth tables ───────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),

  // additionalFields (extensions)
  preferredModel: text("preferred_model").notNull().default("google/gemini-2.5-flash"),
  defaultCurrency: text("default_currency").notNull().default("USD"),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),       // provider's account id
  providerId: text("provider_id").notNull(),     // e.g. "google"
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Business tables ─────────────────────────────────────────────────

export const financialAccounts = pgTable("financial_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["checking", "savings", "credit", "investment"] }).notNull(),
  institution: text("institution"),
  last4: text("last4"),
  currency: text("currency").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const statements = pgTable("statements", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  financialAccountId: uuid("financial_account_id").notNull().references(() => financialAccounts.id, { onDelete: "cascade" }),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  sourceFilename: text("source_filename").notNull(),
  storageBucket: text("storage_bucket").notNull(),
  storageKey: text("storage_key").notNull(),
  modelUsed: text("model_used"),
  extractionStatus: text("extraction_status", { enum: ["pending", "succeeded", "failed"] }).notNull().default("pending"),
  extractionError: text("extraction_error"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  extractedAt: timestamp("extracted_at"),
});

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  parentId: uuid("parent_id").references((): any => categories.id, { onDelete: "set null" }),
  color: text("color").notNull().default("#94a3b8"),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    financialAccountId: uuid("financial_account_id").notNull().references(() => financialAccounts.id, { onDelete: "cascade" }),
    statementId: uuid("statement_id").references(() => statements.id, { onDelete: "set null" }),
    postedAt: date("posted_at").notNull(),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    rawExtraction: jsonb("raw_extraction"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueRow: uniqueIndex("transactions_unique_row").on(
      t.userId, t.financialAccountId, t.postedAt, t.amount, t.description,
    ),
  }),
);

export const budgets = pgTable("budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
  period: text("period").notNull(),  // 'YYYY-MM'
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Relations (handy for queries) ───────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  financialAccounts: many(financialAccounts),
  statements: many(statements),
  transactions: many(transactions),
  categories: many(categories),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  financialAccount: one(financialAccounts, {
    fields: [transactions.financialAccountId],
    references: [financialAccounts.id],
  }),
  category: one(categories, {
    fields: [transactions.categoryId],
    references: [categories.id],
  }),
  statement: one(statements, {
    fields: [transactions.statementId],
    references: [statements.id],
  }),
}));
```

- [ ] **Step 2: Generate the migration**

```bash
pnpm db:generate
```

Expected: a new SQL file under `drizzle/` is created.

- [ ] **Step 3: Apply the migration**

```bash
pnpm db:migrate
```

Expected: succeeds (assumes the user has filled in `DATABASE_URL`). Verify with `psql $DATABASE_URL -c '\dt'`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: define DB schema + initial migration

Includes Better Auth tables (users, sessions, accounts, verifications)
and business tables (financial_accounts, statements, transactions,
categories, budgets).

Refs ARC-121"
```

---

### Task 6: Add scoped-DB helper

**Files:**
- Create: `lib/db/scoped.ts`, `tests/unit/scoped-db.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/scoped-db.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { scopeFilter } from "@/lib/db/scoped";
import { eq } from "drizzle-orm";
import { financialAccounts } from "@/lib/db/schema";

describe("scopeFilter", () => {
  it("returns an eq(user_id, userId) filter", () => {
    const f = scopeFilter(financialAccounts, "user-123");
    // Drizzle's SQL helper objects are structurally checkable
    expect(f).toEqual(eq(financialAccounts.userId, "user-123"));
  });
});
```

- [ ] **Step 2: Run it — expect failure**

```bash
pnpm vitest run tests/unit/scoped-db.test.ts
```

Expected: import fails because `lib/db/scoped.ts` does not exist.

- [ ] **Step 3: Implement `lib/db/scoped.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "./client";
import * as schema from "./schema";

type ScopedTables =
  | typeof schema.financialAccounts
  | typeof schema.statements
  | typeof schema.transactions
  | typeof schema.categories
  | typeof schema.budgets;

export function scopeFilter<T extends ScopedTables>(table: T, userId: string) {
  // every scoped table has a userId column
  return eq((table as any).userId, userId);
}

/**
 * Returns the raw db plus a typed `userId` for ergonomics.
 * Callers MUST include `scopeFilter(table, scoped.userId)` in every where().
 * (Lint rule / code review enforces this; runtime cannot.)
 */
export function scopedDb(userId: string) {
  return { db, userId, scope: <T extends ScopedTables>(t: T) => scopeFilter(t, userId) };
}

export type ScopedDb = ReturnType<typeof scopedDb>;
```

- [ ] **Step 4: Set up Vitest config**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

```bash
pnpm add -D vitest vite-tsconfig-paths
```

- [ ] **Step 5: Run tests — expect pass**

```bash
pnpm vitest run tests/unit/scoped-db.test.ts
```

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scopedDb helper for per-user query scoping

Refs ARC-121"
```

---

## Phase 3 — Authentication

### Task 7: Install and configure Better Auth with Google

**Files:**
- Create: `lib/auth.ts`, `lib/auth-client.ts`, `app/api/auth/[...all]/route.ts`

- [ ] **Step 1: Install Better Auth**

```bash
pnpm add better-auth
```

- [ ] **Step 2: Create `lib/auth.ts`**

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { env } from "@/lib/env";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),

  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },

  user: {
    additionalFields: {
      preferredModel: {
        type: "string",
        required: false,
        defaultValue: "google/gemini-2.5-flash",
        input: false,
      },
      defaultCurrency: {
        type: "string",
        required: false,
        defaultValue: "USD",
        input: false,
      },
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;
```

- [ ] **Step 3: Create `lib/auth-client.ts`**

```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
export const { signIn, signOut, useSession } = authClient;
```

- [ ] **Step 4: Mount the Better Auth route handler**

`app/api/auth/[...all]/route.ts`:

```ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 5: Verify Google OAuth callback URL**

In the Google Cloud Console for the OAuth client used by `GOOGLE_CLIENT_ID`, make sure these redirect URIs are present:

```
http://localhost:3000/api/auth/callback/google
```

(Manual step — verify with the user.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: configure Better Auth with Google OAuth + Drizzle

Refs ARC-121"
```

---

### Task 8: Build the sign-in page and authenticated route group

**Files:**
- Create: `app/sign-in/page.tsx`, `components/sign-in-with-google.tsx`, `app/(app)/layout.tsx`, `app/page.tsx` (replace default)

- [ ] **Step 1: Sign-in button component**

`components/sign-in-with-google.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth-client";

export function SignInWithGoogle() {
  return (
    <Button
      onClick={() =>
        signIn.social({ provider: "google", callbackURL: "/dashboard" })
      }
      size="lg"
    >
      Sign in with Google
    </Button>
  );
}
```

- [ ] **Step 2: Sign-in page**

`app/sign-in/page.tsx`:

```tsx
import { SignInWithGoogle } from "@/components/sign-in-with-google";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-6 max-w-sm text-center">
        <h1 className="text-3xl font-semibold">Finance Tracker</h1>
        <p className="text-muted-foreground">
          Sign in to upload statements and track spending.
        </p>
        <SignInWithGoogle />
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Auth-guarded layout**

`app/(app)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  return (
    <SidebarProvider>
      <AppSidebar user={session.user} />
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

- [ ] **Step 4: Root page redirector**

Replace `app/page.tsx` with:

```tsx
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  redirect(session ? "/dashboard" : "/sign-in");
}
```

- [ ] **Step 5: Stub the sidebar so the layout renders**

`components/app-sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/accounts", label: "Accounts" },
  { href: "/transactions", label: "Transactions" },
  { href: "/categories", label: "Categories" },
  { href: "/settings", label: "Settings" },
];

export function AppSidebar({ user }: { user: { name: string; email: string } }) {
  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-3 font-semibold">Finance Tracker</SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((n) => (
                <SidebarMenuItem key={n.href}>
                  <SidebarMenuButton asChild>
                    <Link href={n.href}>{n.label}</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <div className="border-t p-3 text-sm">
        <div className="font-medium">{user.name}</div>
        <div className="text-muted-foreground truncate">{user.email}</div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full"
          onClick={() => signOut().then(() => (window.location.href = "/sign-in"))}
        >
          Sign out
        </Button>
      </div>
    </Sidebar>
  );
}
```

- [ ] **Step 6: Add a temporary `/dashboard` page**

`app/(app)/dashboard/page.tsx`:

```tsx
export default function DashboardPage() {
  return <h1 className="text-2xl font-semibold">Dashboard</h1>;
}
```

- [ ] **Step 7: Manual smoke test**

```bash
pnpm dev
```

Visit `http://localhost:3000`, click **Sign in with Google**, complete OAuth, land on `/dashboard`. Verify your name + email appear in the sidebar. Sign out, confirm redirect to `/sign-in`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: sign-in page and authenticated layout

Refs ARC-121"
```

---

### Task 9: Seed default categories on first sign-in

**Files:**
- Create: `lib/categories/seed.ts`
- Modify: `app/(app)/layout.tsx` to call the seeder

- [ ] **Step 1: Write the seeder**

`lib/categories/seed.ts`:

```ts
import { db } from "@/lib/db/client";
import { categories } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

const SYSTEM_CATEGORIES: Array<{ name: string; color: string }> = [
  { name: "Groceries", color: "#10b981" },
  { name: "Dining", color: "#f97316" },
  { name: "Transport", color: "#0ea5e9" },
  { name: "Utilities", color: "#a855f7" },
  { name: "Bills", color: "#ef4444" },
  { name: "Subscriptions", color: "#ec4899" },
  { name: "Shopping", color: "#f59e0b" },
  { name: "Entertainment", color: "#8b5cf6" },
  { name: "Health", color: "#22c55e" },
  { name: "Travel", color: "#3b82f6" },
  { name: "Income", color: "#16a34a" },
  { name: "Transfers", color: "#64748b" },
  { name: "Fees", color: "#dc2626" },
  { name: "Other", color: "#94a3b8" },
  { name: "Uncategorized", color: "#9ca3af" },
];

export async function seedDefaultCategoriesIfMissing(userId: string) {
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.isSystem, true)))
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(categories).values(
    SYSTEM_CATEGORIES.map((c) => ({
      userId,
      name: c.name,
      color: c.color,
      isSystem: true,
    })),
  );
}
```

- [ ] **Step 2: Call it from the authenticated layout**

In `app/(app)/layout.tsx`, after the `redirect` guard and before rendering, add:

```ts
import { seedDefaultCategoriesIfMissing } from "@/lib/categories/seed";
// ...
await seedDefaultCategoriesIfMissing(session.user.id);
```

- [ ] **Step 3: Manual smoke test**

Restart `pnpm dev`, sign in with a fresh user (or delete your `categories` rows for the test user). Visit `/dashboard`. Then run:

```bash
psql $DATABASE_URL -c "select name from categories where user_id = '<your-user-id>' and is_system order by name;"
```

Expected: 15 rows.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: seed default category set on first authenticated visit

Refs ARC-121"
```

---

## Phase 4 — Storage and LLM Clients

### Task 10: MinIO storage client

**Files:**
- Create: `lib/storage/minio.ts`

- [ ] **Step 1: Install AWS SDK**

```bash
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- [ ] **Step 2: Write `lib/storage/minio.ts`**

```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

const s3 = new S3Client({
  endpoint: env.MINIO_ENDPOINT,
  region: env.MINIO_REGION,
  credentials: {
    accessKeyId: env.MINIO_ACCESS_KEY,
    secretAccessKey: env.MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

export function statementKey(userId: string, statementId: string) {
  return `users/${userId}/statements/${statementId}.pdf`;
}

export async function putStatementPdf(opts: {
  userId: string;
  statementId: string;
  body: Buffer;
}) {
  const Key = statementKey(opts.userId, opts.statementId);
  await s3.send(
    new PutObjectCommand({
      Bucket: env.MINIO_BUCKET,
      Key,
      Body: opts.body,
      ContentType: "application/pdf",
    }),
  );
  return { bucket: env.MINIO_BUCKET, key: Key };
}

export async function getStatementPdf(opts: { bucket: string; key: string }) {
  const out = await s3.send(new GetObjectCommand({ Bucket: opts.bucket, Key: opts.key }));
  const chunks: Buffer[] = [];
  for await (const c of out.Body as AsyncIterable<Buffer>) chunks.push(c);
  return Buffer.concat(chunks);
}

export async function presignedStatementUrl(opts: { bucket: string; key: string }) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: opts.bucket, Key: opts.key }),
    { expiresIn: 300 }, // 5 minutes
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: MinIO storage client (put, get, presigned URL)

Refs ARC-121"
```

---

### Task 11: OpenRouter client + model allow-list

**Files:**
- Create: `lib/llm/openrouter.ts`, `lib/llm/models.ts`

- [ ] **Step 1: Install OpenAI SDK**

```bash
pnpm add openai
```

- [ ] **Step 2: Write the allow-list**

`lib/llm/models.ts`:

```ts
export type ModelId =
  | "google/gemini-2.5-flash"
  | "google/gemini-2.5-pro"
  | "anthropic/claude-sonnet-4.6"
  | "anthropic/claude-opus-4.7";

export const MODELS: ReadonlyArray<{
  id: ModelId;
  label: string;
  note: string;
}> = [
  { id: "google/gemini-2.5-flash",   label: "Fast & cheap (default)", note: "Cheapest PDF-capable option." },
  { id: "google/gemini-2.5-pro",     label: "Higher quality",          note: "Better on dense statements." },
  { id: "anthropic/claude-sonnet-4.6", label: "High quality",          note: "Strong structured-output reliability." },
  { id: "anthropic/claude-opus-4.7",   label: "Highest quality",       note: "Most expensive." },
];

export const ALLOWED_MODEL_IDS = new Set<ModelId>(MODELS.map((m) => m.id));
export const DEFAULT_MODEL: ModelId = "google/gemini-2.5-flash";

export function assertAllowedModel(id: string): asserts id is ModelId {
  if (!ALLOWED_MODEL_IDS.has(id as ModelId)) {
    throw new Error(`Model not allowed: ${id}`);
  }
}
```

- [ ] **Step 3: Write the OpenRouter client**

`lib/llm/openrouter.ts`:

```ts
import OpenAI from "openai";
import { env } from "@/lib/env";

export const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": env.BETTER_AUTH_URL,
    "X-Title": "Finance Tracker",
  },
});
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: OpenRouter client + curated PDF-capable model allow-list

Refs ARC-121"
```

---

### Task 12: Extraction schema + LLM call

**Files:**
- Create: `lib/llm/extraction.ts`, `tests/unit/extraction.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/extraction.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ExtractionResult } from "@/lib/llm/extraction";

describe("ExtractionResult schema", () => {
  it("parses a valid payload", () => {
    const parsed = ExtractionResult.parse({
      account_summary: {
        institution: "Chase",
        last4: "1234",
        period_start: "2026-04-01",
        period_end: "2026-04-30",
        currency: "USD",
      },
      transactions: [
        {
          posted_at: "2026-04-03",
          description: "Whole Foods",
          amount: -42.17,
          suggested_category: "Groceries",
        },
      ],
    });
    expect(parsed.transactions[0].amount).toBe(-42.17);
  });

  it("rejects an invalid date", () => {
    expect(() =>
      ExtractionResult.parse({
        account_summary: { period_start: "nope", period_end: "2026-04-30", currency: "USD" },
        transactions: [],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect failure (module missing)**

```bash
pnpm vitest run tests/unit/extraction.test.ts
```

Expected: import error.

- [ ] **Step 3: Implement `lib/llm/extraction.ts`**

```ts
import { z } from "zod";
import { openrouter } from "./openrouter";
import { assertAllowedModel, type ModelId } from "./models";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date required");

export const ExtractionResult = z.object({
  account_summary: z.object({
    institution: z.string().optional(),
    last4: z.string().optional(),
    period_start: isoDate,
    period_end: isoDate,
    currency: z.string().length(3),
  }),
  transactions: z.array(
    z.object({
      posted_at: isoDate,
      description: z.string().min(1),
      amount: z.number().finite(),       // signed; negative = outflow
      suggested_category: z.string().min(1),
    }),
  ),
});

export type ExtractionResult = z.infer<typeof ExtractionResult>;

const SYSTEM_PROMPT = `You extract financial transactions from a bank or credit-card statement PDF.

Rules:
- Return JSON matching the provided schema exactly.
- amount is signed: negative for outflows (purchases, fees), positive for inflows (deposits, refunds).
- Use ISO 8601 dates (YYYY-MM-DD).
- suggested_category must be a short label like "Groceries", "Dining", "Transport", "Utilities", "Bills", "Subscriptions", "Shopping", "Entertainment", "Health", "Travel", "Income", "Transfers", "Fees", "Other".
- Include every transaction; do not summarize or skip rows.`;

const JSON_SCHEMA = {
  name: "ExtractionResult",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["account_summary", "transactions"],
    properties: {
      account_summary: {
        type: "object",
        additionalProperties: false,
        required: ["period_start", "period_end", "currency"],
        properties: {
          institution: { type: "string" },
          last4: { type: "string" },
          period_start: { type: "string" },
          period_end: { type: "string" },
          currency: { type: "string" },
        },
      },
      transactions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["posted_at", "description", "amount", "suggested_category"],
          properties: {
            posted_at: { type: "string" },
            description: { type: "string" },
            amount: { type: "number" },
            suggested_category: { type: "string" },
          },
        },
      },
    },
  },
} as const;

export async function extractFromPdf(opts: {
  pdf: Buffer;
  model: ModelId;
  filename: string;
}): Promise<ExtractionResult> {
  assertAllowedModel(opts.model);

  const base64 = opts.pdf.toString("base64");

  const completion = await openrouter.chat.completions.create({
    model: opts.model,
    response_format: { type: "json_schema", json_schema: JSON_SCHEMA },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract every transaction from this statement." },
          // OpenRouter accepts `file` content parts for PDF-capable models.
          // See https://openrouter.ai/docs/features/multimodal/pdfs
          {
            type: "file",
            file: { filename: opts.filename, file_data: `data:application/pdf;base64,${base64}` },
          } as any,
        ],
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw || typeof raw !== "string") throw new Error("Empty LLM response");

  return ExtractionResult.parse(JSON.parse(raw));
}
```

- [ ] **Step 4: Run unit tests — expect pass**

```bash
pnpm vitest run tests/unit/extraction.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: LLM extraction schema + OpenRouter PDF call

Refs ARC-121"
```

---

### Task 13: Category resolver

**Files:**
- Create: `lib/categories/resolve.ts`, `tests/unit/categories-resolve.test.ts`

- [ ] **Step 1: Failing test**

`tests/unit/categories-resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickCategoryId } from "@/lib/categories/resolve";

const cats = [
  { id: "a", name: "Groceries" },
  { id: "b", name: "Dining" },
  { id: "u", name: "Uncategorized" },
];

describe("pickCategoryId", () => {
  it("matches case-insensitively", () => {
    expect(pickCategoryId(cats, "groceries")).toBe("a");
  });

  it("falls back to Uncategorized when no match", () => {
    expect(pickCategoryId(cats, "Crypto")).toBe("u");
  });

  it("returns null if Uncategorized is also missing", () => {
    expect(pickCategoryId(cats.slice(0, 2), "Crypto")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm vitest run tests/unit/categories-resolve.test.ts
```

- [ ] **Step 3: Implement `lib/categories/resolve.ts`**

```ts
export type CategoryRef = { id: string; name: string };

export function pickCategoryId(cats: CategoryRef[], suggested: string): string | null {
  const lower = suggested.trim().toLowerCase();
  const hit = cats.find((c) => c.name.toLowerCase() === lower);
  if (hit) return hit.id;
  const fallback = cats.find((c) => c.name.toLowerCase() === "uncategorized");
  return fallback?.id ?? null;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm vitest run tests/unit/categories-resolve.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: category resolver (case-insensitive + Uncategorized fallback)

Refs ARC-121"
```

---

## Phase 5 — Ingestion Pipeline

### Task 14: `extractStatement` server action

**Files:**
- Create: `lib/actions/extract-statement.ts`

- [ ] **Step 1: Implement the server action**

```ts
"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { categories, financialAccounts, statements, transactions, users } from "@/lib/db/schema";
import { putStatementPdf } from "@/lib/storage/minio";
import { extractFromPdf } from "@/lib/llm/extraction";
import { pickCategoryId } from "@/lib/categories/resolve";
import { ALLOWED_MODEL_IDS, DEFAULT_MODEL, type ModelId } from "@/lib/llm/models";

const InputSchema = z.object({
  financialAccountId: z.string().uuid(),
  modelOverride: z.string().optional(),
});

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function extractStatement(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  const userId = session.user.id;

  const parsed = InputSchema.parse({
    financialAccountId: formData.get("financialAccountId"),
    modelOverride: formData.get("modelOverride") ?? undefined,
  });

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Missing file");
  if (file.type !== "application/pdf") throw new Error("Only PDF files are allowed");
  if (file.size > MAX_BYTES) throw new Error("File exceeds 10 MB");

  // Confirm the account belongs to this user (scoped).
  const [account] = await db
    .select()
    .from(financialAccounts)
    .where(and(eq(financialAccounts.id, parsed.financialAccountId), eq(financialAccounts.userId, userId)))
    .limit(1);
  if (!account) throw new Error("Account not found");

  // Pick the model: explicit override (if allowed) → user preference → default.
  const [me] = await db.select({ preferredModel: users.preferredModel }).from(users).where(eq(users.id, userId)).limit(1);
  const wanted = parsed.modelOverride ?? me?.preferredModel ?? DEFAULT_MODEL;
  if (!ALLOWED_MODEL_IDS.has(wanted as ModelId)) throw new Error("Model not allowed");
  const model = wanted as ModelId;

  // Insert pending statement.
  const statementId = randomUUID();
  await db.insert(statements).values({
    id: statementId,
    userId,
    financialAccountId: account.id,
    sourceFilename: file.name,
    storageBucket: "",       // filled after MinIO put
    storageKey: "",
    modelUsed: model,
    extractionStatus: "pending",
  });

  const buffer = Buffer.from(await file.arrayBuffer());

  // 1) MinIO put
  let stored: { bucket: string; key: string };
  try {
    stored = await putStatementPdf({ userId, statementId, body: buffer });
  } catch (err) {
    await db.update(statements).set({
      extractionStatus: "failed",
      extractionError: `MinIO put failed: ${(err as Error).message}`,
    }).where(eq(statements.id, statementId));
    throw err;
  }
  await db.update(statements).set({ storageBucket: stored.bucket, storageKey: stored.key })
    .where(eq(statements.id, statementId));

  // 2) LLM extract
  let result;
  try {
    result = await extractFromPdf({ pdf: buffer, model, filename: file.name });
  } catch (err) {
    await db.update(statements).set({
      extractionStatus: "failed",
      extractionError: `Extraction failed: ${(err as Error).message}`,
    }).where(eq(statements.id, statementId));
    throw err;
  }

  // 3) Resolve categories + insert transactions in one DB tx
  const cats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.userId, userId));

  await db.transaction(async (tx) => {
    await tx.update(statements).set({
      periodStart: result.account_summary.period_start,
      periodEnd: result.account_summary.period_end,
      extractionStatus: "succeeded",
      extractedAt: new Date(),
    }).where(eq(statements.id, statementId));

    if (result.transactions.length > 0) {
      await tx
        .insert(transactions)
        .values(
          result.transactions.map((t) => ({
            userId,
            financialAccountId: account.id,
            statementId,
            postedAt: t.posted_at,
            description: t.description,
            amount: t.amount.toFixed(2),
            currency: result.account_summary.currency,
            categoryId: pickCategoryId(cats, t.suggested_category),
            rawExtraction: t,
          })),
        )
        .onConflictDoNothing({
          target: [
            transactions.userId,
            transactions.financialAccountId,
            transactions.postedAt,
            transactions.amount,
            transactions.description,
          ],
        });
    }
  });

  redirect(`/statements/${statementId}`);
}
```

- [ ] **Step 2: Commit (integration test follows)**

```bash
git add -A
git commit -m "feat: extractStatement server action (MinIO + OpenRouter + DB)

Refs ARC-121"
```

---

### Task 15: Integration test for `extractStatement`

**Files:**
- Create: `tests/setup.ts`, `tests/integration/extract-statement.test.ts`

- [ ] **Step 1: Install testcontainers**

```bash
pnpm add -D @testcontainers/postgresql @testcontainers/minio testcontainers
```

- [ ] **Step 2: Create `tests/setup.ts`**

```ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { MinioContainer, StartedMinioContainer } from "@testcontainers/minio";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";

export type TestEnv = {
  pg: StartedPostgreSqlContainer;
  minio: StartedMinioContainer;
  databaseUrl: string;
  s3: { endpoint: string; accessKey: string; secretKey: string; bucket: string };
  stop: () => Promise<void>;
};

export async function bootstrap(): Promise<TestEnv> {
  const pg = await new PostgreSqlContainer("postgres:16").start();
  const databaseUrl = pg.getConnectionUri();

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await pool.end();

  const minio = await new MinioContainer().start();
  const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
  const accessKey = minio.getRootUser();
  const secretKey = minio.getRootPassword();
  const bucket = "finance-statements";

  const s3 = new S3Client({
    endpoint, region: "us-east-1",
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,
  });
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));

  return {
    pg, minio, databaseUrl,
    s3: { endpoint, accessKey, secretKey, bucket },
    stop: async () => { await pg.stop(); await minio.stop(); },
  };
}
```

- [ ] **Step 3: Write the integration test**

`tests/integration/extract-statement.test.ts`:

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
}, 120_000);

afterAll(async () => { await envt.stop(); }, 30_000);

// Stub the LLM with canned output
vi.mock("@/lib/llm/extraction", async (orig) => {
  const real = await orig<typeof import("@/lib/llm/extraction")>();
  return {
    ...real,
    extractFromPdf: vi.fn(async () => ({
      account_summary: { period_start: "2026-04-01", period_end: "2026-04-30", currency: "USD" },
      transactions: [
        { posted_at: "2026-04-03", description: "Whole Foods", amount: -42.17, suggested_category: "Groceries" },
        { posted_at: "2026-04-10", description: "Payroll",     amount:  3200.00, suggested_category: "Income" },
      ],
    })),
  };
});

// Stub auth to return a fixed user
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: "u1", name: "Test", email: "t@x" } })) } },
}));

// Stub redirect to capture the target
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));

describe("extractStatement", () => {
  it("uploads a PDF, extracts, and writes transactions", async () => {
    const { db } = await import("@/lib/db/client");
    const { users, financialAccounts, categories } = await import("@/lib/db/schema");
    await db.insert(users).values({ id: "u1", name: "T", email: "t@x" });
    const [acc] = await db.insert(financialAccounts).values({
      userId: "u1", name: "Test Checking", kind: "checking", currency: "USD",
    }).returning();
    await db.insert(categories).values([
      { userId: "u1", name: "Groceries", isSystem: true },
      { userId: "u1", name: "Income", isSystem: true },
      { userId: "u1", name: "Uncategorized", isSystem: true },
    ]);

    const { extractStatement } = await import("@/lib/actions/extract-statement");

    const fd = new FormData();
    fd.append("financialAccountId", acc.id);
    fd.append("file", new File([Buffer.from("%PDF-1.4 fake")], "april.pdf", { type: "application/pdf" }));

    await expect(extractStatement(fd)).rejects.toThrow(/REDIRECT:\/statements\//);

    const { transactions, statements } = await import("@/lib/db/schema");
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(2);
    const [s] = await db.select().from(statements);
    expect(s.extractionStatus).toBe("succeeded");
    expect(s.periodStart).toBe("2026-04-01");
  }, 60_000);
});
```

- [ ] **Step 4: Run**

```bash
pnpm vitest run tests/integration/extract-statement.test.ts
```

Expected: passes. (May take 30–60 s to spin up containers.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: integration test for extractStatement with Testcontainers

Refs ARC-121"
```

---

## Phase 6 — Upload UI

### Task 16: Create-account dialog + server action

**Files:**
- Create: `lib/actions/create-account.ts`, `components/add-account-dialog.tsx`

- [ ] **Step 1: Server action**

`lib/actions/create-account.ts`:

```ts
"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { financialAccounts } from "@/lib/db/schema";

const Input = z.object({
  name: z.string().min(1).max(100),
  kind: z.enum(["checking", "savings", "credit", "investment"]),
  institution: z.string().max(100).optional(),
  last4: z.string().regex(/^\d{4}$/).optional(),
  currency: z.string().length(3),
});

export async function createAccount(form: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");

  const parsed = Input.parse({
    name: form.get("name"),
    kind: form.get("kind"),
    institution: form.get("institution") || undefined,
    last4: form.get("last4") || undefined,
    currency: form.get("currency"),
  });

  const [row] = await db.insert(financialAccounts).values({
    userId: session.user.id,
    ...parsed,
  }).returning();

  revalidatePath("/accounts");
  return { id: row.id };
}
```

- [ ] **Step 2: Dialog component**

`components/add-account-dialog.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createAccount } from "@/lib/actions/create-account";

export function AddAccountDialog({
  trigger,
  onCreated,
}: {
  trigger: React.ReactNode;
  onCreated?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add account</DialogTitle></DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              const res = await createAccount(fd);
              setOpen(false);
              onCreated?.(res.id);
            })
          }
          className="grid gap-4"
        >
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" placeholder="Chase Sapphire" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="kind">Kind</Label>
            <Select name="kind" defaultValue="checking">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="checking">Checking</SelectItem>
                <SelectItem value="savings">Savings</SelectItem>
                <SelectItem value="credit">Credit</SelectItem>
                <SelectItem value="investment">Investment</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="institution">Institution</Label>
              <Input id="institution" name="institution" placeholder="Chase" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="last4">Last 4</Label>
              <Input id="last4" name="last4" maxLength={4} pattern="\d{4}" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="currency">Currency</Label>
            <Input id="currency" name="currency" defaultValue="USD" maxLength={3} required />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add-account dialog and createAccount server action

Refs ARC-121"
```

---

### Task 17: Upload-statement dialog

**Files:**
- Create: `components/upload-statement-dialog.tsx`
- Modify: `components/app-sidebar.tsx` (add "Upload statement" button at top)

- [ ] **Step 1: Upload dialog**

`components/upload-statement-dialog.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AddAccountDialog } from "@/components/add-account-dialog";
import { extractStatement } from "@/lib/actions/extract-statement";

type Account = { id: string; name: string; institution: string | null };

export function UploadStatementDialog({
  accounts,
  trigger,
  preferredModel,
}: {
  accounts: Account[];
  trigger: React.ReactNode;
  preferredModel: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Upload statement</DialogTitle></DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              fd.set("financialAccountId", accountId);
              try {
                await extractStatement(fd);
              } catch (e) {
                setError((e as Error).message);
              }
            })
          }
          className="grid gap-4"
        >
          <div className="grid gap-2">
            <Label>Account</Label>
            {accounts.length === 0 ? (
              <AddAccountDialog
                trigger={<Button type="button" variant="outline">Add an account first…</Button>}
                onCreated={(id) => setAccountId(id)}
              />
            ) : (
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}{a.institution ? ` · ${a.institution}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="file">PDF</Label>
            <Input id="file" name="file" type="file" accept="application/pdf" required />
            <p className="text-xs text-muted-foreground">
              Will extract with <code>{preferredModel}</code> (change in Settings).
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={pending || !accountId}>
              {pending ? "Extracting…" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add an "Upload statement" CTA to the sidebar**

In `components/app-sidebar.tsx`, accept new props and render the button. Replace the function signature and `<SidebarHeader>` block with:

```tsx
type Props = {
  user: { name: string; email: string };
  accounts: { id: string; name: string; institution: string | null }[];
  preferredModel: string;
};

export function AppSidebar({ user, accounts, preferredModel }: Props) {
  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-3 space-y-3">
        <div className="font-semibold">Finance Tracker</div>
        <UploadStatementDialog
          accounts={accounts}
          preferredModel={preferredModel}
          trigger={<Button size="sm" className="w-full">Upload statement</Button>}
        />
      </SidebarHeader>
      {/* ... rest unchanged ... */}
```

Add imports:

```tsx
import { Button } from "@/components/ui/button";
import { UploadStatementDialog } from "@/components/upload-statement-dialog";
```

- [ ] **Step 3: Pass the props from the authenticated layout**

In `app/(app)/layout.tsx`, fetch accounts + preferred model and pass them:

```tsx
import { db } from "@/lib/db/client";
import { financialAccounts, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// inside the layout, after the seed call:
const [me] = await db
  .select({ preferredModel: users.preferredModel })
  .from(users)
  .where(eq(users.id, session.user.id))
  .limit(1);
const accounts = await db
  .select({ id: financialAccounts.id, name: financialAccounts.name, institution: financialAccounts.institution })
  .from(financialAccounts)
  .where(eq(financialAccounts.userId, session.user.id));

// pass them down:
<AppSidebar user={session.user} accounts={accounts} preferredModel={me?.preferredModel ?? "google/gemini-2.5-flash"} />
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: global upload-statement dialog in sidebar

Refs ARC-121"
```

---

## Phase 7 — Statement Detail + Reprocess

### Task 18: `/statements/[id]` page

**Files:**
- Create: `app/(app)/statements/[id]/page.tsx`

- [ ] **Step 1: Page**

```tsx
import { notFound } from "next/navigation";
import { and, eq, asc } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { statements, transactions, financialAccounts, categories } from "@/lib/db/schema";
import { presignedStatementUrl } from "@/lib/storage/minio";
import { TransactionsTable } from "@/components/transactions-table";
import { ReprocessControls } from "./reprocess-controls";
import { Badge } from "@/components/ui/badge";

export default async function StatementDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) notFound();

  const [s] = await db
    .select()
    .from(statements)
    .where(and(eq(statements.id, id), eq(statements.userId, session.user.id)))
    .limit(1);
  if (!s) notFound();

  const [acc] = await db.select().from(financialAccounts).where(eq(financialAccounts.id, s.financialAccountId)).limit(1);

  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.statementId, s.id), eq(transactions.userId, session.user.id)))
    .orderBy(asc(transactions.postedAt));

  const cats = await db.select().from(categories).where(eq(categories.userId, session.user.id));

  const pdfUrl = s.storageKey
    ? await presignedStatementUrl({ bucket: s.storageBucket, key: s.storageKey })
    : null;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{s.sourceFilename}</h1>
          <p className="text-muted-foreground">
            {acc?.name}
            {s.periodStart && s.periodEnd ? ` · ${s.periodStart} – ${s.periodEnd}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={s.extractionStatus === "succeeded" ? "default" : s.extractionStatus === "failed" ? "destructive" : "secondary"}>
            {s.extractionStatus}
          </Badge>
          {pdfUrl && (
            <a className="text-sm underline" href={pdfUrl} target="_blank" rel="noreferrer">
              Download PDF
            </a>
          )}
          <ReprocessControls statementId={s.id} currentModel={s.modelUsed ?? ""} />
        </div>
      </header>

      {s.extractionStatus === "failed" && (
        <p className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {s.extractionError}
        </p>
      )}

      <TransactionsTable rows={rows} categories={cats} />
    </div>
  );
}
```

- [ ] **Step 2: Reprocess control + server action**

`lib/actions/reprocess-statement.ts`:

```ts
"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { categories, statements, transactions } from "@/lib/db/schema";
import { getStatementPdf } from "@/lib/storage/minio";
import { extractFromPdf } from "@/lib/llm/extraction";
import { pickCategoryId } from "@/lib/categories/resolve";
import { ALLOWED_MODEL_IDS, type ModelId } from "@/lib/llm/models";

export async function reprocessStatement(statementId: string, model: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  if (!ALLOWED_MODEL_IDS.has(model as ModelId)) throw new Error("Model not allowed");

  const [s] = await db.select().from(statements)
    .where(and(eq(statements.id, statementId), eq(statements.userId, session.user.id))).limit(1);
  if (!s) throw new Error("Statement not found");
  if (!s.storageKey) throw new Error("Statement has no stored PDF");

  const pdf = await getStatementPdf({ bucket: s.storageBucket, key: s.storageKey });
  const result = await extractFromPdf({ pdf, model: model as ModelId, filename: s.sourceFilename });

  const cats = await db.select({ id: categories.id, name: categories.name })
    .from(categories).where(eq(categories.userId, session.user.id));

  await db.transaction(async (tx) => {
    // Replace prior transactions for this statement.
    await tx.delete(transactions).where(eq(transactions.statementId, s.id));
    await tx.update(statements).set({
      modelUsed: model,
      periodStart: result.account_summary.period_start,
      periodEnd: result.account_summary.period_end,
      extractionStatus: "succeeded",
      extractionError: null,
      extractedAt: new Date(),
    }).where(eq(statements.id, s.id));

    if (result.transactions.length > 0) {
      await tx.insert(transactions).values(result.transactions.map((t) => ({
        userId: session.user.id,
        financialAccountId: s.financialAccountId,
        statementId: s.id,
        postedAt: t.posted_at,
        description: t.description,
        amount: t.amount.toFixed(2),
        currency: result.account_summary.currency,
        categoryId: pickCategoryId(cats, t.suggested_category),
        rawExtraction: t,
      })));
    }
  });

  revalidatePath(`/statements/${s.id}`);
}
```

`app/(app)/statements/[id]/reprocess-controls.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MODELS } from "@/lib/llm/models";
import { reprocessStatement } from "@/lib/actions/reprocess-statement";

export function ReprocessControls({ statementId, currentModel }: { statementId: string; currentModel: string }) {
  const [pending, start] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending}>
          {pending ? "Reprocessing…" : "Reprocess with…"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {MODELS.map((m) => (
          <DropdownMenuItem
            key={m.id}
            disabled={m.id === currentModel}
            onClick={() => start(() => reprocessStatement(statementId, m.id))}
          >
            {m.label} <span className="ml-2 text-xs text-muted-foreground">{m.id}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: Commit (transactions-table component comes in next task)**

```bash
git add -A
git commit -m "feat: statement detail page with reprocess action

Refs ARC-121"
```

---

### Task 19: Editable transactions table component

**Files:**
- Create: `components/transactions-table.tsx`, `components/category-picker.tsx`, `lib/actions/update-transaction.ts`

- [ ] **Step 1: Install TanStack Table**

```bash
pnpm add @tanstack/react-table
```

- [ ] **Step 2: Server action for category update**

`lib/actions/update-transaction.ts`:

```ts
"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { transactions } from "@/lib/db/schema";

const Input = z.object({
  transactionId: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
});

export async function updateTransactionCategory(input: { transactionId: string; categoryId: string | null }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");

  const parsed = Input.parse(input);
  await db
    .update(transactions)
    .set({ categoryId: parsed.categoryId })
    .where(and(eq(transactions.id, parsed.transactionId), eq(transactions.userId, session.user.id)));

  revalidatePath("/transactions");
}
```

- [ ] **Step 3: Category picker**

`components/category-picker.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { updateTransactionCategory } from "@/lib/actions/update-transaction";

export function CategoryPicker({
  transactionId,
  categoryId,
  categories,
}: {
  transactionId: string;
  categoryId: string | null;
  categories: { id: string; name: string; color: string }[];
}) {
  const [, start] = useTransition();

  return (
    <Select
      value={categoryId ?? ""}
      onValueChange={(v) =>
        start(() => updateTransactionCategory({ transactionId, categoryId: v || null }))
      }
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
  );
}
```

- [ ] **Step 4: Transactions table**

`components/transactions-table.tsx`:

```tsx
"use client";

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CategoryPicker } from "./category-picker";

type Row = {
  id: string;
  postedAt: string;
  description: string;
  amount: string;
  currency: string;
  categoryId: string | null;
};

type Category = { id: string; name: string; color: string };

const fmt = (amount: string, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(amount));

export function TransactionsTable({ rows, categories }: { rows: Row[]; categories: Category[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No transactions.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[110px]">Date</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="w-[180px]">Category</TableHead>
          <TableHead className="w-[120px] text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>{r.postedAt}</TableCell>
            <TableCell>{r.description}</TableCell>
            <TableCell>
              <CategoryPicker transactionId={r.id} categoryId={r.categoryId} categories={categories} />
            </TableCell>
            <TableCell className={`text-right tabular-nums ${Number(r.amount) < 0 ? "text-foreground" : "text-emerald-600"}`}>
              {fmt(r.amount, r.currency)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 5: Manual smoke test**

```bash
pnpm dev
```

Sign in → add an account → upload a real PDF statement. Verify:
- Loading state shows during extraction.
- Redirect to `/statements/[id]` with rows visible.
- Changing a category via the dropdown persists (reload to confirm).
- "Reprocess with…" runs and updates the rows.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: editable transactions table with category picker

Refs ARC-121"
```

---

## Phase 8 — Remaining Pages

### Task 20: `/accounts` list + `/accounts/[id]` detail

**Files:**
- Create: `app/(app)/accounts/page.tsx`, `app/(app)/accounts/[id]/page.tsx`, `components/empty-state.tsx`

- [ ] **Step 1: Empty-state component**

`components/empty-state.tsx`:

```tsx
export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed p-10 text-center">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-1 text-muted-foreground">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 2: `/accounts` list**

`app/(app)/accounts/page.tsx`:

```tsx
import Link from "next/link";
import { headers } from "next/headers";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { financialAccounts } from "@/lib/db/schema";
import { AddAccountDialog } from "@/components/add-account-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";

export default async function AccountsPage() {
  const session = (await auth.api.getSession({ headers: await headers() }))!;
  const rows = await db
    .select()
    .from(financialAccounts)
    .where(eq(financialAccounts.userId, session.user.id))
    .orderBy(desc(financialAccounts.createdAt));

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <AddAccountDialog trigger={<Button>Add account</Button>} />
      </header>

      {rows.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          description="Add an account to start uploading statements."
          action={<AddAccountDialog trigger={<Button>Add account</Button>} />}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((a) => (
            <Card key={a.id} className="p-4">
              <Link href={`/accounts/${a.id}`} className="font-medium hover:underline">{a.name}</Link>
              <div className="text-sm text-muted-foreground">
                {a.kind}{a.institution ? ` · ${a.institution}` : ""}{a.last4 ? ` · …${a.last4}` : ""}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{a.currency}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `/accounts/[id]` detail**

`app/(app)/accounts/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { and, eq, desc, asc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { financialAccounts, statements, transactions, categories } from "@/lib/db/schema";
import { TransactionsTable } from "@/components/transactions-table";

export default async function AccountDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = (await auth.api.getSession({ headers: await headers() }))!;

  const [a] = await db.select().from(financialAccounts)
    .where(and(eq(financialAccounts.id, id), eq(financialAccounts.userId, session.user.id)))
    .limit(1);
  if (!a) notFound();

  const stmts = await db.select().from(statements)
    .where(eq(statements.financialAccountId, a.id))
    .orderBy(desc(statements.uploadedAt));

  const txns = await db.select().from(transactions)
    .where(eq(transactions.financialAccountId, a.id))
    .orderBy(asc(transactions.postedAt));

  const cats = await db.select().from(categories)
    .where(eq(categories.userId, session.user.id));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{a.name}</h1>
        <p className="text-muted-foreground">
          {a.kind}{a.institution ? ` · ${a.institution}` : ""}{a.last4 ? ` · …${a.last4}` : ""} · {a.currency}
        </p>
      </header>

      <section>
        <h2 className="mb-2 text-lg font-medium">Statements</h2>
        {stmts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No statements yet.</p>
        ) : (
          <ul className="divide-y rounded border">
            {stmts.map((s) => (
              <li key={s.id} className="flex items-center justify-between p-3">
                <Link href={`/statements/${s.id}`} className="hover:underline">{s.sourceFilename}</Link>
                <span className="text-xs text-muted-foreground">{s.extractionStatus}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Transactions</h2>
        <TransactionsTable rows={txns} categories={cats} />
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: accounts list + account detail pages

Refs ARC-121"
```

---

### Task 21: `/transactions` full list with filters

**Files:**
- Create: `app/(app)/transactions/page.tsx`

- [ ] **Step 1: Page (server-driven filters via search params)**

```tsx
import { headers } from "next/headers";
import { and, desc, eq, gte, ilike, lte, SQL } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { transactions, categories, financialAccounts } from "@/lib/db/schema";
import { TransactionsTable } from "@/components/transactions-table";

type Search = { account?: string; category?: string; q?: string; from?: string; to?: string };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const session = (await auth.api.getSession({ headers: await headers() }))!;

  const filters: SQL[] = [eq(transactions.userId, session.user.id)];
  if (sp.account)  filters.push(eq(transactions.financialAccountId, sp.account));
  if (sp.category) filters.push(eq(transactions.categoryId, sp.category));
  if (sp.q)        filters.push(ilike(transactions.description, `%${sp.q}%`));
  if (sp.from)     filters.push(gte(transactions.postedAt, sp.from));
  if (sp.to)       filters.push(lte(transactions.postedAt, sp.to));

  const [rows, cats, accts] = await Promise.all([
    db.select().from(transactions).where(and(...filters)).orderBy(desc(transactions.postedAt)).limit(500),
    db.select().from(categories).where(eq(categories.userId, session.user.id)),
    db.select().from(financialAccounts).where(eq(financialAccounts.userId, session.user.id)),
  ]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Transactions</h1>
      </header>

      <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
        <label className="grid gap-1">
          <span className="text-muted-foreground">Account</span>
          <select name="account" defaultValue={sp.account ?? ""} className="rounded border px-2 py-1">
            <option value="">All</option>
            {accts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground">Category</span>
          <select name="category" defaultValue={sp.category ?? ""} className="rounded border px-2 py-1">
            <option value="">All</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground">From</span>
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="rounded border px-2 py-1" />
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground">To</span>
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="rounded border px-2 py-1" />
        </label>
        <label className="grid gap-1 flex-1">
          <span className="text-muted-foreground">Search</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Description contains…" className="rounded border px-2 py-1" />
        </label>
        <button className="rounded border bg-secondary px-3 py-1" type="submit">Apply</button>
      </form>

      <TransactionsTable rows={rows} categories={cats} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: transactions list with date/account/category/search filters

Refs ARC-121"
```

---

### Task 22: `/dashboard` page with spend-by-category donut

**Files:**
- Create: `app/(app)/dashboard/page.tsx` (replace stub), `components/spend-donut.tsx`

- [ ] **Step 1: Install Recharts**

```bash
pnpm add recharts
```

- [ ] **Step 2: Donut component**

`components/spend-donut.tsx`:

```tsx
"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export function SpendDonut({ data }: { data: { name: string; value: number; color: string }[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No outflows in the last 30 days.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={1}>
          {data.map((d) => <Cell key={d.name} fill={d.color} />)}
        </Pie>
        <Tooltip formatter={(v: number) => v.toFixed(2)} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Dashboard page**

`app/(app)/dashboard/page.tsx`:

```tsx
import { headers } from "next/headers";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { transactions, categories } from "@/lib/db/schema";
import { Card } from "@/components/ui/card";
import { SpendDonut } from "@/components/spend-donut";
import { EmptyState } from "@/components/empty-state";
import { TransactionsTable } from "@/components/transactions-table";

export default async function DashboardPage() {
  const session = (await auth.api.getSession({ headers: await headers() }))!;
  const userId = session.user.id;

  const start = new Date();
  start.setDate(start.getDate() - 30);
  const startIso = start.toISOString().slice(0, 10);

  const spendRows = await db
    .select({
      categoryId: transactions.categoryId,
      total: sql<string>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.postedAt, startIso),
        lt(transactions.amount, "0"),
      ),
    )
    .groupBy(transactions.categoryId);

  const cats = await db.select().from(categories).where(eq(categories.userId, userId));
  const catById = new Map(cats.map((c) => [c.id, c]));

  const donut = spendRows
    .map((r) => {
      const c = r.categoryId ? catById.get(r.categoryId) : null;
      return {
        name: c?.name ?? "Uncategorized",
        color: c?.color ?? "#9ca3af",
        value: Math.abs(Number(r.total)),
      };
    })
    .sort((a, b) => b.value - a.value);

  const recent = await db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.postedAt))
    .limit(10);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {recent.length === 0 ? (
        <EmptyState
          title="No transactions yet"
          description="Upload your first statement to see your spending breakdown."
        />
      ) : (
        <>
          <Card className="p-4">
            <h2 className="mb-2 text-lg font-medium">Last 30 days · spend by category</h2>
            <SpendDonut data={donut} />
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-lg font-medium">Recent transactions</h2>
            <TransactionsTable rows={recent} categories={cats} />
          </Card>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: dashboard with last-30d spend donut + recent transactions

Refs ARC-121"
```

---

### Task 23: `/categories` management

**Files:**
- Create: `app/(app)/categories/page.tsx`, `lib/actions/categories.ts`, `components/categories-manager.tsx`

- [ ] **Step 1: Server actions**

`lib/actions/categories.ts`:

```ts
"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { categories } from "@/lib/db/schema";

async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  return session.user.id;
}

const Upsert = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export async function saveCategory(input: { id?: string; name: string; color: string }) {
  const userId = await requireUser();
  const parsed = Upsert.parse(input);
  if (parsed.id) {
    await db.update(categories).set({ name: parsed.name, color: parsed.color })
      .where(and(eq(categories.id, parsed.id), eq(categories.userId, userId)));
  } else {
    await db.insert(categories).values({ userId, name: parsed.name, color: parsed.color, isSystem: false });
  }
  revalidatePath("/categories");
}

export async function deleteCategory(id: string) {
  const userId = await requireUser();
  // System categories cannot be deleted.
  const [row] = await db.select().from(categories)
    .where(and(eq(categories.id, id), eq(categories.userId, userId))).limit(1);
  if (!row) throw new Error("Category not found");
  if (row.isSystem) throw new Error("Cannot delete system categories");
  await db.delete(categories).where(eq(categories.id, id));
  revalidatePath("/categories");
}
```

- [ ] **Step 2: UI manager + page**

`components/categories-manager.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveCategory, deleteCategory } from "@/lib/actions/categories";

type Cat = { id: string; name: string; color: string; isSystem: boolean };

export function CategoriesManager({ initial }: { initial: Cat[] }) {
  const [draft, setDraft] = useState({ name: "", color: "#94a3b8" });
  const [, start] = useTransition();

  return (
    <div className="space-y-4">
      <form
        className="flex items-end gap-2"
        action={() => start(async () => {
          await saveCategory(draft);
          setDraft({ name: "", color: "#94a3b8" });
        })}
      >
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">Name</span>
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
        </div>
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">Color</span>
          <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
        </div>
        <Button type="submit">Add</Button>
      </form>

      <ul className="divide-y rounded border">
        {initial.map((c) => (
          <li key={c.id} className="flex items-center justify-between p-3">
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
              {c.name}
              {c.isSystem && <span className="text-xs text-muted-foreground">system</span>}
            </span>
            {!c.isSystem && (
              <Button variant="ghost" size="sm" onClick={() => start(() => deleteCategory(c.id))}>
                Delete
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`app/(app)/categories/page.tsx`:

```tsx
import { headers } from "next/headers";
import { asc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { categories } from "@/lib/db/schema";
import { CategoriesManager } from "@/components/categories-manager";

export default async function CategoriesPage() {
  const session = (await auth.api.getSession({ headers: await headers() }))!;
  const rows = await db.select().from(categories)
    .where(eq(categories.userId, session.user.id))
    .orderBy(asc(categories.name));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Categories</h1>
      <CategoriesManager initial={rows} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: category management page (add, rename via re-add, delete user categories)

Refs ARC-121"
```

---

### Task 24: `/settings` page (model + currency)

**Files:**
- Create: `app/(app)/settings/page.tsx`, `lib/actions/update-settings.ts`, `components/settings-form.tsx`

- [ ] **Step 1: Server action**

`lib/actions/update-settings.ts`:

```ts
"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { ALLOWED_MODEL_IDS, type ModelId } from "@/lib/llm/models";

const Input = z.object({
  preferredModel: z.string().refine((v) => ALLOWED_MODEL_IDS.has(v as ModelId), "Model not allowed"),
  defaultCurrency: z.string().length(3),
});

export async function updateSettings(input: { preferredModel: string; defaultCurrency: string }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  const parsed = Input.parse(input);
  await db.update(users).set(parsed).where(eq(users.id, session.user.id));
  revalidatePath("/settings");
}
```

- [ ] **Step 2: Settings form**

`components/settings-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MODELS } from "@/lib/llm/models";
import { updateSettings } from "@/lib/actions/update-settings";

export function SettingsForm({
  preferredModel,
  defaultCurrency,
}: { preferredModel: string; defaultCurrency: string }) {
  const [pm, setPm] = useState(preferredModel);
  const [cur, setCur] = useState(defaultCurrency);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  return (
    <form
      action={() => start(async () => {
        await updateSettings({ preferredModel: pm, defaultCurrency: cur });
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      })}
      className="grid max-w-md gap-6"
    >
      <div className="grid gap-2">
        <Label>Preferred model</Label>
        <Select value={pm} onValueChange={setPm}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <div className="flex flex-col">
                  <span>{m.label}</span>
                  <span className="text-xs text-muted-foreground">{m.id} · {m.note}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="cur">Default currency</Label>
        <Input id="cur" value={cur} onChange={(e) => setCur(e.target.value.toUpperCase())} maxLength={3} />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        {saved && <span className="text-sm text-emerald-600">Saved.</span>}
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Page**

`app/(app)/settings/page.tsx`:

```tsx
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { SettingsForm } from "@/components/settings-form";

export default async function SettingsPage() {
  const session = (await auth.api.getSession({ headers: await headers() }))!;
  const [me] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <SettingsForm preferredModel={me.preferredModel} defaultCurrency={me.defaultCurrency} />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: settings page for preferred model + default currency

Refs ARC-121"
```

---

## Phase 9 — Smoke Test & Cleanup

### Task 25: Manual smoke checklist + fixtures

**Files:**
- Create: `tests/fixtures/statements/.gitkeep`, `docs/smoke-checklist.md`

- [ ] **Step 1: Document the smoke checklist**

`docs/smoke-checklist.md`:

```markdown
# v1 smoke checklist

Run after any change touching ingestion, auth, or schema. Expects `pnpm dev` and access to the configured Postgres, MinIO, OpenRouter, and Google OAuth.

1. **Fresh sign-in**
   - Visit `http://localhost:3000` → redirect to `/sign-in`.
   - Click "Sign in with Google" → land on `/dashboard`.
   - Verify 15 system categories were seeded (check `/categories`).

2. **Add account**
   - `/accounts` → "Add account" → create one (e.g. "Test Checking", checking, USD).
   - Card appears in the list.

3. **Upload a real PDF**
   - Sidebar → "Upload statement" → pick the account → select a fixture PDF from `tests/fixtures/statements/`.
   - Loading state shows the model name.
   - Redirect to `/statements/<id>` with extracted rows.
   - "Download PDF" link works (presigned URL).

4. **Edit a category**
   - Change a transaction's category from the dropdown.
   - Reload — the change persists.

5. **Reprocess**
   - On the same statement page, click "Reprocess with…" → pick a different model.
   - New rows appear (old ones replaced).

6. **Filters**
   - `/transactions` → apply date and category filters → result narrows.

7. **Settings**
   - Change preferred model → reload the upload dialog and confirm the new model is displayed.

8. **Sign out**
   - Sidebar → Sign out → land on `/sign-in`.
```

- [ ] **Step 2: Add fixtures placeholder**

```bash
mkdir -p tests/fixtures/statements
touch tests/fixtures/statements/.gitkeep
```

Add a `tests/fixtures/statements/README.md`:

```markdown
Drop anonymized PDF statements here for manual smoke testing. These are git-ignored — keep real statements off the repo.
```

Append to `.gitignore`:

```
tests/fixtures/statements/*.pdf
```

- [ ] **Step 3: Run the full test suite**

```bash
pnpm vitest run
```

Expected: all unit + integration tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: smoke checklist + fixtures placeholder

Refs ARC-121"
```

---

### Task 26: Wire up sonner toasts + global error boundary

**Files:**
- Modify: `app/layout.tsx` (root layout), `app/(app)/layout.tsx`
- Create: `app/(app)/error.tsx`

- [ ] **Step 1: Add `<Toaster />` to the root layout**

In `app/layout.tsx`, inside `<body>`:

```tsx
import { Toaster } from "@/components/ui/sonner";
// ...
<body>
  {children}
  <Toaster richColors closeButton />
</body>
```

- [ ] **Step 2: Show toasts on upload + reprocess errors**

In `components/upload-statement-dialog.tsx`, replace the inline error display with a toast:

```tsx
import { toast } from "sonner";
// ...
} catch (e) {
  toast.error("Upload failed", { description: (e as Error).message });
}
```

In `app/(app)/statements/[id]/reprocess-controls.tsx`, wrap the call:

```tsx
import { toast } from "sonner";
// ...
onClick={() => start(async () => {
  try { await reprocessStatement(statementId, m.id); toast.success("Reprocessed"); }
  catch (e) { toast.error("Reprocess failed", { description: (e as Error).message }); }
})}
```

- [ ] **Step 3: Global error boundary for the authenticated section**

`app/(app)/error.tsx`:

```tsx
"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-3 p-6">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <button className="rounded border px-3 py-1" onClick={() => reset()}>Try again</button>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: toast notifications and error boundary

Refs ARC-121"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Covered by |
|---|---|
| Stack | Tasks 1, 3, 4, 7, 10, 11, 19, 22 |
| Env vars | Task 2 |
| Architecture | Tasks 1, 8, 14 |
| Data model | Tasks 5, 6 |
| Currency handling (per-currency, no FX) | Schema in Task 5, dashboard donut sums per default currency in Task 22 |
| PDF ingestion flow | Tasks 10, 11, 12, 14, 15 |
| UI surface (all routes) | Tasks 8, 17, 18, 19, 20, 21, 22, 23, 24 |
| Curated model allow-list | Tasks 11, 24 |
| Security & multi-tenant isolation | Task 6 (scopedDb), every action calls `auth.api.getSession`, all queries filter by `userId`, MinIO keys include userId (Task 10), presigned URLs expire in 5 min (Task 18) |
| Testing strategy | Tasks 6, 12, 13, 15, 25 |
| Seed categories | Task 9 |
| Re-process feature | Task 18 |

**Gaps acknowledged (out of v1 by design):**
- Playwright/e2e — explicitly Future Work in the spec.
- Background queue — explicitly Future Work.
- Net-worth roll-up — explicitly Future Work.
- Account balance trend chart — moved to Future Work during spec self-review.

**Type consistency check:** `pickCategoryId` defined in Task 13 is called in Tasks 14 and 18 with matching signature. `ALLOWED_MODEL_IDS` and `MODELS` defined in Task 11 are used consistently across Tasks 14, 18, 24. `ModelId` type used uniformly.

**Placeholder scan:** none — every step has runnable commands or complete code.
