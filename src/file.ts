/**
 * The handle implementation every adapter shares.
 *
 * Adapters only supply a minimal {@link ByteBackend}; ordering, validation,
 * admission, partial-I/O completion, input copying, cancellation, streaming
 * and error normalization live here once. That keeps the three adapters behaviorally
 * identical, which the shared contract suite (`tests/contract.ts`) checks.
 *
 * @module
 */
import { StorageError, storageError } from "./errors.js";
import { bytes, checkAbort, integer, range, transferOption, type HandleLimits } from "./validate.js";
import type { AppendResult, IOOptions, StorageFile, StreamOptions, WriteOptions } from "./types.js";

/**
 * Internal byte primitive, exported publicly as `StorageFileBackend`.
 * Methods may be synchronous or asynchronous. `read` and `write` may make
 * partial progress and return the byte count; {@link ManagedFile} retries them.
 * The backend must zero-fill on extension, report a consistent size, and
 * release its resource and ownership in `close`. Release ownership only after
 * the resource is confirmed closed: if `close` throws, keep the ownership
 * claimed, because a second owner could otherwise run while the first resource
 * may still be live. `close` is called at most once per handle. `size` is called
 * once per handle and again only after a failed mutation or a short read. `read`
 * is called concurrently only when the adapter enables overlapping reads (the
 * native adapter, for read-only handles); createStorageFile never does.
 * `writev` is optional: with it, appends that queue up behind a running
 * operation are written in one call (see {@link ManagedFile}).
 */
export interface ByteBackend {
  size(): number | Promise<number>;
  read(offset: number, target: Uint8Array): number | Promise<number>;
  write(offset: number, data: Uint8Array): number | Promise<number>;
  /** Writes `chunks` back to back from `offset`; returns the bytes written, which may be fewer than their total (partial progress, as with `write`). */
  writev?(offset: number, chunks: readonly Uint8Array[]): number | Promise<number>;
  truncate(size: number): void | Promise<void>;
  flush(): void | Promise<void>;
  close(): void | Promise<void>;
}

/**
 * Internal diagnostics key: `file[ADMISSION]` returns the handle's current
 * reservations. Tests use it to check the accounting directly; it is not part
 * of the semver-covered API.
 */
export const ADMISSION: unique symbol = Symbol.for("defuss-storage.v0.admission");

/** An append's owned input, its planned offset while its batch runs, and the outcome that batch recorded. */
interface QueuedAppend {
  readonly data: Uint8Array;
  readonly options: IOOptions;
  offset: number;
  outcome?: { result: AppendResult } | { error: unknown };
}
/**
 * Consumer time on the previous chunk from which a stream reads the next chunk
 * ahead. VERIFIED: (raw FileHandle probe, Node 26, macOS arm64, 4 KiB and 64 KiB
 * reads) reading ahead of a consumer that spends 2 µs or less per chunk cost
 * 2.7–2.9 µs per chunk, about 5 µs broke even, and 10 µs or more saved 4–6 µs.
 * HYPOTHESIS: other platforms cross over near the same consumer time; falsifier:
 * the same probe on Linux or Windows.
 */
const READ_AHEAD_AFTER_MS = 0.005;
/**
 * A stream times its consumer on every this many chunks and keeps the last
 * decision in between. Why not every chunk: the two `performance.now()` calls
 * per chunk cost more than the decision is worth on fast backends. VERIFIED:
 * (interleaved probes, 4 KiB chunks) timing every chunk cost about 80 ns per
 * chunk on the Node.js memory adapter and about 300 ns per chunk on OPFS in a
 * Chromium worker; timing every 8th chunk recovered most of the Chromium cost.
 */
const READ_AHEAD_SAMPLE_EVERY = 8;
/**
 * Moves `data`'s whole buffer to a new owner without copying; `data` is detached
 * afterwards. VERIFIED: (probe) taking a 1 MiB buffer costs 0.1–0.9 µs against
 * 24 µs for a copy. `ArrayBuffer.prototype.transfer` is missing on Node.js 20,
 * where a structuredClone transfer moves the buffer (0.6–2.2 µs, probe).
 */
