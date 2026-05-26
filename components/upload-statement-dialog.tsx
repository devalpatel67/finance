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
import { AddAccountDialog } from "@/components/add-account-dialog";
import { extractStatement } from "@/lib/actions/extract-statement";

type Account = { id: string; name: string; institution: string | null };

export function UploadStatementDialog({
  accounts,
  trigger,
  preferredModel,
}: {
  accounts: Account[];
  trigger: React.ReactNode;
  preferredModel: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Upload statement</DialogTitle></DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              fd.set("financialAccountId", accountId);
              try {
                await extractStatement(fd);
              } catch (e) {
                setError((e as Error).message);
              }
            })
          }
          className="grid gap-4"
        >
          <div className="grid gap-2">
            <Label>Account</Label>
            {accounts.length === 0 ? (
              <AddAccountDialog
                trigger={<Button type="button" variant="outline">Add an account first…</Button>}
                onCreated={(id) => setAccountId(id)}
              />
            ) : (
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}{a.institution ? ` · ${a.institution}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="file">PDF</Label>
            <Input id="file" name="file" type="file" accept="application/pdf" required />
            <p className="text-xs text-muted-foreground">
              Will extract with <code>{preferredModel}</code> (change in Settings).
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={pending || !accountId}>
              {pending ? "Extracting…" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
