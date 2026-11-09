/**
 * Root entry point: the common API and the memory adapter only.
 *
 * No platform imports and no I/O at import time, so this module is safe in any
 * runtime and tree-shakes cleanly (`sideEffects: false`). VERIFIED: the
 * packed-consumer test walks this entry's ESM and CommonJS module graphs and
 * finds no platform import. Native files live in
 * `defuss-storage/node`, OPFS in `defuss-storage/opfs`.
 *
 * @module
 */
export { StorageError } from "./errors.js";
export type { StorageErrorCode } from "./errors.js";
export { MemoryStorage, createMemoryStorage } from "./memory.js";
export type { MemoryStorageOptions } from "./memory.js";
export { createStorageFile } from "./custom.js";
export { appendChunks } from "./streams.js";
export type { ByteBackend as StorageFileBackend } from "./file.js";
export type {
  AdapterOptions, AdmissionOptions, AppendChunksOptions, AppendResult, CancellationSignal, IOOptions, OpenOptions,
  StorageAdapter, StorageCapabilities, StorageFile, StreamOptions, WriteOptions,
} from "./types.js";
