import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { SettingsForm } from "@/components/settings-form";

export default async function SettingsPage() {
  const session = (await auth.api.getSession({ headers: await headers() }))!;
  const [me] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <SettingsForm preferredModel={me.preferredModel} defaultCurrency={me.defaultCurrency} />
    </div>
  );
}
