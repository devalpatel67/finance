"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MODELS } from "@/lib/llm/models";
import { updateSettings } from "@/lib/actions/update-settings";

export function SettingsForm({
  preferredModel,
  defaultCurrency,
}: { preferredModel: string; defaultCurrency: string }) {
  const [pm, setPm] = useState(preferredModel);
  const [cur, setCur] = useState(defaultCurrency);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  return (
    <form
      action={() => start(async () => {
        await updateSettings({ preferredModel: pm, defaultCurrency: cur });
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      })}
      className="grid max-w-md gap-6"
    >
      <div className="grid gap-2">
        <Label>Preferred model</Label>
        <Select value={pm} onValueChange={setPm}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <div className="flex flex-col">
                  <span>{m.label}</span>
                  <span className="text-xs text-muted-foreground">{m.id} · {m.note}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="cur">Default currency</Label>
        <Input id="cur" value={cur} onChange={(e) => setCur(e.target.value.toUpperCase())} maxLength={3} />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        {saved && <span className="text-sm text-emerald-600">Saved.</span>}
      </div>
    </form>
  );
}
