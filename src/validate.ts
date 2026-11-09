/**
 * Argument validation shared by all adapters.
 *
 * Every check runs synchronously before an operation is queued, so invalid
 * input rejects without touching storage and without occupying a queue slot.
 * Failures are `TypeError`/`RangeError`, not {@link StorageError}, because they
 * are caller bugs rather than operational conditions.
 *
 * @module
 */
import { StorageError } from "./errors.js";
import type { AdapterOptions, CancellationSignal, OpenOptions, WriteOptions } from "./types.js";

/** Default per-read allocation bound (64 MiB), so a corrupt length field fails with RangeError instead of allocating gigabytes. */
export const DEFAULT_MAX_READ_BYTES = 64 * 1024 * 1024;
/**
 * Admission defaults. Starting policies, not measured optima: 64 MiB lets one
 * maximal write be in flight while a handle still bounds its retained copies;
 * 1,024 operations allow deep pipelining of small reads.
 */
export const DEFAULT_MAX_WRITE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_PENDING_WRITE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_PENDING_OPERATIONS = 1024;

/** Resolved per-handle bounds; one immutable object per adapter, shared by its handles. */
export interface HandleLimits {
  readonly maxReadBytes: number;
  readonly maxWriteBytes: number;
  readonly maxPendingWriteBytes: number;
  readonly maxPendingOperations: number;
}

/**
 * Returns `value` if it is a safe integer ≥ 0 (or ≥ 1 when `positive`).
 * Safe integers keep offset arithmetic exact; larger doubles silently round.
 */
export function integer(value: number, label: string, positive = false): number {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw new RangeError(`defuss-storage: ${label} must be a ${positive ? "positive" : "nonnegative"} safe integer`);
  }
  return value;
}

/** Checks `offset`, `length` and their sum, so `offset + length` can never round past `Number.MAX_SAFE_INTEGER`. */
export function range(offset: number, length: number): void {
  integer(offset, "offset"); integer(length, "length"); integer(offset + length, "range end");
}

/**
 * Accepts a non-shared, attached `Uint8Array` view (Node `Buffer` included).
 * Shared buffers are refused because another thread could mutate them while a
 * queued write copies or a backend reads them.
 */
export function bytes(value: Uint8Array): void {
  if (!(value instanceof Uint8Array)) throw new TypeError("defuss-storage: expected Uint8Array");
  if (typeof SharedArrayBuffer !== "undefined" && value.buffer instanceof SharedArrayBuffer) {
    throw new TypeError("defuss-storage: shared byte buffers are unsupported");
  }
  // Accessing a detached buffer must fail before queuing any I/O.
  new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

/**
 * Validates `transfer` and returns it. A handed-over buffer must be the whole
 * of `data`'s ArrayBuffer: detaching a larger one would break the caller's
 * other views of it, such as Node's shared pool behind small `Buffer`s.
 */
export function transferOption(data: Uint8Array, options: WriteOptions): boolean {
  if (options.transfer === undefined) return false;
  if (typeof options.transfer !== "boolean") throw new TypeError("defuss-storage: transfer must be boolean");
  if (options.transfer && (data.byteOffset !== 0 || data.byteLength !== data.buffer.byteLength)) {
    throw new TypeError("defuss-storage: transfer requires a Uint8Array covering its whole ArrayBuffer");
  }
  return options.transfer;
}

/**
 * Accepts portable flat names: 1–128 of `[a-z0-9._-]`, starting with a letter
 * or digit, no trailing dot, no Windows device name.
 *
 * Why this strict: lowercase-only names cannot alias on case-insensitive file
 * systems (APFS, NTFS), so the ownership key `root + name` is canonical
 * (VERIFIED: macOS APFS probe, 2026-11-07, together with realpath in node.ts); no
 * separators or leading dots means no traversal and no hidden files; the same
 * set is valid on POSIX, Windows and OPFS, so data moves between adapters.
 */
export function validateName(name: string): void {
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(name) || name.endsWith(".") ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/.test(name)) {
    throw new TypeError("defuss-storage: expected a portable lowercase flat name (1–128 characters)");
  }
}

/**
 * Normalizes {@link OpenOptions} to explicit values and rejects the
 * contradictory combinations `exclusive` without `create`, `readOnly` with
 * `create`, and `readOnly` with a write buffer.
 */
export function openOptions(options: OpenOptions): Required<OpenOptions> {
  for (const key of ["create", "exclusive", "readOnly"] as const) {
    if (options[key] !== undefined && typeof options[key] !== "boolean") throw new TypeError(`defuss-storage: ${key} must be boolean`);
  }
  const result = {
    create: options.create ?? false, exclusive: options.exclusive ?? false, readOnly: options.readOnly ?? false,
    writeBuffer: integer(options.writeBuffer ?? 0, "writeBuffer"),
  };
  if (result.exclusive && !result.create) throw new TypeError("defuss-storage: exclusive requires create:true");
  if (result.readOnly && result.create) throw new TypeError("defuss-storage: readOnly cannot create files");
  if (result.readOnly && result.writeBuffer) throw new TypeError("defuss-storage: writeBuffer requires a writable handle");
  return result;
}

/** Throws `ABORTED` (with the signal's reason as `cause`) if `signal` is already aborted. */
export function checkAbort(signal?: CancellationSignal): void {
  if (signal?.aborted) throw new StorageError("ABORTED", "defuss-storage: operation aborted", { cause: signal.reason });
}

/**
 * Validates and resolves {@link AdapterOptions} once per adapter.
 *
 * An explicit bound below (or above) the other byte default moves that default
 * instead of failing, so `{ maxPendingWriteBytes: 1024 }` alone is valid; only
 * an explicitly inconsistent pair throws. VERIFIED: (admission options contract
 * case) non-positive, fractional and non-finite values and an inconsistent pair
 * throw RangeError on every adapter.
 */
export function handleLimits(options: AdapterOptions): HandleLimits {
  const explicit = (value: number | undefined, label: string) => value === undefined ? undefined : integer(value, label, true);
  const write = explicit(options.maxWriteBytes, "maxWriteBytes");
  const pending = explicit(options.maxPendingWriteBytes, "maxPendingWriteBytes");
  const limits = {
    maxReadBytes: integer(options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES, "maxReadBytes", true),
    maxWriteBytes: write ?? Math.min(DEFAULT_MAX_WRITE_BYTES, pending ?? DEFAULT_MAX_WRITE_BYTES),
    maxPendingWriteBytes: pending ?? Math.max(DEFAULT_MAX_PENDING_WRITE_BYTES, write ?? 0),
    maxPendingOperations: integer(options.maxPendingOperations ?? DEFAULT_MAX_PENDING_OPERATIONS, "maxPendingOperations", true),
  };
  if (limits.maxWriteBytes > limits.maxPendingWriteBytes) throw new RangeError("defuss-storage: maxWriteBytes exceeds maxPendingWriteBytes");
  return Object.freeze(limits);
}
