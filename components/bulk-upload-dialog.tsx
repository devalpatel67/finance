"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ingestStatement, type IngestResult } from "@/lib/actions/ingest-statement";
import { reassignStatementAccount } from "@/lib/actions/reassign-statement-account";
import { runBatch } from "@/lib/upload/run-batch";
import { validateUploadFile } from "@/lib/upload/validate-file";

type Account = { id: string; name: string; institution: string | null };
type Status = "queued" | "uploading" | "extracting" | "done" | "duplicate" | "error";
type Item = { id: string; file: File; status: Status; error?: string; retryable?: boolean; result?: IngestResult };

const CONCURRENCY = 3;

const labels: Record<Status, string> = {
  queued: "Queued", uploading: "Uploading", extracting: "Extracting",
  done: "Done", duplicate: "Already uploaded", error: "Failed",
};

export function BulkUploadDialog({
  accounts: initialAccounts,
  trigger,
}: {
  accounts: Account[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [running, setRunning] = useState(false);
  const router = useRouter();

  function patch(id: string, next: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...next } : it)));
  }

  function addFiles(files: FileList | null) {
    if (!files) return;
    const added: Item[] = Array.from(files).map((file) => {
      const v = validateUploadFile(file);
      return {
        id: crypto.randomUUID(), file,
        status: v.ok ? "queued" : "error",
        error: v.ok ? undefined : v.error,
      };
    });
    setItems((prev) => [...prev, ...added]);
  }

  async function processItem(it: Item) {
    patch(it.id, { status: "uploading", error: undefined, retryable: undefined });
    const fd = new FormData();
    fd.append("file", it.file);
    patch(it.id, { status: "extracting" });
    try {
      const res = await ingestStatement(fd);
      patch(it.id, { status: res.duplicate ? "duplicate" : "done", result: res });
      if (res.account.autoCreated) {
        setAccounts((prev) =>
          prev.some((a) => a.id === res.account.id)
            ? prev
            : [...prev, { id: res.account.id, name: res.account.name, institution: null }]);
      }
    } catch (e) {
      patch(it.id, { status: "error", error: (e as Error).message, retryable: true });
    }
  }

  async function start() {
    setRunning(true);
    const queued = items.filter((it) => it.status === "queued");
    await runBatch(queued, processItem, { concurrency: CONCURRENCY });
    setRunning(false);
    router.refresh();
  }

  function retry(itemId: string) {
    const it = items.find((x) => x.id === itemId);
    if (it) void processItem(it).then(() => router.refresh());
  }

  function reassign(itemId: string, statementId: string, accountId: string) {
    const acct = accounts.find((a) => a.id === accountId);
    void (async () => {
      try {
        await reassignStatementAccount({ statementId, accountId });
        setItems((prev) =>
          prev.map((x) =>
            x.id === itemId && x.result
              ? { ...x, result: { ...x.result, account: { id: accountId, name: acct?.name ?? "", autoCreated: false }, needsReview: false } }
              : x,
          ),
        );
        toast.success(`Moved to ${acct?.name ?? "account"}`);
        router.refresh();
      } catch (e) {
        toast.error("Could not move statement", { description: (e as Error).message });
      }
    })();
  }

  const summary = {
    done: items.filter((i) => i.status === "done").length,
    duplicate: items.filter((i) => i.status === "duplicate").length,
    error: items.filter((i) => i.status === "error").length,
  };
  const queuedCount = items.filter((i) => i.status === "queued").length;
  const processed = summary.done + summary.duplicate + summary.error;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setItems([]); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Upload statements</DialogTitle></DialogHeader>

        <div className="grid gap-3">
          <Input
            type="file" accept="application/pdf" multiple
            onChange={(e) => addFiles(e.target.files)}
            disabled={running}
          />
          <p className="text-xs text-muted-foreground">
            Drop multiple PDFs. The account is detected from each statement; review and override below.
          </p>

          {items.length > 0 && (
            <ul className="max-h-80 divide-y overflow-y-auto rounded border text-sm">
              {items.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-3 p-2">
                  <span className="min-w-0 flex-1 truncate" title={it.file.name}>{it.file.name}</span>
                  {it.result?.account.autoCreated && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">New</span>
                  )}
                  {it.result?.needsReview && (
                    <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">Review</span>
                  )}
                  <span className={`shrink-0 text-xs ${it.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                    {it.error ? `${labels[it.status]}: ${it.error}` : labels[it.status]}
                  </span>
                  {it.status === "error" && it.retryable && (
                    <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs" onClick={() => retry(it.id)}>
                      Retry
                    </Button>
                  )}
                  {(it.status === "done" || it.status === "duplicate") && it.result && (
                    <Select value={it.result.account.id} onValueChange={(v) => reassign(it.id, it.result!.statementId, v)}>
                      <SelectTrigger className="h-7 w-44 shrink-0 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </li>
              ))}
            </ul>
          )}

          {(summary.done + summary.duplicate + summary.error) > 0 && (
            <p className="text-xs text-muted-foreground">
              {summary.done} done · {summary.duplicate} already uploaded · {summary.error} failed
            </p>
          )}
        </div>

        <DialogFooter>
          {running ? (
            <Button disabled>Processing…</Button>
          ) : queuedCount > 0 ? (
            <Button onClick={start}>Upload {queuedCount}</Button>
          ) : processed > 0 ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <Button disabled>Upload</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
