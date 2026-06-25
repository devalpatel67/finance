"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { categories, categoryRules, financialAccounts, statements, transactions, users } from "@/lib/db/schema";
import { putStatementPdf } from "@/lib/storage/minio";
import { sha256Hex } from "@/lib/statements/hash";
import { extractFromPdf, resolveDirection } from "@/lib/llm/extraction";
import { resolveCategory } from "@/lib/categories/resolve";
import { resolveAccount, findBucketAccount } from "@/lib/accounts/resolve-account";
import { ALLOWED_MODEL_IDS, DEFAULT_MODEL, type ModelId } from "@/lib/llm/models";
import { reconcile, type ReconciliationStatus } from "@/lib/statements/reconcile";

const InputSchema = z.object({
  financialAccountId: z.string().uuid().optional(),
  modelOverride: z.string().optional(),
});

const MAX_BYTES = 10 * 1024 * 1024;

export type IngestResult = {
  statementId: string;
  duplicate: boolean;
  account: { id: string; name: string; autoCreated: boolean };
  needsReview: boolean;
  txnCount: number;
  reconciliation: { status: ReconciliationStatus; delta: number | null };
};

function autoCreateName(institution: string | undefined, last4: string | undefined, filename: string): string {
  if (institution && last4) return `${institution} ··${last4}`;
  if (institution) return institution;
  return filename.replace(/\.pdf$/i, "");
}

