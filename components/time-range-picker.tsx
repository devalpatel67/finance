"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";
import type { RangePreset } from "@/lib/dates/ranges";

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "6m", label: "6m" },
  { value: "1y", label: "1y" },
  { value: "2y", label: "2y" },
  { value: "5y", label: "5y" },
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
];

export function TimeRangePicker() {
  const router = useRouter();
  const sp = useSearchParams();
  const current = (sp.get("range") as RangePreset | null) ?? "6m";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";

  function setPreset(p: RangePreset) {
    const next = new URLSearchParams(sp.toString());
    next.set("range", p);
    if (p !== "custom") {
      next.delete("from");
      next.delete("to");
    }
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  function setCustomField(field: "from" | "to", value: string) {
    const next = new URLSearchParams(sp.toString());
    next.set("range", "custom");
    if (value) next.set(field, value);
    else next.delete(field);
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-secondary p-1">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPreset(p.value)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs transition-colors",
              current === p.value
                ? "bg-card font-semibold text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {current === "custom" && (
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="grid gap-1">
            <span className="text-muted-foreground">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setCustomField("from", e.target.value)}
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-muted-foreground">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setCustomField("to", e.target.value)}
              className="rounded border px-2 py-1"
            />
          </label>
        </div>
      )}
    </div>
  );
}
