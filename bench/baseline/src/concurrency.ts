// takumi-motion — concurrency.ts (v0.5)
// Bounded-concurrency primitives for the parallel pipeline.
//
// The engine's heavy work lives behind async napi calls (fromHtml parsing,
// renderer.measure, PNG/animation encodes) that execute on Rust's thread
// pools. Overlapping K of them hides napi round-trip latency without ever
// changing OUTPUT: every render is a pure function of (node, timeMs, css),
// so results are byte-identical at any concurrency — only wall-clock moves.
// That invariant is golden-tested (concurrency 1 vs N ⇒ same bytes).

import { availableParallelism } from "node:os";

/** Hard ceiling — past this the pool adds latency, not throughput. */
const MAX_CONCURRENCY = 64;

/**
 * Resolve the effective concurrency:
 *   explicit `limit` (validated)  >  min(availableParallelism(), fallbackCores)
 */
export function resolveConcurrency(limit: number | undefined, fallbackCores = 8): number {
  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`concurrency must be a positive integer, got ${limit}.`);
    }
    return Math.min(limit, MAX_CONCURRENCY);
  }
  let cores = 4;
  try {
    cores = availableParallelism();
  } catch {
    // keep the fallback — exotic runtimes without os.availableParallelism
  }
  return Math.max(1, Math.min(cores, fallbackCores, MAX_CONCURRENCY));
}

/**
 * Map `items` → `fn(item, index)` with at most `limit` fns in flight
 * (sliding window — a finished task starts the next one). Results keep the
 * INPUT order regardless of completion order. `fn` may return a value or a
 * promise (napi helpers like fromHtml return plain values on some versions).
 * A rejection fails the whole map after the in-flight tasks settle.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => R | Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`mapWithConcurrency: limit must be a positive integer, got ${limit}.`);
  }
  const results = new Array<R>(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  const worker = async (): Promise<void> => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}
