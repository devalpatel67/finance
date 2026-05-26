"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveCategory, deleteCategory } from "@/lib/actions/categories";

type Cat = { id: string; name: string; color: string; isSystem: boolean };

export function CategoriesManager({ initial }: { initial: Cat[] }) {
  const [draft, setDraft] = useState({ name: "", color: "#94a3b8" });
  const [, start] = useTransition();

  return (
    <div className="space-y-4">
      <form
        className="flex items-end gap-2"
        action={() => start(async () => {
          await saveCategory(draft);
          setDraft({ name: "", color: "#94a3b8" });
        })}
      >
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">Name</span>
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
        </div>
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">Color</span>
          <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
        </div>
        <Button type="submit">Add</Button>
      </form>

      <ul className="divide-y rounded border">
        {initial.map((c) => (
          <li key={c.id} className="flex items-center justify-between p-3">
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
              {c.name}
              {c.isSystem && <span className="text-xs text-muted-foreground">system</span>}
            </span>
            {!c.isSystem && (
              <Button variant="ghost" size="sm" onClick={() => start(() => deleteCategory(c.id))}>
                Delete
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
