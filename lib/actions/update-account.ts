"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { financialAccounts, statements, transactions } from "@/lib/db/schema";
import { reconcile } from "@/lib/statements/reconcile";

const Input = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  kind: z.enum(["checking", "savings", "credit", "investment"]),
  institution: z.string().max(100).optional(),
  last4: z.string().regex(/^\d{4}$/).optional(),
  currency: z.string().length(3),
});

export async function updateAccount(input: {
  id: string;
  name: string;
  kind: "checking" | "savings" | "credit" | "investment";
  institution?: string;
  last4?: string;
  currency: string;
}): Promise<{ id: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  const userId = session.user.id;
  const parsed = Input.parse(input);

  const [existing] = await db
    .select()
    .from(financialAccounts)
    .where(and(eq(financialAccounts.id, parsed.id), eq(financialAccounts.userId, userId)))
    .limit(1);
  if (!existing) throw new Error("Account not found");

  const next = {
    name: parsed.name,
    kind: parsed.kind,
    institution: parsed.institution ?? null,
    last4: parsed.last4 ?? null,
    currency: parsed.currency,
  };

  try {
    await db
      .update(financialAccounts)
      .set(next)
      .where(and(eq(financialAccounts.id, parsed.id), eq(financialAccounts.userId, userId)));
  } catch (err) {
    // Partial unique index (user_id, kind, last4) WHERE last4 is not null.
    // drizzle wraps the pg error; the SQLSTATE may be on err or err.cause.
    const code =
      (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") {
      throw new Error("You already have an account with that kind and last 4 digits.");
    }
    throw err;
  }

  // kind drives reconciliation (asset vs credit). If it changed, recompute every
  // statement's reconciliation against the new kind.
  if (parsed.kind !== existing.kind) {
    const stmts = await db
      .select({
        id: statements.id,
        openingBalance: statements.openingBalance,
        closingBalance: statements.closingBalance,
      })
      .from(statements)
      .where(and(eq(statements.userId, userId), eq(statements.financialAccountId, parsed.id)));

    for (const s of stmts) {
      const txns = await db
        .select({ amount: transactions.amount })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.statementId, s.id)));
      const rec = reconcile({
        kind: parsed.kind,
        opening: s.openingBalance == null ? null : Number(s.openingBalance),
        closing: s.closingBalance == null ? null : Number(s.closingBalance),
        amounts: txns.map((t) => Number(t.amount)),
      });
      await db
        .update(statements)
        .set({
          reconciliationStatus: rec.status,
          reconciliationDelta: rec.delta == null ? null : rec.delta.toFixed(2),
        })
        .where(and(eq(statements.id, s.id), eq(statements.userId, userId)));
    }
  }

  revalidatePath("/accounts");
  revalidatePath(`/accounts/${parsed.id}`);
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  return { id: parsed.id };
}
