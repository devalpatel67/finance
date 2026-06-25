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
  network: z.enum(["visa", "mastercard", "amex", "other"]).optional(),
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
    network: form.get("network") || undefined,
    currency: form.get("currency"),
  });

  const [row] = await db.insert(financialAccounts).values({
    userId: session.user.id,
    ...parsed,
  }).returning();

  revalidatePath("/accounts");
  return { id: row.id };
}
