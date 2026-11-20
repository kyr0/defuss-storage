/**
 * Platform-neutral public contracts.
 *
 * These declarations avoid DOM and Node ambient types, so a consumer can
 * typecheck against any entry point with `"types": []`. VERIFIED: the
 * packed-consumer test (`scripts/package-test.mjs`) typechecks a fresh
 * consumer of every entry point with `types: []` and `skipLibCheck: false`.
 *
 * @module
 */

/** Structural subset of AbortSignal, usable without DOM or Node ambient types. */
export interface CancellationSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
}

/**
 * Per-operation options. The signal is checked before the queued task starts
 * and between partial I/O steps; it cannot interrupt a native call already in flight.
 */
export interface IOOptions { signal?: CancellationSignal }

/** Options for {@link StorageFile.write} and {@link StorageFile.append}. */
export interface WriteOptions extends IOOptions {
  /**
   * Hand the input's buffer over instead of copying it. `data` must cover its
   * whole ArrayBuffer; once the call is admitted that buffer is detached and
   * the caller must not use it again. Default false (copy at call time).
   */
  transfer?: boolean;
}

/** Options for {@link appendChunks}; `transfer` applies to every chunk. */
export interface AppendChunksOptions extends WriteOptions {
  /**
   * Appends kept outstanding at once; default 1 (each append settles before the
   * next source pull). Must fit the handle's admission budget.
   */
  inFlight?: number;
}

/** Range and chunking for {@link StorageFile.stream}. */
export interface StreamOptions extends IOOptions {
  /** Inclusive start byte offset. Default 0. */
  start?: number;
  /** Exclusive upper byte offset, clamped to the size observed on the first pull. */
  end?: number;
  /** Default 64 KiB; must not exceed this adapter's maxReadBytes. */
  chunkSize?: number;
}

/** How {@link StorageAdapter.open} treats a missing or existing file. */
export interface OpenOptions {
  /** Default false. Opening a missing file otherwise fails. */
  create?: boolean;
  /** Require a new file. Requires create:true. */
  exclusive?: boolean;
  /** Requires an existing file. Shared with other read-only handles unless `shared` is false. */
  readOnly?: boolean;
  /**
   * Share the file with other handles of the same kind instead of owning it.
   * Default: `readOnly`, so read-only opens are shared and writable opens own
   * the file. Shared readers, shared writers and an owner exclude one another:
   * an open of one kind rejects BUSY while a handle of another kind is open, and
   * a removal rejects BUSY while any handle is. Any number of handles of one
   * shared kind may be open at once, within the adapter's ownership scope (see
   * {@link StorageCapabilities.ownership}): on OPFS and directory handles that
   * includes other workers and tabs.
   *
   * Shared readers (`readOnly: true`): for parallel scans, each worker opens the
   * file and reads its own byte range. `shared: false` makes a read-only owner.
   *
   * Shared writers (`readOnly` false): every handle writes at explicit offsets,
   * and the caller keeps their byte ranges apart. `append` rejects UNSUPPORTED,
   * since other writers move the end of the file; `size()` and `read` ask the
   * file each time instead of tracking its size; `writeBuffer` is not allowed.
   * Adapters without {@link StorageCapabilities.sharedWriters} reject UNSUPPORTED.
   */
  shared?: boolean;
  /**
   * Bytes of appends to collect before one backend write; default 0 (off).
   * Appends up to this size resolve once copied into the buffer, which is
   * written when full and before any read, write, truncate, flush or close.
   * Until then the bytes are invisible to other processes and lost on a crash,
   * and a failed buffer write rejects the later operation that needed it. One
   * allocation of this size per handle, outside the admission budget. Not
   * allowed with readOnly or a shared writer.
   */
  writeBuffer?: number;
}

/**
 * Per-handle bounds on queued work. Every open handle gets its own budget;
 * other handles, caller buffers, returned read arrays and the memory adapter's
 * stored bytes are outside it, so this is not a process-wide memory ceiling.
 *
 * Saturation rejects at call time with QUEUE_FULL instead of waiting: there is
 * no secondary queue of blocked callers. Producers get backpressure by awaiting
 * their operations or by using {@link appendChunks}.
 *
 * Each value is a positive safe integer. If only one of the two byte bounds is
 * set, the other default moves to keep `maxWriteBytes <= maxPendingWriteBytes`;
 * setting both inconsistently throws RangeError.
 */
export interface AdmissionOptions {
  /** Largest single write/append input; default 64 MiB. A larger input throws RangeError. */
  maxWriteBytes?: number;
  /** Bytes of write/append input copies a handle may hold queued or in flight; default 128 MiB. */
  maxPendingWriteBytes?: number;
  /** Queued plus running operations per handle; default 2,048. close() is always admitted. */
  maxPendingOperations?: number;
}

/** Options common to every adapter constructor and to createStorageFile. */
export interface AdapterOptions extends AdmissionOptions {
  /** Allocation bound per read/chunk; default 64 MiB. */
  maxReadBytes?: number;
}

/**
 * What an adapter does and does not guarantee. Capabilities are reported
 * instead of emulated, so a record layer can refuse an unsafe configuration
 * rather than assume a guarantee that is absent.
 */
