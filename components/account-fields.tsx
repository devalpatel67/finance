"use client";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { CardNetwork } from "@/components/payment-card";

export type Kind = "checking" | "savings" | "credit" | "investment";

const KINDS: { value: Kind; label: string }[] = [
  { value: "checking", label: "Chequing" },
  { value: "savings", label: "Savings" },
  { value: "credit", label: "Credit" },
  { value: "investment", label: "Investment" },
];

const NETWORKS: { value: CardNetwork; label: string }[] = [
  { value: "visa", label: "Visa" },
  { value: "mastercard", label: "Mastercard" },
  { value: "amex", label: "Amex" },
  { value: null, label: "None" },
];

function Segmented<T>({
  options,
  value,
  onChange,
  accent,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.label}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs transition-colors",
              on
                ? accent
                  ? "border-brand bg-accent font-semibold text-brand"
                  : "border-foreground bg-foreground font-semibold text-background"
                : "border-input text-muted-foreground hover:bg-secondary",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function AccountKindField({ value, onChange }: { value: Kind; onChange: (v: Kind) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label>Type</Label>
      <Segmented options={KINDS} value={value} onChange={onChange} />
    </div>
  );
}

export function NetworkField({ value, onChange }: { value: CardNetwork; onChange: (v: CardNetwork) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label>
        Network <span className="text-muted-foreground">· credit cards</span>
      </Label>
      <Segmented options={NETWORKS} value={value} onChange={onChange} accent />
    </div>
  );
}
