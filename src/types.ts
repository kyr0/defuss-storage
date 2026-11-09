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
  /** Requires an existing file; still acquires exclusive handle ownership. */
  readOnly?: boolean;
  /**
   * Bytes of appends to collect before one backend write; default 0 (off).
   * Appends up to this size resolve once copied into the buffer, which is
   * written when full and before any read, write, truncate, flush or close.
   * Until then the bytes are invisible to other processes and lost on a crash,
   * and a failed buffer write rejects the later operation that needed it. One
   * allocation of this size per handle, outside the admission budget. Not
   * allowed with readOnly.
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
  /** Bytes of write/append input copies a handle may hold queued or in flight; default 64 MiB. */
  maxPendingWriteBytes?: number;
  /** Queued plus running operations per handle; default 1,024. close() is always admitted. */
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
}

/** Where {@link StorageFile.append} placed its bytes. */
export interface AppendResult { offset: number; byteLength: number }

/**
 * An open, exclusively owned byte file.
 *
 * Every operation is queued on the handle and runs in invocation order, so
 * `append` can choose EOF and write without racing other calls on the same
 * handle. A read-only native handle may run reads concurrently; they start in
 * call order and, because nothing writes, return the same bytes. Offsets are explicit; there is no shared seek cursor to corrupt.
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
   * or a short read. Writers outside the ownership contract are not observed.
   */
  size(): Promise<number>;
  /** Returns up to length bytes; EOF is an empty array. Output is owned by caller. */
  read(offset: number, length: number, options?: IOOptions): Promise<Uint8Array>;
  /** Fills target until full or EOF, returning bytes read. */
  readInto(offset: number, target: Uint8Array, options?: IOOptions): Promise<number>;
  /** Rejects with UNEXPECTED_EOF rather than silently returning partial input. */
  readExactly(offset: number, length: number, options?: IOOptions): Promise<Uint8Array>;
  /** Fully writes a call-time copy (or the handed-over buffer, see {@link WriteOptions}). Extending beyond EOF zero-fills the gap. */
  write(offset: number, data: Uint8Array, options?: WriteOptions): Promise<void>;
  /**
   * Serializes EOF selection and write against other operations on this handle.
   * Appends queued together may share one backend write; each still resolves
   * only once all its own bytes are written.
   */
  append(data: Uint8Array, options?: WriteOptions): Promise<AppendResult>;
  /** Shrinks or zero-extends to `size`; discarded bytes never reappear on regrowth. */
  truncate(size: number, options?: IOOptions): Promise<void>;
  /** Memory: no-op. Native: fsync of this file. OPFS: sync-handle flush. No directory or multi-file durability. */
  flush(): Promise<void>;
  /**
   * Drains already queued operations, then releases the resource and ownership.
   * Never subject to admission; repeated calls return the same promise. A failed
   * close is not retried and keeps the name owned until the owner context ends.
   */
  close(): Promise<void>;
  /**
   * Owned chunks, read one chunk ahead once the consumer spends 5 µs or more per
   * chunk; a chunk read ahead is read again if a mutation was queued after it.
   * Does not close this caller-owned handle.
   */
  stream(options?: StreamOptions): AsyncIterableIterator<Uint8Array>;
}

/** A flat namespace of byte files with one owner per name. */
export interface StorageAdapter {
  readonly capabilities: StorageCapabilities;
  /** Opens `name` with exclusive ownership; rejects BUSY while another handle owns it. */
  open(name: string, options?: OpenOptions): Promise<StorageFile>;
  /** Sorted flat names. No recursion; no snapshot under concurrent mutations. */
  list(): Promise<string[]>;
  /** False if absent; BUSY if an owned handle is open. */
  remove(name: string): Promise<boolean>;
}
