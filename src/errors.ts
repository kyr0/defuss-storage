/**
 * Normalized error vocabulary shared by every adapter.
 *
 * Callers branch on {@link StorageError.code} instead of platform-specific errno
 * strings or DOMException names, so one record engine can run unchanged on
 * memory, native files and OPFS. The original platform error stays available as
 * `cause` for diagnostics.
 *
 * @module
 */

// One list is both the public type and the cross-build whitelist, so a new code
// cannot be added to one and forgotten in the other.
const CODE_LIST = [
  "NOT_FOUND", "ALREADY_EXISTS", "BUSY", "CLOSED", "READ_ONLY", "PERMISSION_DENIED", "QUOTA_EXCEEDED",
  "UNEXPECTED_EOF", "UNSUPPORTED", "ABORTED", "QUEUE_FULL", "IO_ERROR",
] as const;

/** Stable, platform-neutral failure categories. */
export type StorageErrorCode = (typeof CODE_LIST)[number];

/** Whitelist for StorageErrors from another build or realm, which `instanceof` cannot recognize. */
const CODES: ReadonlySet<string> = new Set(CODE_LIST);

/**
 * Operational failure (I/O, ownership, lifecycle). Invalid arguments are thrown
 * as plain `TypeError`/`RangeError` instead, because they are programming
 * errors that retrying cannot fix.
 *
 * Match on `code` rather than `instanceof`: the ESM and CommonJS builds, or two
 * realms, each have their own class object.
 */
export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageError";
    this.code = code;
  }
}

/**
 * Maps any thrown value to a {@link StorageError}; StorageErrors of this build
 * pass through unchanged so the most specific code survives nested wrapping.
 *
 * A StorageError of another build (ESM vs CommonJS, another realm) keeps its
 * code if the code is known, wrapped with the original as `cause`. Both the name
 * and the whitelist are required, so an arbitrary library error that happens to
 * carry `code: "BUSY"` is not mistaken for ownership contention.
 *
 * @param error Native, DOM or backend failure.
 * @param operation Verb used in the message, e.g. `"open"`.
 */
export function storageError(error: unknown, operation: string): StorageError {
  if (error instanceof StorageError) return error;
  const e = error as { code?: string; name?: string } | null;
  if (e?.name === "StorageError" && typeof e.code === "string" && CODES.has(e.code)) {
    return new StorageError(e.code as StorageErrorCode, `defuss-storage: ${operation} failed (${e.code})`, { cause: error });
  }
  // VERIFIED: (Chromium suite, 0.1.0) DOMException.code is a legacy number; its
  // name is the portable discriminator.
  const tag = typeof e?.code === "string" ? e.code : e?.name;
  const code: StorageErrorCode =
    tag === "ENOENT" || tag === "NotFoundError" ? "NOT_FOUND" :
    tag === "EEXIST" ? "ALREADY_EXISTS" :
    tag === "EACCES" || tag === "EPERM" || tag === "NotAllowedError" || tag === "SecurityError" ? "PERMISSION_DENIED" :
    tag === "ENOSPC" || tag === "EDQUOT" || tag === "QuotaExceededError" ? "QUOTA_EXCEEDED" :
    tag === "EBUSY" || tag === "NoModificationAllowedError" ? "BUSY" :
    // VERIFIED: (foreign-dir case in Chromium, Firefox, WebKit) OPFS reports a
    // directory where a file was expected as TypeMismatchError; the native
    // adapter reports the same condition as UNSUPPORTED.
    tag === "TypeMismatchError" ? "UNSUPPORTED" :
    tag === "AbortError" ? "ABORTED" : "IO_ERROR";
  return new StorageError(code, `defuss-storage: ${operation} failed (${code})`, { cause: error });
}
