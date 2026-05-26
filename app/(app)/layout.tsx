import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { seedDefaultCategoriesIfMissing } from "@/lib/categories/seed";
import { db } from "@/lib/db/client";
import { financialAccounts, users } from "@/lib/db/schema";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  await seedDefaultCategoriesIfMissing(session.user.id);

  const [me] = await db
    .select({ preferredModel: users.preferredModel })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  const accounts = await db
    .select({ id: financialAccounts.id, name: financialAccounts.name, institution: financialAccounts.institution })
    .from(financialAccounts)
    .where(eq(financialAccounts.userId, session.user.id));

  return (
    <SidebarProvider>
      <AppSidebar
        user={session.user}
        accounts={accounts}
        preferredModel={me?.preferredModel ?? "google/gemini-2.5-flash"}
      />
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
