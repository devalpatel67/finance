"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { updateAccount } from "@/lib/actions/update-account";

type Kind = "checking" | "savings" | "credit" | "investment";
type Account = {
  id: string;
  name: string;
  kind: Kind;
  institution: string | null;
  last4: string | null;
  currency: string;
};

export function EditAccountDialog({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Edit</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit account</DialogTitle></DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              try {
                await updateAccount({
                  id: account.id,
                  name: String(fd.get("name") ?? ""),
                  kind: String(fd.get("kind") ?? account.kind) as Kind,
                  institution: (fd.get("institution") as string) || undefined,
                  last4: (fd.get("last4") as string) || undefined,
                  currency: String(fd.get("currency") ?? ""),
                });
                setOpen(false);
                toast.success("Account updated");
                router.refresh();
              } catch (e) {
                toast.error("Could not update account", { description: (e as Error).message });
              }
            })
          }
          className="grid gap-4"
        >
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" defaultValue={account.name} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="kind">Kind</Label>
            <Select name="kind" defaultValue={account.kind}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="checking">Checking</SelectItem>
                <SelectItem value="savings">Savings</SelectItem>
                <SelectItem value="credit">Credit</SelectItem>
                <SelectItem value="investment">Investment</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="institution">Institution</Label>
              <Input id="institution" name="institution" defaultValue={account.institution ?? ""} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="last4">Last 4</Label>
              <Input id="last4" name="last4" maxLength={4} pattern="\d{4}" defaultValue={account.last4 ?? ""} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="currency">Currency</Label>
            <Input id="currency" name="currency" defaultValue={account.currency} maxLength={3} required />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
