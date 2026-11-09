/**
 * Extension point for third-party byte backends (remote ranges, IndexedDB, …).
 *
 * @module
 */
import { ManagedFile, type ByteBackend } from "./file.js";
import type { AdapterOptions, OpenOptions, StorageFile } from "./types.js";
import { handleLimits, openOptions, validateName } from "./validate.js";

/**
 * Wraps `backend` in the same handle the built-in adapters use: serial queue,
 * bounded reads, admission limits, owned write inputs, partial-I/O completion, cancellation,
 * streaming and error normalization.
 *
 * A backend that implements the optional `writev` gets append batching: appends
 * queued behind a running operation are written in one call.
 *
 * The backend owns its resource and releases it in `close`. Naming, listing,
 * deletion and ownership across handles stay with the adapter author.
 * VERIFIED: (fault-matrix tests) short, invalid and failing backend calls get
 * the same completion, rejection and error codes as the built-in adapters.
 */
export function createStorageFile(
  name: string,
  backend: ByteBackend,
  options: AdapterOptions & Pick<OpenOptions, "readOnly" | "writeBuffer"> = {},
): StorageFile {
  validateName(name);
  const { readOnly, writeBuffer } = openOptions(options);
  return new ManagedFile(name, readOnly, handleLimits(options), backend, { writeBuffer });
}