export interface StorageCapabilities {
  /** Bytes survive the adapter instance (native files, OPFS) or not (memory). */
  readonly persistent: boolean;
  /** flush does not include parent-directory or multi-file commit guarantees. */
  readonly flush: "memory" | "file";
  /** Scope in which one open handle excludes other opens and removals of the same name. */
  readonly ownership: "instance" | "realm-cooperative" | "origin-cooperative";
  /** Always false in v0.1: streams and reads see later overwrites. */
  readonly snapshots: false;
  /** Always false in v0.1: no atomic rename or replace. */
  readonly atomicReplace: false;
  /**
   * Several handles can write one file at once (see {@link OpenOptions.shared}).
   * Memory and native files: true. OPFS: where the browser has
   * `readwrite-unsafe` sync access handles (Chromium). Directory handles: false.
   * Absent (adapters written against 0.3) means false.
   */
  readonly sharedWriters?: boolean;
}

/** Where {@link StorageFile.append} placed its bytes. */
export interface AppendResult { offset: number; byteLength: number }

/**
 * An open byte file: owned by this handle, or shared (see {@link OpenOptions.shared}).
 *
 * Every operation is queued on the handle and takes effect in invocation order,
 * so `append` can choose EOF and write without racing other calls on the same
 * handle. A native handle with asynchronous I/O and no write buffer may run
 * reads concurrently between two mutations; each read still sees exactly the
 * writes, appends and truncations called before it. Offsets are explicit; there
 * is no shared seek cursor to corrupt.
 * Validation errors reject before queuing; admission (see {@link AdmissionOptions})
 * rejects QUEUE_FULL before copying any input; operational errors reject with a
 * {@link StorageError} and leave the queue usable.
 */
export interface StorageFile {
  readonly name: string;
  readonly readOnly: boolean;
  /** Largest length accepted by read, readExactly, readInto and stream chunks. */
  readonly maxReadBytes: number;
  /**
   * Current byte size, ordered after all previously queued operations. Tracked
   * by the handle after one backend query; re-queried after a failed mutation
   * or a short read. A shared writer asks the file every time, so it sees the
   * other writers' extensions. Writers outside the ownership contract are not observed.
   */
  size(): Promise<number>;
  /** Returns up to length bytes; EOF is an empty array. Output is owned by caller. */
  read(offset: number, length: number, options?: IOOptions): Promise<Uint8Array>;
  /** Fills target until full or EOF, returning bytes read. */
  readInto(offset: number, target: Uint8Array, options?: IOOptions): Promise<number>;
  /** Rejects with UNEXPECTED_EOF rather than silently returning partial input. */
  readExactly(offset: number, length: number, options?: IOOptions): Promise<Uint8Array>;
  /**
   * Fully writes the bytes `data` holds at call time: a copy, the handed-over
   * buffer (see {@link WriteOptions}), or, where the adapter's I/O is synchronous
   * and the handle idle, `data` itself before the call returns. Extending beyond
   * EOF zero-fills the gap.
   */
  write(offset: number, data: Uint8Array, options?: WriteOptions): Promise<void>;
  /**
   * Serializes EOF selection and write against other operations on this handle.
   * Appends queued together may share one backend write; each still resolves
   * only once all its own bytes are written. Rejects UNSUPPORTED on a shared writer.
   */
  append(data: Uint8Array, options?: WriteOptions): Promise<AppendResult>;
  /** Shrinks or zero-extends to `size`; discarded bytes never reappear on regrowth. */
  truncate(size: number, options?: IOOptions): Promise<void>;
  /**
   * Memory: no-op. Native: fsync of this file. OPFS: sync-handle flush. No
   * directory or multi-file durability. Flushes queued together share one
   * backend flush: an earlier one resolves with the outcome of a later one,
   * which covers every byte written before either.
   */
  flush(): Promise<void>;
  /**
   * Drains already queued operations, then releases the resource and ownership.
   * Never subject to admission; repeated calls return the same promise. A failed
   * close is not retried and keeps the name owned until the owner context ends.
   */
  close(): Promise<void>;
  /**
   * Owned chunks. Chunks below 64 KiB are cut from blocks of up to 64 KiB (and
   * at most maxReadBytes), each read by one backend call; the next block is read
   * ahead once the consumer spends 5 µs or more per block. Bytes read before
   * their pull are read again if a mutation was queued since. Does not close
   * this caller-owned handle.
   */
  stream(options?: StreamOptions): AsyncIterableIterator<Uint8Array>;
}

/** A flat namespace of byte files with one owner per name. */
export interface StorageAdapter {
  readonly capabilities: StorageCapabilities;
  /** Opens `name` as its owner, or shared with other handles of its kind (see {@link OpenOptions.shared}); rejects BUSY on a conflict. */
  open(name: string, options?: OpenOptions): Promise<StorageFile>;
  /** Sorted flat names. No recursion; no snapshot under concurrent mutations. */
  list(): Promise<string[]>;
  /** False if absent; BUSY if any handle of it is open. */
  remove(name: string): Promise<boolean>;
}
