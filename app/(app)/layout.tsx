import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { seedDefaultCategoriesIfMissing } from "@/lib/categories/seed";
import { scopedDb } from "@/lib/db/scoped";
import { financialAccounts } from "@/lib/db/schema";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  await seedDefaultCategoriesIfMissing(session.user.id);

  const accounts = await scopedDb(session.user.id).selectAll(financialAccounts);

  return (
    <SidebarProvider>
      <AppSidebar
        user={session.user}
        accounts={accounts}
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
