"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { categories, categoryRules, financialAccounts, statements, transactions, users } from "@/lib/db/schema";
import { putStatementPdf } from "@/lib/storage/minio";
import { sha256Hex } from "@/lib/statements/hash";
import { extractFromPdf, resolveDirection } from "@/lib/llm/extraction";
import { resolveCategory } from "@/lib/categories/resolve";
import { ALLOWED_MODEL_IDS, DEFAULT_MODEL, type ModelId } from "@/lib/llm/models";
import { reconcile } from "@/lib/statements/reconcile";

const InputSchema = z.object({
  financialAccountId: z.string().uuid(),
  modelOverride: z.string().optional(),
});

const MAX_BYTES = 10 * 1024 * 1024;

export async function extractStatement(
  formData: FormData,
): Promise<{ statementId: string; duplicate: boolean }> {
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

  const [account] = await db
    .select()
    .from(financialAccounts)
    .where(and(eq(financialAccounts.id, parsed.financialAccountId), eq(financialAccounts.userId, userId)))
    .limit(1);
  if (!account) throw new Error("Account not found");

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = sha256Hex(buffer);

  // Identical PDF already ingested? Don't re-run extraction (cost) or create a
  // duplicate statement — send the user to the existing one. To re-extract with
  // a different model they use the Reprocess control there.
  const [dup] = await db
    .select({ id: statements.id })
    .from(statements)
    .where(
      and(
        eq(statements.userId, userId),
        eq(statements.contentHash, contentHash),
        eq(statements.extractionStatus, "succeeded"),
      ),
    )
    .limit(1);
  if (dup) return { statementId: dup.id, duplicate: true };

  const [me] = await db
    .select({ preferredModel: users.preferredModel })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const wanted = parsed.modelOverride ?? me?.preferredModel ?? DEFAULT_MODEL;
  if (!ALLOWED_MODEL_IDS.has(wanted as ModelId)) throw new Error("Model not allowed");
  const model = wanted as ModelId;

  const statementId = randomUUID();
  await db.insert(statements).values({
    id: statementId,
    userId,
    financialAccountId: account.id,
    sourceFilename: file.name,
    storageBucket: "",
    storageKey: "",
    contentHash,
    modelUsed: model,
    extractionStatus: "pending",
  });

  let stored: { bucket: string; key: string };
  try {
    stored = await putStatementPdf({ userId, statementId, body: buffer });
  } catch (err) {
    await db
      .update(statements)
      .set({
        extractionStatus: "failed",
        extractionError: `MinIO put failed: ${(err as Error).message}`,
      })
      .where(eq(statements.id, statementId));
    throw err;
  }
  await db
    .update(statements)
    .set({ storageBucket: stored.bucket, storageKey: stored.key })
    .where(eq(statements.id, statementId));

  const cats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.userId, userId));
  const rules = await db
    .select({ keyword: categoryRules.keyword, categoryId: categoryRules.categoryId })
    .from(categoryRules)
    .where(eq(categoryRules.userId, userId))
    .orderBy(desc(categoryRules.createdAt));

  let result;
  try {
    result = await extractFromPdf({ pdf: buffer, model, filename: file.name, categoryNames: cats.map((c) => c.name) });
  } catch (err) {
    await db
      .update(statements)
      .set({
        extractionStatus: "failed",
        extractionError: `Extraction failed: ${(err as Error).message}`,
      })
      .where(eq(statements.id, statementId));
    throw err;
  }

  const rec = reconcile({
    kind: account.kind,
    opening: result.account_summary.opening_balance ?? null,
    closing: result.account_summary.closing_balance ?? null,
    amounts: result.transactions.map((t) => t.amount),
  });

  await db.transaction(async (tx) => {
    await tx
      .update(statements)
      .set({
        periodStart: result.account_summary.period_start,
        periodEnd: result.account_summary.period_end,
        openingBalance: result.account_summary.opening_balance?.toFixed(2) ?? null,
        closingBalance: result.account_summary.closing_balance?.toFixed(2) ?? null,
        reconciliationStatus: rec.status,
        reconciliationDelta: rec.delta == null ? null : rec.delta.toFixed(2),
        extractionStatus: "succeeded",
        extractedAt: new Date(),
      })
      .where(eq(statements.id, statementId));

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
            merchant: t.merchant ?? null,
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

  return { statementId, duplicate: false };
}
