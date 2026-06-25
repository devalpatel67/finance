import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { Logo } from "@/components/logo";
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
        <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger />
          <Link href="/dashboard" className="md:hidden">
            <Logo size={18} />
          </Link>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-6 md:p-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