function take(data: Uint8Array): Uint8Array {
  const buffer = data.buffer as ArrayBuffer & { transfer?: () => ArrayBuffer };
  const length = data.length;
  const moved = typeof buffer.transfer === "function" ? buffer.transfer() : structuredClone(buffer, { transfer: [buffer] });
  return new Uint8Array(moved, 0, length);
}
/** Returns a recorded append outcome, or throws its error. */
function settle(outcome: NonNullable<QueuedAppend["outcome"]>): AppendResult {
  if ("error" in outcome) throw outcome.error;
  return outcome.result;
}

/**
 * {@link StorageFile} over a {@link ByteBackend}, with one serial queue per handle.
 *
 * Why a serial queue rather than a lock per operation: the queue is a single
 * promise chain, so invocation order is execution order with no lock state to
 * leak, and `append` can read EOF and write in one task without racing.
 * VERIFIED: (contract case "concurrent appends", all adapters) 64 un-awaited
 * appends receive disjoint offsets in invocation order.
 *
 * Overlapping reads: a handle that can never write (read-only) has nothing to
 * order its reads against, so an adapter whose backend reads run off-thread
 * (native files: libuv's thread pool) may let them overlap. They start in call
 * order while the bytes of all running reads fit maxReadBytes together, which
 * keeps the per-handle allocation bound of a serial queue. VERIFIED: (raw probe,
 * macOS arm64, warm cache) 4 KiB preads on one file reached 133k/s one at a time
 * and 303k/s with eight in flight.
 *
 * Size tracking: the handle is the file's only writer within the ownership
 * contract, so it learns the size from the backend once and then tracks it
 * through its own writes, appends and truncations. A failed mutation or a short
 * read makes it ask the backend again. VERIFIED: (probe, native) the size query
 * is an fstat thread-pool round trip as slow as the I/O it precedes (7.4 µs).
 *
 * Append batching: with a vectored backend write, appends that queue up while
 * another operation runs are written by one call when their turn comes. A lone
 * append on an idle handle starts at once, so batching adds no wait; batches
 * grow only under load. Any other operation queued between appends ends the
 * batch, so execution order stays call order. Each append keeps its own
 * promise, offset and admission; one completes only once all its bytes are
 * confirmed. VERIFIED: (raw probe, native, 4 KiB) one writev of 16 buffers costs
 * 1.0 µs per buffer against 8.9 µs for one awaited write each.
 *
 * Write buffer (opt-in, `writeBuffer` bytes): appends that fit are copied into
 * one per-handle buffer, which is written by one backend call when it fills and
 * before any operation that reads, overwrites, truncates, flushes or closes.
 * On an idle handle with a known size such an append completes without queuing:
 * nothing queued can observe it before the next queued operation drains. Why
 * opt-in: buffered bytes are invisible to other processes and lost on a crash
 * until written, and a failed buffer write is reported by the later operation
 * that needed it, not by the appends that already resolved.
 *
 * Admission: every public operation except close() reserves one operation slot,
 * and write/append also reserve their input size, before any copy or I/O. The
 * reservation is released when the operation settles, so bytes stay charged
 * while the backend is still writing them. VERIFIED: (stalled-backend tests)
 * retained copies never exceed maxPendingWriteBytes, rejected calls never reach
 * the backend, and both counters return to zero after success, failure and abort.
 */
