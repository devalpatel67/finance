import { describe, expect, it } from "vitest";
import { runBatch } from "@/lib/upload/run-batch";
import { validateUploadFile, MAX_UPLOAD_BYTES } from "@/lib/upload/validate-file";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runBatch", () => {
  it("never exceeds the concurrency cap", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await runBatch(items, async () => {
      active++;
      peak = Math.max(peak, active);
      await sleep(5);
      active--;
    }, { concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("runs every item even when one worker throws", async () => {
    const done: number[] = [];
    await runBatch([0, 1, 2], async (i) => {
      if (i === 1) throw new Error("boom");
      done.push(i);
    }, { concurrency: 2 });
    expect(done.sort()).toEqual([0, 2]);
  });
});

describe("validateUploadFile", () => {
  it("rejects non-PDF", () => {
    expect(validateUploadFile({ type: "image/png", size: 10 })).toEqual({ ok: false, error: "Only PDF files are allowed" });
  });
  it("rejects oversize", () => {
    expect(validateUploadFile({ type: "application/pdf", size: MAX_UPLOAD_BYTES + 1 })).toEqual({ ok: false, error: "File exceeds 10 MB" });
  });
  it("accepts a valid PDF", () => {
    expect(validateUploadFile({ type: "application/pdf", size: 100 })).toEqual({ ok: true });
  });
});
