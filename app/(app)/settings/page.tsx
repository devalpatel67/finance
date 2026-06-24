import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getMe } from "@/lib/queries/me";
import { SettingsForm } from "@/components/settings-form";

export default async function SettingsPage() {
  const session = (await auth.api.getSession({ headers: await headers() }))!;
  const me = await getMe(session.user.id);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <SettingsForm preferredModel={me.preferredModel} defaultCurrency={me.defaultCurrency} />
    </div>
  );
}
