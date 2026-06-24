"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { financialAccounts, statements, transactions } from "@/lib/db/schema";
import { reconcile, type ReconciliationStatus } from "@/lib/statements/reconcile";

const Input = z.object({ statementId: z.string().uuid(), accountId: z.string().uuid() });

export async function reassignStatementAccount(
  input: { statementId: string; accountId: string },
): Promise<{ reconciliation: { status: ReconciliationStatus; delta: number | null } }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  const userId = session.user.id;
  const { statementId, accountId } = Input.parse(input);

  const [stmt] = await db.select().from(statements)
    .where(and(eq(statements.id, statementId), eq(statements.userId, userId))).limit(1);
  if (!stmt) throw new Error("Statement not found");

  const [account] = await db.select().from(financialAccounts)
    .where(and(eq(financialAccounts.id, accountId), eq(financialAccounts.userId, userId))).limit(1);
  if (!account) throw new Error("Account not found");

  const txns = await db.select({ amount: transactions.amount }).from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.statementId, statementId)));

  const rec = reconcile({
    kind: account.kind,
    opening: stmt.openingBalance == null ? null : Number(stmt.openingBalance),
    closing: stmt.closingBalance == null ? null : Number(stmt.closingBalance),
    amounts: txns.map((t) => Number(t.amount)),
  });

  await db.transaction(async (tx) => {
    await tx.update(transactions).set({ financialAccountId: accountId })
      .where(and(eq(transactions.userId, userId), eq(transactions.statementId, statementId)));
    await tx.update(statements).set({
      financialAccountId: accountId,
      reconciliationStatus: rec.status,
      reconciliationDelta: rec.delta == null ? null : rec.delta.toFixed(2),
    }).where(and(eq(statements.id, statementId), eq(statements.userId, userId)));
  });

  revalidatePath("/accounts");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  return { reconciliation: { status: rec.status, delta: rec.delta } };
}