export class ManagedFile implements StorageFile {
  readonly maxReadBytes: number;
  /** Settles after the last accepted task; never rejects, so one failure does not poison later tasks. */
  private tail: Promise<unknown> = Promise.resolve();
  /** Set by the first close() call; its presence is what makes the handle unavailable. */
  private closing: Promise<void> | undefined;
  /** Queued plus running operations. */
  private operations = 0;
  /** Bytes of write/append copies held by queued or running operations. */
  private writeBytes = 0;
  /** Size after this handle's last completed operation; undefined until queried, or after an uncertain mutation. */
  private knownSize: number | undefined;
  /** Overlapping mode only: bytes of reads now running, reads waiting for that budget, and every unsettled operation. */
  private readBytes = 0;
  private readonly waiting: { bytes: number; start: () => void }[] = [];
  private readonly unsettled = new Set<Promise<unknown>>();
  /** Appends queued behind the tail whose batch has not started; later appends join it. Every other queued operation ends it. */
  private group: QueuedAppend[] | undefined;
  /** Mutations queued so far; a stream read-ahead queued before the latest one is stale. */
  private mutations = 0;
  /** Let reads run concurrently; only for read-only handles whose backend tolerates concurrent reads. */
  private readonly overlapReads: boolean;
  /** Write-buffer capacity in bytes (0: off), the buffer once allocated, and its filled prefix. `knownSize` excludes buffered bytes. */
  private readonly capacity: number;
  private buffer: Uint8Array | undefined;
  private buffered = 0;
  constructor(
    readonly name: string,
    readonly readOnly: boolean,
    private readonly limits: HandleLimits,
    private readonly backend: ByteBackend,
    mode: { overlapReads?: boolean; writeBuffer?: number } = {},
  ) {
    this.maxReadBytes = limits.maxReadBytes;
    this.overlapReads = mode.overlapReads ?? false;
    this.capacity = mode.writeBuffer ?? 0;
  }

