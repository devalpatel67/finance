"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { financialAccounts, statements, transactions } from "@/lib/db/schema";

const Input = z.object({ id: z.string().uuid() });

export async function deleteAccount(input: { id: string }): Promise<{ deleted: true }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  const userId = session.user.id;
  const { id } = Input.parse(input);

  const [account] = await db
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .where(and(eq(financialAccounts.id, id), eq(financialAccounts.userId, userId)))
    .limit(1);
  if (!account) throw new Error("Account not found");

  // FK is onDelete:cascade, so deleting a non-empty account would silently drop
  // its statements + transactions. Refuse instead — the user reassigns first.
  const [{ value: stmtCount }] = await db
    .select({ value: count() })
    .from(statements)
    .where(and(eq(statements.userId, userId), eq(statements.financialAccountId, id)));
  const [{ value: txnCount }] = await db
    .select({ value: count() })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.financialAccountId, id)));
  if (stmtCount > 0 || txnCount > 0) {
    throw new Error("Account has statements or transactions. Reassign or remove them first.");
  }

  await db.delete(financialAccounts).where(and(eq(financialAccounts.id, id), eq(financialAccounts.userId, userId)));
  revalidatePath("/accounts");
  return { deleted: true };
}
