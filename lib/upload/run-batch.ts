/**
 * Runs `worker` over `items` with at most `concurrency` in flight at once.
 * A worker that rejects is swallowed so one failure never stops the batch —
 * workers report their own success/failure via side effects (status updates).
 */
export async function runBatch<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  opts: { concurrency: number },
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(opts.concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        await worker(items[i], i);
      } catch {
        // worker owns its own error reporting
      }
    }
  });
  await Promise.all(runners);
}
