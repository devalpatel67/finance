"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createAccount } from "@/lib/actions/create-account";

export function AddAccountDialog({
  trigger,
  onCreated,
}: {
  trigger: React.ReactNode;
  onCreated?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add account</DialogTitle></DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              const res = await createAccount(fd);
              setOpen(false);
              onCreated?.(res.id);
            })
          }
          className="grid gap-4"
        >
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" placeholder="Chase Sapphire" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="kind">Kind</Label>
            <Select name="kind" defaultValue="checking">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="checking">Chequing</SelectItem>
                <SelectItem value="savings">Savings</SelectItem>
                <SelectItem value="credit">Credit</SelectItem>
                <SelectItem value="investment">Investment</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="institution">Institution</Label>
              <Input id="institution" name="institution" placeholder="Chase" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="last4">Last 4</Label>
              <Input id="last4" name="last4" maxLength={4} pattern="\d{4}" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="currency">Currency</Label>
            <Input id="currency" name="currency" defaultValue="USD" maxLength={3} required />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
