"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { BulkUploadDialog } from "@/components/bulk-upload-dialog";
import { Logo } from "@/components/logo";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/accounts", label: "Accounts" },
  { href: "/transactions", label: "Transactions" },
  { href: "/categories", label: "Categories" },
  { href: "/rules", label: "Rules" },
  { href: "/settings", label: "Settings" },
];

type Props = {
  user: { name: string; email: string };
  accounts: { id: string; name: string; institution: string | null }[];
};

export function AppSidebar({ user, accounts }: Props) {
  const pathname = usePathname();
  const initial = (user.name || user.email || "?").trim().charAt(0).toUpperCase();

  return (
    <Sidebar>
      <SidebarHeader className="gap-3 px-4 pt-4 pb-2">
        <Link href="/dashboard" className="px-1">
          <Logo size={22} />
        </Link>
        <BulkUploadDialog
          accounts={accounts}
          trigger={<Button size="sm" className="w-full">Upload statements</Button>}
        />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((n) => {
                const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
                return (
                  <SidebarMenuItem key={n.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      className="data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:shadow-sm"
                    >
                      <Link href={n.href} className="relative">
                        {active && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-brand" />
                        )}
                        {n.label}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t">
        <div className="flex items-center gap-2.5 px-1 py-1">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-foreground">
            {initial}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium">{user.name}</div>
            <div className="truncate text-xs text-muted-foreground">{user.email}</div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          onClick={() => signOut().then(() => (window.location.href = "/sign-in"))}
        >
          Sign out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