export async function ingestStatement(formData: FormData): Promise<IngestResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  const userId = session.user.id;

  const parsed = InputSchema.parse({
    financialAccountId: (formData.get("financialAccountId") as string) || undefined,
    modelOverride: (formData.get("modelOverride") as string) || undefined,
  });

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Missing file");
  if (file.type !== "application/pdf") throw new Error("Only PDF files are allowed");
  if (file.size > MAX_BYTES) throw new Error("File exceeds 10 MB");

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = sha256Hex(buffer);

  // Identical PDF already ingested? Return the existing statement with its
  // current account + reconciliation, no re-extraction (cost) or duplicate row.
  const [dup] = await db
    .select({
      id: statements.id,
      accountId: financialAccounts.id,
      accountName: financialAccounts.name,
      reconciliationStatus: statements.reconciliationStatus,
      reconciliationDelta: statements.reconciliationDelta,
    })
    .from(statements)
    .innerJoin(financialAccounts, eq(statements.financialAccountId, financialAccounts.id))
    .where(and(eq(statements.userId, userId), eq(statements.contentHash, contentHash), eq(statements.extractionStatus, "succeeded")))
    .limit(1);
  if (dup) {
    const [{ value: txnCount }] = await db
      .select({ value: count() })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.statementId, dup.id)));
    return {
      statementId: dup.id,
      duplicate: true,
      account: { id: dup.accountId, name: dup.accountName, autoCreated: false },
      needsReview: false,
      txnCount,
      reconciliation: {
        status: (dup.reconciliationStatus as ReconciliationStatus | null) ?? "not_available",
        delta: dup.reconciliationDelta == null ? null : Number(dup.reconciliationDelta),
      },
    };
  }

  const [me] = await db.select({ preferredModel: users.preferredModel }).from(users).where(eq(users.id, userId)).limit(1);
  const wanted = parsed.modelOverride ?? me?.preferredModel ?? DEFAULT_MODEL;
  if (!ALLOWED_MODEL_IDS.has(wanted as ModelId)) throw new Error("Model not allowed");
  const model = wanted as ModelId;

  const statementId = randomUUID();
  const stored = await putStatementPdf({ userId, statementId, body: buffer });

  const cats = await db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.userId, userId));
  const rules = await db
    .select({ keyword: categoryRules.keyword, categoryId: categoryRules.categoryId })
    .from(categoryRules)
    .where(eq(categoryRules.userId, userId))
    .orderBy(desc(categoryRules.createdAt));

  let result;
  try {
    result = await extractFromPdf({ pdf: buffer, model, filename: file.name, categoryNames: cats.map((c) => c.name) });
  } catch (err) {
    // Record the failure durably. We have no extracted institution/last4 here,
    // so attach it to the override account if supplied, else a per-user
    // "Unsorted" fallback (created lazily).
    const failAccountId = parsed.financialAccountId ?? (await getOrCreateUnsorted(userId)).id;
    await db.insert(statements).values({
      id: statementId, userId, financialAccountId: failAccountId,
      sourceFilename: file.name, storageBucket: stored.bucket, storageKey: stored.key,
      contentHash, modelUsed: model, extractionStatus: "failed",
      extractionError: `Extraction failed: ${(err as Error).message}`,
    });
    throw err;
  }

  // Resolve the account: manual override → matched → ambiguous → auto-create.
  let account: typeof financialAccounts.$inferSelect;
  let autoCreated = false;
  let needsReview = false;

  if (parsed.financialAccountId) {
    const [a] = await db.select().from(financialAccounts)
      .where(and(eq(financialAccounts.id, parsed.financialAccountId), eq(financialAccounts.userId, userId))).limit(1);
    if (!a) throw new Error("Account not found");
    account = a;
  } else {
    const accts = await db.select().from(financialAccounts).where(eq(financialAccounts.userId, userId));
    const kind = result.account_summary.account_type ?? "checking";
    const institution = result.account_summary.institution ?? null;
    const last4 = result.account_summary.last4 ?? null;

    const match = resolveAccount({
      extracted: { institution, last4, kind: result.account_summary.account_type ?? null },
      accounts: accts,
    });

    if (match.kind === "matched") {
      account = accts.find((a) => a.id === match.account.id)!;
    } else if (match.kind === "ambiguous") {
      account = accts.find((a) => a.id === match.account.id)!;
      needsReview = true;
    } else if (last4) {
      // No existing match. Create convergently: a concurrent sibling in the
      // same batch may insert the same (user, kind, last4) first, so
      // onConflictDoNothing + re-select makes them all land on one account
      // instead of each creating a duplicate.
      const [created] = await db.insert(financialAccounts).values({
        userId,
        name: autoCreateName(institution ?? undefined, last4, file.name),
        kind,
        institution,
        last4,
        currency: result.account_summary.currency,
      }).onConflictDoNothing({
        target: [financialAccounts.userId, financialAccounts.kind, financialAccounts.last4],
        where: sql`${financialAccounts.last4} is not null`,
      }).returning();
      if (created) {
        account = created;
        autoCreated = true;
      } else {
        const [winner] = await db.select().from(financialAccounts).where(and(
          eq(financialAccounts.userId, userId),
          eq(financialAccounts.kind, kind),
          eq(financialAccounts.last4, last4),
        )).limit(1);
        if (!winner) throw new Error("Account convergence failed");
        account = winner;
      }
    } else {
      // last4 couldn't be extracted — bucket by institution + kind so
      // unreadable statements collapse onto one account, not one per file.
      const bucket = findBucketAccount(accts, { institution, kind });
      if (bucket) {
        account = accts.find((a) => a.id === bucket.id)!;
      } else {
        const [created] = await db.insert(financialAccounts).values({
          userId,
          name: autoCreateName(institution ?? undefined, undefined, file.name),
          kind,
          institution,
          last4: null,
          currency: result.account_summary.currency,
        }).returning();
        account = created;
        autoCreated = true;
      }
    }
  }

  const rec = reconcile({
    kind: account.kind,
    opening: result.account_summary.opening_balance ?? null,
    closing: result.account_summary.closing_balance ?? null,
    amounts: result.transactions.map((t) => t.amount),
  });

  await db.transaction(async (tx) => {
    await tx.insert(statements).values({
      id: statementId, userId, financialAccountId: account.id,
      sourceFilename: file.name, storageBucket: stored.bucket, storageKey: stored.key,
      contentHash, modelUsed: model,
      periodStart: result.account_summary.period_start, periodEnd: result.account_summary.period_end,
      openingBalance: result.account_summary.opening_balance?.toFixed(2) ?? null,
      closingBalance: result.account_summary.closing_balance?.toFixed(2) ?? null,
      reconciliationStatus: rec.status,
      reconciliationDelta: rec.delta == null ? null : rec.delta.toFixed(2),
      extractionStatus: "succeeded", extractedAt: new Date(),
    });

    if (result.transactions.length > 0) {
      await tx.insert(transactions).values(
        result.transactions.map((t) => ({
          userId, financialAccountId: account.id, statementId,
          postedAt: t.posted_at, description: t.description, merchant: t.merchant ?? null,
          amount: t.amount.toFixed(2), direction: resolveDirection(t),
          currency: result.account_summary.currency,
          ...(() => {
            const r = resolveCategory({ description: t.description, suggestedLabel: t.suggested_category, rules, categories: cats });
            return { categoryId: r.categoryId, categorySource: r.source };
          })(),
          rawExtraction: t,
        })),
      ).onConflictDoNothing({
        target: [transactions.userId, transactions.financialAccountId, transactions.postedAt, transactions.amount, transactions.description],
      });
    }
  });

  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");

  return {
    statementId, duplicate: false,
    account: { id: account.id, name: account.name, autoCreated },
    needsReview, txnCount: result.transactions.length,
    reconciliation: { status: rec.status, delta: rec.delta },
  };
}

async function getOrCreateUnsorted(userId: string): Promise<typeof financialAccounts.$inferSelect> {
  const [existing] = await db.select().from(financialAccounts)
    .where(and(eq(financialAccounts.userId, userId), eq(financialAccounts.name, "Unsorted"))).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(financialAccounts).values({
    userId, name: "Unsorted", kind: "checking", currency: "USD",
  }).returning();
  return created;
}
