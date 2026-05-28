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

export async function updateTransactionCategory(input: {
  transactionId: string;
  categoryId: string | null;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");

  const parsed = Input.parse(input);
  await db
    .update(transactions)
    .set({ categoryId: parsed.categoryId })
    .where(
      and(
        eq(transactions.id, parsed.transactionId),
        eq(transactions.userId, session.user.id),
      ),
    );

  revalidatePath("/transactions");
}
