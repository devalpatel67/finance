"use server";

import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { categories, categoryRules, financialAccounts, statements, transactions } from "@/lib/db/schema";
import { getStatementPdf } from "@/lib/storage/minio";
import { extractFromPdf, resolveDirection } from "@/lib/llm/extraction";
import { resolveCategory } from "@/lib/categories/resolve";
import { ALLOWED_MODEL_IDS, type ModelId } from "@/lib/llm/models";
import { reconcile } from "@/lib/statements/reconcile";

export async function reprocessStatement(statementId: string, model: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  if (!ALLOWED_MODEL_IDS.has(model as ModelId)) throw new Error("Model not allowed");

  const [s] = await db
    .select()
    .from(statements)
    .where(and(eq(statements.id, statementId), eq(statements.userId, session.user.id)))
    .limit(1);
  if (!s) throw new Error("Statement not found");
  if (!s.storageKey) throw new Error("Statement has no stored PDF");

  const pdf = await getStatementPdf({ bucket: s.storageBucket, key: s.storageKey });

  const cats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.userId, session.user.id));
  const rules = await db
    .select({ keyword: categoryRules.keyword, categoryId: categoryRules.categoryId })
    .from(categoryRules)
    .where(eq(categoryRules.userId, session.user.id))
    .orderBy(desc(categoryRules.createdAt));

  const result = await extractFromPdf({ pdf, model: model as ModelId, filename: s.sourceFilename, categoryNames: cats.map((c) => c.name) });

  const [acct] = await db
    .select({ kind: financialAccounts.kind })
    .from(financialAccounts)
    .where(eq(financialAccounts.id, s.financialAccountId))
    .limit(1);

  const rec = reconcile({
    kind: acct.kind,
    opening: result.account_summary.opening_balance ?? null,
    closing: result.account_summary.closing_balance ?? null,
    amounts: result.transactions.map((t) => t.amount),
  });

  await db.transaction(async (tx) => {
    await tx.delete(transactions).where(eq(transactions.statementId, s.id));
    await tx
      .update(statements)
      .set({
        modelUsed: model,
        periodStart: result.account_summary.period_start,
        periodEnd: result.account_summary.period_end,
        openingBalance: result.account_summary.opening_balance?.toFixed(2) ?? null,
        closingBalance: result.account_summary.closing_balance?.toFixed(2) ?? null,
        reconciliationStatus: rec.status,
        reconciliationDelta: rec.delta == null ? null : rec.delta.toFixed(2),
        extractionStatus: "succeeded",
        extractionError: null,
        extractedAt: new Date(),
      })
      .where(eq(statements.id, s.id));

    if (result.transactions.length > 0) {
      await tx.insert(transactions).values(
        result.transactions.map((t) => ({
          userId: session.user.id,
          financialAccountId: s.financialAccountId,
          statementId: s.id,
          postedAt: t.posted_at,
          description: t.description,
          amount: t.amount.toFixed(2),
          direction: resolveDirection(t),
          currency: result.account_summary.currency,
          ...(() => {
              const r = resolveCategory({
                description: t.description,
                suggestedLabel: t.suggested_category,
                rules,
                categories: cats,
              });
              return { categoryId: r.categoryId, categorySource: r.source };
            })(),
          rawExtraction: t,
        })),
      );
    }
  });

  revalidatePath(`/statements/${s.id}`);
}
