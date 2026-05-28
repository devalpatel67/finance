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
