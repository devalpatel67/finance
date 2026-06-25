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
import { updateAccount } from "@/lib/actions/update-account";
import { PaymentCard, type CardNetwork } from "@/components/payment-card";
import { AccountKindField, NetworkField, type Kind } from "@/components/account-fields";

type Account = {
  id: string;
  name: string;
  kind: Kind;
  institution: string | null;
  last4: string | null;
  network: CardNetwork;
  currency: string;
};

export function EditAccountDialog({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const [name, setName] = useState(account.name);
  const [institution, setInstitution] = useState(account.institution ?? "");
  const [kind, setKind] = useState<Kind>(account.kind);
  const [network, setNetwork] = useState<CardNetwork>(account.network);
  const [last4, setLast4] = useState(account.last4 ?? "");
  const [currency, setCurrency] = useState(account.currency);

  function submit() {
    start(async () => {
      try {
        await updateAccount({
          id: account.id,
          name,
          kind,
          institution: institution || undefined,
          last4: last4.length === 4 ? last4 : undefined,
          network: kind === "credit" && network ? network : undefined,
          currency,
        });
        setOpen(false);
        toast.success("Account updated");
        router.refresh();
      } catch (e) {
        toast.error("Could not update account", { description: (e as Error).message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Edit</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Edit account</DialogTitle></DialogHeader>
        <div className="grid gap-6 md:grid-cols-[minmax(0,300px)_1fr]">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Preview</p>
            <PaymentCard data={{ institution: institution || null, name, kind, last4: last4 || null, currency, network }} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="grid content-start gap-3.5">
            <div className="grid gap-1.5">
              <Label htmlFor="e-name">Account name</Label>
              <Input id="e-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="e-institution">Institution</Label>
              <Input id="e-institution" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Royal Bank of Canada" />
            </div>
            <AccountKindField value={kind} onChange={setKind} />
            {kind === "credit" && <NetworkField value={network} onChange={setNetwork} />}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="e-last4">Last 4</Label>
                <Input
                  id="e-last4"
                  value={last4}
                  onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric"
                  placeholder="7610"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="e-currency">Currency</Label>
                <Input id="e-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} required />
              </div>
            </div>
            <DialogFooter className="mt-1">
              <Button type="submit" disabled={pending || !name || currency.length !== 3}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
