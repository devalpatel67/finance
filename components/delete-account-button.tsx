"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { deleteAccount } from "@/lib/actions/delete-account";

export function DeleteAccountButton({
  accountId,
  accountName,
  empty,
}: {
  accountId: string;
  accountName: string;
  empty: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!empty) {
    return (
      <Button variant="outline" size="sm" disabled title="Reassign or remove its statements first">
        Delete account
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Delete account</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Delete “{accountName}”?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          This account has no statements or transactions. This can’t be undone.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  await deleteAccount({ id: accountId });
                  toast.success("Account deleted");
                  router.push("/accounts");
                } catch (e) {
                  toast.error("Could not delete", { description: (e as Error).message });
                }
              })
            }
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
