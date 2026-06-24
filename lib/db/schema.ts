import { relations } from "drizzle-orm";
import {
  pgTable, text, timestamp, boolean, uuid, date, numeric, jsonb, uniqueIndex, index,
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
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
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

export const statements = pgTable(
  "statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    financialAccountId: uuid("financial_account_id").notNull().references(() => financialAccounts.id, { onDelete: "cascade" }),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    sourceFilename: text("source_filename").notNull(),
    storageBucket: text("storage_bucket").notNull(),
    storageKey: text("storage_key").notNull(),
    contentHash: text("content_hash"),
    openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }),
    closingBalance: numeric("closing_balance", { precision: 14, scale: 2 }),
    reconciliationStatus: text("reconciliation_status", {
      enum: ["reconciled", "discrepancy", "not_available", "not_applicable"],
    }),
    reconciliationDelta: numeric("reconciliation_delta", { precision: 14, scale: 2 }),
    modelUsed: text("model_used"),
    extractionStatus: text("extraction_status", { enum: ["pending", "succeeded", "failed"] }).notNull().default("pending"),
    extractionError: text("extraction_error"),
    uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
    extractedAt: timestamp("extracted_at"),
  },
  (t) => ({
    userContentHashIdx: index("statements_user_content_hash").on(t.userId, t.contentHash),
  }),
);

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
    direction: text("direction", { enum: ["outflow", "inflow", "transfer"] }).notNull().default("outflow"),
    currency: text("currency").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    categorySource: text("category_source", {
      enum: ["suggested", "rule", "manual"],
    }).notNull().default("suggested"),
    merchant: text("merchant"),
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
  period: text("period").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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

// ─── Relations ───────────────────────────────────────────────────────

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