  get [ADMISSION](): { operations: number; writeBytes: number; readBytes: number } {
    return { operations: this.operations, writeBytes: this.writeBytes, readBytes: this.readBytes };
  }
  /** Throws CLOSED once close() was called; work accepted earlier still drains. */
  private ensureOpen(): void {
    if (this.closing) throw new StorageError("CLOSED", `defuss-storage: ${this.name} is closed`);
  }
  /**
   * Reserves one operation slot plus `bytes` of write budget; {@link release}
   * gives them back. Rejects instead of waiting when saturated, so there is
   * never an unbounded queue of callers waiting for capacity.
   */
  private admit(bytes: number): void {
    this.ensureOpen();
    if (this.operations >= this.limits.maxPendingOperations || this.writeBytes + bytes > this.limits.maxPendingWriteBytes) {
      throw new StorageError("QUEUE_FULL", `defuss-storage: ${this.name} has too much pending work; await earlier operations`);
    }
    this.operations++;
    this.writeBytes += bytes;
  }
  /**
   * Gives back one reservation of `writeBytes` and, on an overlapping handle,
   * `readBytes` of read budget. Called exactly once per admitted operation:
   * when its task settles, or when its input copy fails before it is queued.
   * Why counts instead of a release closure per call: VERIFIED: (interleaved
   * probe, memory adapter) counts saved 9–13 ns per read on Bun 1.4.3 and
   * 4–8 ns on Node.js 26.
   */
  private release(writeBytes: number, readBytes = 0): void {
    if (this.overlapReads) this.endRead(readBytes);
    this.operations--;
    this.writeBytes -= writeBytes;
  }
  /**
   * Runs `task` under an existing reservation and releases it when the task
   * settles, whatever the outcome. Serial handles append it to the queue;
   * overlapping handles start it as soon as `readBytes` fit the read budget.
   * A failed `mutation` forgets the tracked size: partial progress leaves it uncertain.
   *
   * One `then(onFulfilled, onRejected)` does release, size invalidation and error
   * normalization, so an operation creates as many promises as in 0.1.0.
   * `writeBytes` is the input reserved by {@link admit}.
   * VERIFIED: (per-operation probe, memory adapter, 5 runs × 100k) a 4 KiB append
   * costs 0.83–0.91 µs against 0.90–0.99 µs in 0.1.0.
   */
  private enqueue<T>(operation: string, writeBytes: number, task: () => T | Promise<T>, readBytes = 0, mutation = false): Promise<T> {
    if (mutation) this.mutations++;
    const started = this.overlapReads ? this.startRead(readBytes).then(task) : this.tail.then(task);
    const result = started.then(value => { this.release(writeBytes, readBytes); return value; }, (error: unknown) => {
      this.release(writeBytes, readBytes);
      if (mutation) this.knownSize = undefined;
      // Caller validation is performed before queuing; operational failures are normalized.
      throw storageError(error, operation);
    });
    const settled = result.then(() => undefined, () => undefined);
    if (this.overlapReads) {
      // A set, not a promise chain: one stalled read must not pin every later one in memory.
      this.unsettled.add(settled);
      void settled.then(() => this.unsettled.delete(settled));
    } else this.tail = settled;
    return result;
  }
  /** Admits and queues an operation that carries no write input; `readBytes` is its read length. */
  private run<T>(operation: string, task: () => T | Promise<T>, readBytes = 0, mutation = false): Promise<T> {
    this.admit(0);
    this.group = undefined;
    return this.enqueue(operation, 0, task, readBytes, mutation);
  }
  /**
   * Takes `bytes` of read budget now if it fits and nobody waits, else waits in
   * call order. An idle handle always admits the next read; each read is at most
   * maxReadBytes, so every waiter eventually starts. Waiters are bounded by
   * maxPendingOperations, because each holds an admitted operation slot.
   */
  private startRead(bytes: number): Promise<void> {
    if (this.waiting.length === 0 && (this.readBytes === 0 || this.readBytes + bytes <= this.limits.maxReadBytes)) {
      this.readBytes += bytes;
      return Promise.resolve();
    }
    return new Promise(start => this.waiting.push({ bytes, start }));
  }
  /** Returns `bytes` of read budget and starts waiting reads, in call order, while they fit. */
  private endRead(bytes: number): void {
    this.readBytes -= bytes;
    for (let next = this.waiting[0]; next; next = this.waiting[0]) {
      if (this.readBytes !== 0 && this.readBytes + next.bytes > this.limits.maxReadBytes) break;
      this.waiting.shift();
      this.readBytes += next.bytes;
      next.start();
    }
  }
  /** Settles once every operation accepted so far has settled. */
  private drained(): Promise<unknown> {
    return this.overlapReads ? Promise.all(this.unsettled) : this.tail;
  }
  /**
   * Admits a write/append input and takes its call-time copy, or its buffer when
   * `transfer` is set. The reservation precedes both, so a rejected call never
   * allocates and never detaches the caller's buffer, and a failing copy
   * (allocation failure) gives its reservation back.
   */
  private admitCopy(data: Uint8Array, transfer: boolean): Uint8Array {
    const length = data.length;
    this.admit(length);
    try { return transfer ? take(data) : new Uint8Array(data); } catch (error) { this.release(length); throw error; }
  }
  /** Throws RangeError for a single input above maxWriteBytes, mirroring the maxReadBytes contract. */
  private writeLength(length: number): void {
    if (length > this.limits.maxWriteBytes) throw new RangeError("defuss-storage: maxWriteBytes exceeded");
  }
  /** Throws READ_ONLY for mutations on a read-only handle. */
  private writable(): void {
    if (this.readOnly) throw new StorageError("READ_ONLY", `defuss-storage: ${this.name} is read-only`);
  }
  /** Validates a read window, including the per-call allocation bound. */
  private readRange(offset: number, length: number): void {
    range(offset, length);
    if (length > this.maxReadBytes) throw new RangeError("defuss-storage: maxReadBytes exceeded");
  }
  /**
   * The backend's size as a validated safe integer. Every size the queue acts on
   * goes through here, so a broken custom backend fails with IO_ERROR instead of
   * being mistaken for EOF (a negative or NaN size would otherwise read as empty).
   */
  private async currentSize(): Promise<number> {
    this.knownSize ??= integer(await this.backend.size(), "file size");
    return this.knownSize;
  }
  /**
   * Reads into the first `length` bytes of `target` until full or EOF (0) and
   * returns the bytes read.
   *
   * `length` is the window admitted at call time. A borrowed readInto target
   * can be detached or resized (resizable ArrayBuffer) while the call waits in
   * the queue or between partial reads; checking its length before every
   * backend read turns that into an error instead of a silent zero-byte success
   * or a read past the admitted (maxReadBytes-checked) length. Each backend read
   * gets a fixed-length window, never a length-tracking view. VERIFIED: (readInto
   * borrowed-target test) detached, grown and shrunk targets reject IO_ERROR,
   * also when resized between two partial reads.
   *
   * A synchronous backend completes the loop here instead of crossing an
   * internal async promise on every chunk. A promise hands the rest of the loop
   * to {@link finishFill}; later calls may be synchronous again. VERIFIED:
   * (21 alternating rounds, memory adapter) this saved 31–59 ns per 4 KiB
   * read on Node.js 26 and Bun 1.4.3 against the always-async loop.
   */
  private fill(offset: number, target: Uint8Array, length: number, options: IOOptions): number | Promise<number> {
    let used = 0;
    while (used < length) {
      checkAbort(options.signal);
      if (target.length !== length) throw new TypeError("defuss-storage: borrowed readInto target was detached or resized");
      const count = this.backend.read(offset + used, target.subarray(used, length));
      if (typeof count !== "number") return this.finishFill(offset, target, length, options, used, count);
      if (!Number.isSafeInteger(count) || count < 0 || count > length - used) throw new Error("invalid backend read count");
      if (!count) break;
      used += count;
    }
    return used;
  }
  /** Async continuation of {@link fill}, entered only when a backend returns a promise. */
  private async finishFill(offset: number, target: Uint8Array, length: number, options: IOOptions, used: number, pending: Promise<number>): Promise<number> {
    let count = await pending;
    for (;;) {
      if (!Number.isSafeInteger(count) || count < 0 || count > length - used) throw new Error("invalid backend read count");
      if (!count) return used;
      used += count;
      if (used === length) return used;
      checkAbort(options.signal);
      if (target.length !== length) throw new TypeError("defuss-storage: borrowed readInto target was detached or resized");
      count = await this.backend.read(offset + used, target.subarray(used, length));
    }
  }
  /** Writes all of `data`, retrying short writes; zero progress throws instead of spinning forever. */
  private async put(offset: number, data: Uint8Array, options: IOOptions): Promise<void> {
    let used = 0;
    while (used < data.length) {
      checkAbort(options.signal);
      const count = await this.backend.write(offset + used, data.subarray(used));
      if (!Number.isSafeInteger(count) || count <= 0 || count > data.length - used) throw new Error("invalid backend write count");
      used += count;
    }
  }
  /**
   * Writes the buffered appends at EOF. Runs inside a queued task, so no append
   * fills the buffer meanwhile. A failure discards them, since any prefix may
   * have landed, and makes the handle query its size again.
   */
  private async drain(): Promise<void> {
    const length = this.buffered;
    this.buffered = 0;
    try {
      const at = this.knownSize ?? await this.currentSize();
      await this.put(at, this.buffer!.subarray(0, length), {});
      this.knownSize = at + length;
    } catch (error) {
      this.knownSize = undefined;
      throw storageError(error, "write buffered appends");
    }
  }
  async size(): Promise<number> {
    return this.run("size", async () => (this.knownSize ?? await this.currentSize()) + this.buffered);
  }
  /** Allocates at most min(length, bytes before EOF), so reading past EOF never allocates `length`. */
  async read(offset: number, length: number, options: IOOptions = {}): Promise<Uint8Array> {
    this.readRange(offset, length);
    return this.run("read", async () => {
      checkAbort(options.signal);
      if (this.buffered) await this.drain();
      // The tracked size directly. VERIFIED: (interleaved probe, memory adapter)
      // awaiting the async currentSize() even when the size is known cost about
      // 24 ns per read.
      const available = Math.max(0, (this.knownSize ?? await this.currentSize()) - offset);
      const result = new Uint8Array(Math.min(length, available));
      const count = await this.fill(offset, result, result.length, options);
      if (count === result.length) return result;
      // No write of this handle runs during the read, so a short count means a
      // writer outside the ownership contract shrank the file: stop trusting the
      // tracked size and return what was read.
      this.knownSize = undefined;
      return result.slice(0, count);
    }, length);
  }
  /**
   * Zero-allocation read for callers that reuse buffers. `target` is borrowed
   * until the promise settles; the caller must keep it attached and unresized,
   * otherwise the read rejects (see {@link ManagedFile.fill}).
   */
  async readInto(offset: number, target: Uint8Array, options: IOOptions = {}): Promise<number> {
    bytes(target); this.readRange(offset, target.length);
    const length = target.length;
    return this.run("readInto", () => {
      checkAbort(options.signal);
      return this.buffered ? this.drain().then(() => this.fill(offset, target, length, options)) : this.fill(offset, target, length, options);
    }, length);
  }
  async readExactly(offset: number, length: number, options: IOOptions = {}): Promise<Uint8Array> {
    this.readRange(offset, length);
    return this.run("readExactly", () => {
      checkAbort(options.signal);
      const result = new Uint8Array(length);
      const exact = (count: number): Uint8Array => {
        if (count !== length) throw new StorageError("UNEXPECTED_EOF", `defuss-storage: expected ${length} bytes at ${offset}, read ${count}`);
        return result;
      };
      const reading = this.buffered ? this.drain().then(() => this.fill(offset, result, length, options)) : this.fill(offset, result, length, options);
      return typeof reading === "number" ? exact(reading) : reading.then(exact);
    }, length);
  }
  /**
   * Copies `data` at call time, so the caller may reuse its buffer immediately.
   * No rollback: an abort or I/O failure between partial writes leaves the bytes written so far.
   */
  async write(offset: number, data: Uint8Array, options: WriteOptions = {}): Promise<void> {
    bytes(data); range(offset, data.length); this.writeLength(data.length); const transfer = transferOption(data, options);
    this.writable(); this.ensureOpen(); checkAbort(options.signal);
    const owned = this.admitCopy(data, transfer);
    this.group = undefined;
    return this.enqueue("write", owned.length, async () => {
      checkAbort(options.signal);
      if (this.buffered) await this.drain();
      await this.put(offset, owned, options);
      // An empty write never extends the file.
      if (this.knownSize !== undefined && owned.length) this.knownSize = Math.max(this.knownSize, offset + owned.length);
    }, 0, true);
  }
  /**
   * EOF is chosen inside the queued task, so concurrent appends get disjoint,
   * invocation-ordered offsets. The append joins the batch still waiting at the
   * queue's tail, if any; whichever pending member's task runs first writes the
   * batch (see {@link ManagedFile.lead}), and the others report what it recorded.
   */
  async append(data: Uint8Array, options: WriteOptions = {}): Promise<AppendResult> {
    bytes(data); this.writeLength(data.length); const transfer = transferOption(data, options);
    this.writable(); this.ensureOpen(); checkAbort(options.signal);
    if (this.capacity && data.length <= this.capacity) {
      if (this.operations === 0 && this.knownSize !== undefined && this.buffered + data.length <= this.capacity) {
        // Idle handle, known size, room in the buffer: nothing queued can observe this append first.
        const offset = this.knownSize + this.buffered;
        range(offset, data.length);
        (this.buffer ??= new Uint8Array(this.capacity)).set(data, this.buffered);
        this.buffered += data.length;
        this.mutations++;
        if (transfer) take(data);
        return { offset, byteLength: data.length };
      }
      const owned = this.admitCopy(data, transfer);
      // A buffered append is no batch member, and a later batch must not jump ahead of it.
      this.group = undefined;
      return this.enqueue("append", owned.length, () => this.bufferAppend(owned, options), 0, true);
    }
    const owned = this.admitCopy(data, transfer);
    const entry: QueuedAppend = { data: owned, options, offset: 0 };
    const group = this.group ?? [];
    group.push(entry);
    const result = this.enqueue("append", owned.length, () => entry.outcome ? settle(entry.outcome) : this.lead(group, entry), 0, true);
    // Without a vectored write a batch could not share a call, so every append stays alone.
    if (this.backend.writev) this.group = group;
    return result;
  }
  /**
   * Writes `first` and every later pending member of its batch back to back at
   * EOF, then returns `first`'s outcome. Members whose signal fired before the
   * batch started write nothing, as a queued append would.
   *
   * Outcomes stay per append: a member completes once all its bytes are
   * confirmed; a failing call (or size query) fails every member it carried,
   * since any of their bytes may have landed; a member cancelled between partial
   * writes fails alone, and the members after it, which no call has carried
   * yet, stay pending, so the next one's own task writes them as a new batch.
   * VERIFIED: (append batching tests) short, failing and cancelled batches.
   * VERIFIED: (probe, Node 26 and Bun 1.4) FileHandle.writev writes 5,000
   * buffers in one call, beyond IOV_MAX (1,024), so batches need no cap besides
   * admission.
   */
  /** Places a queued append that fits the write buffer, writing the buffer first if it is full. */
  private async bufferAppend(data: Uint8Array, options: IOOptions): Promise<AppendResult> {
    checkAbort(options.signal);
    if (this.buffered + data.length > this.capacity) await this.drain();
    const offset = (this.knownSize ?? await this.currentSize()) + this.buffered;
    range(offset, data.length);
    (this.buffer ??= new Uint8Array(this.capacity)).set(data, this.buffered);
    this.buffered += data.length;
    return { offset, byteLength: data.length };
  }
  private async lead(group: QueuedAppend[], first: QueuedAppend): Promise<AppendResult> {
    if (this.group === group) this.group = undefined;
    // Appends larger than the write buffer follow the buffered ones.
    if (this.buffered) await this.drain();
    if (group.length === 1) {
      // Alone in its batch (the common case for awaited appends): the loop below without its bookkeeping.
      checkAbort(first.options.signal);
      const offset = this.knownSize ?? await this.currentSize();
      range(offset, first.data.length);
      await this.put(offset, first.data, first.options);
      this.knownSize = offset + first.data.length;
      return { offset, byteLength: first.data.length };
    }
    const members: QueuedAppend[] = [];
    for (let i = group.indexOf(first); i < group.length; i++) {
      const member = group[i]!;
      if (member.outcome) continue;
      try { checkAbort(member.options.signal); members.push(member); } catch (error) { member.outcome = { error }; }
    }
    // Every member was cancelled before any I/O.
    if (!members.length) return settle(first.outcome!);
    let next = 0;
    try {
      const start = this.knownSize ?? await this.currentSize();
      let end = start;
      for (const member of members) { range(end, member.data.length); member.offset = end; end += member.data.length; }
      for (let done = start; ;) {
        for (let m = members[next]; m && m.offset + m.data.length <= done; m = members[++next]) m.outcome = { result: { offset: m.offset, byteLength: m.data.length } };
        if (next === members.length) break;
        const current = members[next]!;
        try { checkAbort(current.options.signal); } catch (error) { current.outcome = { error }; break; }
        const chunks = members.slice(next).map(m => m.data.subarray(Math.max(0, done - m.offset)));
        const count = await (chunks.length > 1 && this.backend.writev ? this.backend.writev(done, chunks) : this.backend.write(done, chunks[0]!));
        if (!Number.isSafeInteger(count) || count <= 0 || count > end - done) throw new Error("invalid backend write count");
        done += count;
      }
      this.knownSize = next === members.length ? end : undefined;
    } catch (error) {
      for (; next < members.length; next++) members[next]!.outcome = { error };
      this.knownSize = undefined;
    }
    return settle(first.outcome!);
  }
  async truncate(size: number, options: IOOptions = {}): Promise<void> {
    integer(size, "size"); this.writable();
    return this.run("truncate", async () => {
      checkAbort(options.signal);
      if (this.buffered) await this.drain();
      await this.backend.truncate(size);
      this.knownSize = size;
    }, 0, true);
  }
  /** Allowed on read-only handles: flushing persists nothing new but is harmless. */
  async flush(): Promise<void> {
    return this.run("flush", async () => {
      if (this.buffered) await this.drain();
      await this.backend.flush();
    });
  }
  /**
   * Marks the handle closed immediately, waits for accepted tasks, then closes
   * the backend (which releases ownership). Never subject to admission, so a
   * saturated handle can always be closed. Every call returns the same promise,
   * so concurrent closers observe one outcome and the backend closes once.
   *
   * A failed close is final, not retried: the resource state is uncertain, so
   * the built-in adapters keep the name owned (quarantined) until the owning
   * realm or worker ends. This differs from ordinary I/O errors, after which
   * the queue stays usable. Buffered appends are written first; if that fails
   * the backend still closes (releasing ownership) and close rejects with the
   * buffer-write error.
   */
  close(): Promise<void> {
    this.closing ??= this.drained().then(async () => {
      let lost: unknown;
      if (this.buffered) await this.drain().catch((error: unknown) => { lost = error; });
      this.buffer = undefined;
      try { await this.backend.close(); } catch (error) { throw storageError(error, "close"); }
      if (lost !== undefined) throw lost;
    });
    return this.closing;
  }
  /**
   * Yields owned chunks of `[start, end)`, reading one chunk ahead of a slow consumer.
   *
   * Each chunk is its own queued readExactly. When the consumer spent at least
   * {@link READ_AHEAD_AFTER_MS} on the last timed chunk (the first, then every
   * {@link READ_AHEAD_SAMPLE_EVERY}th), the read of the next
   * chunk is queued just before the current one is yielded, so it runs while
   * the consumer works. A faster consumer gains nothing from the overlap and
   * would pay for it (see the constant), so its chunks are read at their pull.
   * A paused consumer therefore holds at most one read chunk, and its queue
   * slot only until that read settles; a saturated handle skips the read-ahead
   * rather than take the last slot from other callers.
   *
   * The end offset is fixed on the first pull (later appends are excluded) but
   * bytes are not snapshotted: overwrites become visible, and a shrink below the
   * unread range rejects UNEXPECTED_EOF. A read-ahead is used only if no
   * mutation was queued after it and the handle is still open, which is when a
   * read at pull time would return the same bytes; otherwise its chunk is read
   * again at the pull. Its error, if any, surfaces only at that pull. As an async
   * generator, validation runs on the first `next()`, not when `stream()` is called.
   * VERIFIED: (contract case "a mutation queued after a read-ahead") a write and
   * a truncation queued after the read-ahead are seen by its chunk.
   */
  async *stream(options: StreamOptions = {}): AsyncIterableIterator<Uint8Array> {
    const start = integer(options.start ?? 0, "start");
    const chunkSize = integer(options.chunkSize ?? Math.min(65536, this.maxReadBytes), "chunkSize", true);
    if (chunkSize > this.maxReadBytes) throw new RangeError("defuss-storage: chunkSize exceeds maxReadBytes");
    if (options.end !== undefined) {
      integer(options.end, "end");
      if (options.end < start) throw new RangeError("defuss-storage: end precedes start");
    }
    checkAbort(options.signal);
    const end = Math.min(options.end ?? Number.MAX_SAFE_INTEGER, await this.size());
    let ahead: { chunk: Promise<Uint8Array>; mutations: number } | undefined;
    /** Milliseconds the consumer spent on the last timed chunk. */
    let busy = 0;
    let pulls = 0;
    for (let offset = start; offset < end;) {
      checkAbort(options.signal);
      const length = Math.min(chunkSize, end - offset);
      const current = ahead?.mutations === this.mutations && !this.closing ? ahead.chunk : this.readExactly(offset, length, options);
      ahead = undefined;
      const chunk = await current;
      offset += length;
      if (busy >= READ_AHEAD_AFTER_MS && offset < end && this.operations < this.limits.maxPendingOperations) {
        const next = this.readExactly(offset, Math.min(chunkSize, end - offset), options);
        // Handled here so an abandoned read-ahead never surfaces; its own pull still awaits and rethrows it.
        next.catch(() => undefined);
        ahead = { chunk: next, mutations: this.mutations };
      }
      const timed = pulls++ % READ_AHEAD_SAMPLE_EVERY === 0;
      const yielded = timed ? performance.now() : 0;
      yield chunk;
      if (timed) busy = performance.now() - yielded;
    }
  }
}
