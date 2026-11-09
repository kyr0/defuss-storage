/**
 * Streaming helpers built only on the public {@link StorageFile} API.
 *
 * @module
 */
import { checkAbort, integer } from "./validate.js";
import type { AppendChunksOptions, AppendResult, StorageFile } from "./types.js";

/**
 * Appends each chunk of `source` to `file` and yields that append's receipt.
 *
 * Pull-driven backpressure: by default each consumer pull requests one input
 * chunk, awaits its append and only then yields, so at most one source pull and
 * one append are outstanding and the input is never concatenated. VERIFIED:
 * (stalled appendChunks test) a stalled append prevents the next source pull. A
 * slow file therefore slows the producer instead of growing a buffer, and the
 * handle's admission budget (QUEUE_FULL) is reached only if other callers
 * saturate it.
 *
 * With `inFlight: n`, up to n appends stay outstanding; receipts are still
 * yielded in source order. Why a window rather than a buffer: appends that queue
 * behind a running write share one vectored write on native files, and n bounds
 * what the helper retains. The window must fit the handle's admission budget
 * (n chunks within maxPendingWriteBytes, n ≤ maxPendingOperations), or the
 * append over it rejects QUEUE_FULL at its turn. Before the helper finishes,
 * by completion, failure or early return, it waits for every append it issued,
 * so none is still running afterwards; appends issued after a failing one may
 * still have written their bytes. VERIFIED: (inFlight tests) receipts in order,
 * three outstanding with no fourth pull, and no reservation left after a
 * failure or a break.
 *
 * This is a sequence of ordinary appends, not an atomic batch: other callers
 * may interleave, so offsets need not be contiguous. QUEUE_FULL and failed
 * appends are never retried, and a failed append may already have changed bytes
 * without producing a receipt. Nothing is flushed and the file stays open.
 *
 * On early return, append failure or cancellation the source iterator is
 * closed (`return()`); a source whose `next()` threw is not, per the iterator
 * protocol. If closing the source also fails, the primary error is rethrown with
 * the cleanup failure attached as its non-enumerable `suppressed` property.
 * Cancellation is checked before each pull and each append; a pending `next()`
 * or native write is only cooperatively cancellable.
 *
 * @param source Chunks no larger than the file's maxWriteBytes; empty chunks are ordinary empty appends.
 */
export async function* appendChunks(
  file: StorageFile,
  source: AsyncIterable<Uint8Array>,
  options: AppendChunksOptions = {},
): AsyncIterableIterator<AppendResult> {
  const open = (source as Partial<AsyncIterable<Uint8Array>> | null)?.[Symbol.asyncIterator];
  if (typeof open !== "function") throw new TypeError("defuss-storage: appendChunks source must be an AsyncIterable");
  const inFlight = integer(options.inFlight ?? 1, "inFlight", true);
  checkAbort(options.signal);
  const iterator = open.call(source);
  // False once the source finished or threw: then there is nothing to close.
  let active = true;
  /** Issued appends whose receipts are not yielded yet, oldest first. */
  const pending: Promise<AppendResult>[] = [];
  try {
    for (;;) {
      while (active && pending.length < inFlight) {
        checkAbort(options.signal);
        let step: IteratorResult<Uint8Array>;
        try { step = await iterator.next(); } catch (error) { active = false; throw error; }
        if (step.done) { active = false; break; }
        checkAbort(options.signal);
        const append = file.append(step.value, options);
        // Handled here so an append abandoned by an earlier failure never surfaces; its own turn rethrows it.
        append.catch(() => undefined);
        pending.push(append);
      }
      const oldest = pending.shift();
      if (!oldest) return;
      yield await oldest;
    }
  } catch (error) {
    if (active) {
      active = false;
      try { await iterator.return?.(); } catch (cleanup) { attachSuppressed(error, cleanup); }
    }
    throw error;
  } finally {
    // Reached with `active` only on the consumer's early return (break/return()).
    try { if (active) await iterator.return?.(); } finally { await Promise.allSettled(pending); }
  }
}

/** Records a secondary cleanup failure on the primary error without replacing it. */
function attachSuppressed(error: unknown, cleanup: unknown): void {
  if (typeof error === "object" && error !== null && Object.isExtensible(error)) {
    Object.defineProperty(error, "suppressed", { value: cleanup, configurable: true, writable: true });
  }
}
