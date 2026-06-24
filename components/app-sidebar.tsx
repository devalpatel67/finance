"use client";

import Link from "next/link";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { UploadStatementDialog } from "@/components/upload-statement-dialog";

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
  preferredModel: string;
};

export function AppSidebar({ user, accounts, preferredModel }: Props) {
  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-3 space-y-3">
        <div className="font-semibold">Finance Tracker</div>
        <UploadStatementDialog
          accounts={accounts}
          preferredModel={preferredModel}
          trigger={<Button size="sm" className="w-full">Upload statement</Button>}
        />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((n) => (
                <SidebarMenuItem key={n.href}>
                  <SidebarMenuButton asChild>
                    <Link href={n.href}>{n.label}</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <div className="border-t p-3 text-sm">
        <div className="font-medium">{user.name}</div>
        <div className="text-muted-foreground truncate">{user.email}</div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full"
          onClick={() => signOut().then(() => (window.location.href = "/sign-in"))}
        >
          Sign out
        </Button>
      </div>
    </Sidebar>
  );
}
