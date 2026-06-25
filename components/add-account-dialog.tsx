"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAccount } from "@/lib/actions/create-account";
import { PaymentCard, type CardNetwork } from "@/components/payment-card";
import { AccountKindField, NetworkField, type Kind } from "@/components/account-fields";

export function AddAccountDialog({
  trigger,
  onCreated,
}: {
  trigger: React.ReactNode;
  onCreated?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [kind, setKind] = useState<Kind>("checking");
  const [network, setNetwork] = useState<CardNetwork>(null);
  const [last4, setLast4] = useState("");
  const [currency, setCurrency] = useState("CAD");

  function submit() {
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("name", name);
        fd.set("kind", kind);
        if (institution) fd.set("institution", institution);
        if (last4.length === 4) fd.set("last4", last4);
        if (kind === "credit" && network) fd.set("network", network);
        fd.set("currency", currency);
        const res = await createAccount(fd);
        setOpen(false);
        toast.success("Account added");
        onCreated?.(res.id);
      } catch (e) {
        toast.error("Could not add account", { description: (e as Error).message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Add account</DialogTitle></DialogHeader>
        <div className="grid gap-6 md:grid-cols-[minmax(0,300px)_1fr]">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Preview</p>
            <PaymentCard data={{ institution: institution || null, name, kind, last4: last4 || null, currency, network }} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="grid content-start gap-3.5">
            <div className="grid gap-1.5">
              <Label htmlFor="name">Account name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="RBC Chequing (Personal)" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="institution">Institution</Label>
              <Input id="institution" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Royal Bank of Canada" />
            </div>
            <AccountKindField value={kind} onChange={setKind} />
            {kind === "credit" && <NetworkField value={network} onChange={setNetwork} />}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="last4">Last 4</Label>
                <Input
                  id="last4"
                  value={last4}
                  onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric"
                  placeholder="7610"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="currency">Currency</Label>
                <Input id="currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} required />
              </div>
            </div>
            <DialogFooter className="mt-1">
              <Button type="submit" disabled={pending || !name || currency.length !== 3}>
                {pending ? "Adding…" : "Add account"}
              </Button>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
