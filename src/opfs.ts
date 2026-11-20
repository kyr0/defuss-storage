/**
 * Browser adapter (`defuss-storage/opfs`) over the Origin Private File System.
 *
 * Uses `FileSystemSyncAccessHandle` (dedicated workers only) for explicit-offset
 * I/O and Web Locks for ownership across workers and tabs of one origin.
 * Shared readers read through a read-only sync access handle where the browser
 * has one; elsewhere the first takes the file's one sync handle and the others
 * read `getFile()` snapshots meanwhile. Shared writers need `readwrite-unsafe`
 * sync access handles (Chromium).
 * Files live in `defuss-storage/<namespace>/` below the origin's OPFS root.
 *
 * @module
 */
import { ManagedFile } from "./file.js";
import { fileBackend, type FileHandle } from "./file-handle.js";
import { StorageError, storageError } from "./errors.js";
import { acquire, type LockManager } from "./locks.js";
import { handleLimits, openOptions, validateName, type HandleLimits } from "./validate.js";
import type { AdapterOptions, OpenOptions, StorageAdapter, StorageCapabilities, StorageFile } from "./types.js";

// Small structural host interfaces keep declarations independent of DOM lib
// versions. The adapter itself uses only real OPFS and Web Locks APIs.
interface SyncHandle {
  getSize(): number;
  read(target: Uint8Array, options: { at: number }): number;
  write(data: Uint8Array, options: { at: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}
interface OpfsFile extends FileHandle { createSyncAccessHandle?: (options?: { mode: "read-only" | "readwrite-unsafe" }) => Promise<SyncHandle> }
interface Directory {
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<Directory>;
  getFileHandle(name: string, options: { create: boolean }): Promise<OpfsFile>;
  removeEntry(name: string): Promise<void>;
  entries(): AsyncIterableIterator<[string, { kind: string }]>;
}
/**
 * Largest write assembled from queued appends. A sync access handle has no
 * vectored write, and each call costs far more than copying a small input.
 * VERIFIED: (recorded 0.2.0 runs, 4 KiB against 64 KiB appends) Chromium wrote
 * 643 against 3,985 MiB/s, Firefox 86 against 1,094, WebKit 914 against 5,298.
 * One allocation of at most this size per backend write, outside the admission budget.
 */
const JOIN_BYTES = 1024 * 1024;
/**
 * The bytes for one backend write: the leading chunks that fit
 * {@link JOIN_BYTES} together, copied back to back, or the first chunk as it
 * is when it cannot share. The handle writes the remaining chunks with further calls.
 */
function joined(chunks: readonly Uint8Array[]): Uint8Array {
  let count = 0, total = 0;
  while (count < chunks.length && total + chunks[count]!.length <= JOIN_BYTES) total += chunks[count++]!.length;
  if (count < 2) return chunks[0]!;
  const bytes = new Uint8Array(total);
  for (let i = 0, at = 0; i < count; at += chunks[i++]!.length) bytes.set(chunks[i]!, at);
  return bytes;
}

/**
 * Whether creating a sync access handle failed because another one holds the
 * file. VERIFIED: (probe 2026-11-20, a second worker while one holds a handle)
 * Chromium 151 and Firefox 153 throw NoModificationAllowedError, WebKit 26.5
 * InvalidStateError.
 */
const heldElsewhere = (error: unknown): boolean => {
  const name = (error as { name?: string } | null)?.name;
  return name === "NoModificationAllowedError" || name === "InvalidStateError";
};
export interface OPFSStorageOptions extends AdapterOptions {
  /** Namespace below the origin's defuss-storage directory. Default "default". */
  name?: string;
}

/**
 * OPFS adapter for one namespace. Ownership is origin-wide but cooperative:
 * only code using this package's lock names is excluded (`"origin-cooperative"`).
 * The sync access handle additionally locks its file natively, so a foreign
 * writer gets NoModificationAllowedError (InvalidStateError in WebKit),
 * reported as BUSY.
 */
export class OPFSStorage implements StorageAdapter {
  readonly capabilities: StorageCapabilities;
  private constructor(
    readonly name: string,
    private readonly root: Directory,
    private readonly locks: LockManager,
    private readonly limits: HandleLimits,
    /**
     * Whether sync access handles take a `mode`: "read-only" ones coexist with
     * each other, "readwrite-unsafe" ones with each other, and the two kinds
     * exclude each other. Why the check is the `mode` attribute: VERIFIED:
     * (probes 2026-11-20) Chromium 151 handles report their mode, read-only
     * ones refuse writes, two readwrite-unsafe handles in two workers see each
     * other's bytes and size at once, and either kind fails while the other is
     * held (NoModificationAllowedError); Firefox 153 and WebKit 26.5 ignore the
     * option, return handles without `mode` that accept writes, and fail a
     * second handle.
     */
    private readonly handleModes: boolean,
  ) {
    this.capabilities = Object.freeze({ persistent: true, flush: "file", ownership: "origin-cooperative", snapshots: false, atomicReplace: false, sharedWriters: handleModes });
  }
  /**
   * Opens (creating if needed) the namespace directory.
   * Rejects UNSUPPORTED outside a worker or without OPFS/Web Locks; the
   * `document` check fails the main thread early, where sync handles do not exist.
   */
  static async create(options: OPFSStorageOptions = {}): Promise<OPFSStorage> {
    const name = options.name ?? "default";
    validateName(name);
    const limits = handleLimits(options);
    const host = globalThis as unknown as {
      document?: unknown;
      navigator?: { storage?: { getDirectory?: () => Promise<Directory> }; locks?: LockManager };
      FileSystemSyncAccessHandle?: { prototype: object };
    };
    if (host.document !== undefined || !host.navigator?.storage?.getDirectory || !host.navigator.locks?.request) {
      throw new StorageError("UNSUPPORTED", "defuss-storage: OPFS requires a secure dedicated worker with Web Locks");
    }
    try {
      const origin = await host.navigator.storage.getDirectory();
      const base = await origin.getDirectoryHandle("defuss-storage", { create: true });
      const root = await base.getDirectoryHandle(name, { create: true });
      return new OPFSStorage(name, root, host.navigator.locks, limits, "mode" in (host.FileSystemSyncAccessHandle?.prototype ?? {}));
    } catch (error) { throw storageError(error, "create OPFS storage"); }
  }
  /** Lock for one file, shared or exclusive. Validated names contain no `:`, so the key is unambiguous per namespace and file. */
  private lock(name: string, shared = false): Promise<() => Promise<void>> {
    return acquire(this.locks, `defuss-storage:v0:${this.name}:${name}`, shared ? "shared" : "exclusive");
  }
  /**
   * Opens `name` under its Web Lock (shared for a shared handle), which stays held until close.
   * A directory under a valid name rejects UNSUPPORTED (TypeMismatchError), as
   * on native files, and so does a shared writer without readwrite-unsafe handles.
   *
   * A shared reader without read-only sync access handles (Firefox, WebKit)
   * takes the file's one sync handle if it is free, and otherwise reads
   * `getFile()` snapshots, so a lone reader keeps the fast path. VERIFIED:
   * (probe 2026-11-20, 64 KiB reads) snapshots read 300 to 700 MiB/s against
   * 2,100 to 10,700 MiB/s through a sync handle, and (probe 2026-11-20, three
   * engines) a worker reads fresh and earlier snapshots while another worker
   * holds the sync handle. Shared readers and writers exclude each other through
   * the handles' native modes, not the Web Lock, which both take shared.
   */
  async open(name: string, options: OpenOptions = {}): Promise<StorageFile> {
    validateName(name);
    const opts = openOptions(options);
    const writer = opts.shared && !opts.readOnly;
    if (writer && !this.handleModes) throw new StorageError("UNSUPPORTED", "defuss-storage: this browser has no shared OPFS writers");
    const release = await this.lock(name, opts.shared);
    let handle: SyncHandle | undefined;
    try {
      let file: OpfsFile;
      try {
        file = await this.root.getFileHandle(name, { create: false });
        if (opts.exclusive) throw new StorageError("ALREADY_EXISTS", `defuss-storage: ${name} exists`);
      } catch (error) {
        if ((error as { name?: string }).name !== "NotFoundError" || !opts.create) throw error;
        file = await this.root.getFileHandle(name, { create: true });
      }
      if (!file.createSyncAccessHandle) throw new StorageError("UNSUPPORTED", "defuss-storage: synchronous OPFS access is unavailable");
      try {
        handle = await (!opts.shared ? file.createSyncAccessHandle() : file.createSyncAccessHandle({ mode: writer ? "readwrite-unsafe" : "read-only" }));
      } catch (error) {
        if (!heldElsewhere(error)) throw error;
        if (opts.shared && !writer && !this.handleModes) return new ManagedFile(name, true, this.limits, fileBackend(file, release));
        throw new StorageError("BUSY", `defuss-storage: ${name} is open elsewhere`, { cause: error });
      }
      const sync = handle;
      return new ManagedFile(name, opts.readOnly, this.limits, {
        size: () => sync.getSize(),
        read: (offset, target) => sync.read(target, { at: offset }),
        write: (offset, data) => sync.write(data, { at: offset }),
        writev: (offset, chunks) => sync.write(joined(chunks), { at: offset }),
        truncate: size => sync.truncate(size),
        // A read-only handle wrote nothing. VERIFIED: (browser suite, Chromium 151)
        // flush() on a "read-only" handle throws NoModificationAllowedError.
        flush: opts.readOnly ? () => undefined : () => sync.flush(),
        // No `finally`: if the sync handle cannot be closed the Web Lock stays
        // held (quarantined) until this worker ends and the browser releases it.
        // UNKNOWN: no browser operation is known that makes close() fail, so this
        // path is covered by code review only. VERIFIED: (termination scenario,
        // three engines) ending the worker releases its lock for a fresh worker.
        close: async () => { sync.close(); await release(); },
      }, { writeBuffer: opts.writeBuffer, synchronous: true, sharedWriter: writer });
    } catch (error) {
      // Cleanup never replaces the open error; an unclosable handle keeps the lock (quarantine).
      let closed = true;
      try { handle?.close(); } catch { closed = false; }
      if (closed) await release();
      throw storageError(error, "open");
    }
  }
  /** Files with valid names only; foreign entries (other names, directories) are skipped, never touched. */
  async list(): Promise<string[]> {
    const names: string[] = [];
    try {
      for await (const [name, handle] of this.root.entries()) {
        if (handle.kind !== "file") continue;
        try { validateName(name); names.push(name); } catch { /* foreign entries stay untouched */ }
      }
      return names.sort();
    } catch (error) { throw storageError(error, "list"); }
  }
  /** Removes `name` under its Web Lock, so removing an open file rejects BUSY. */
  async remove(name: string): Promise<boolean> {
    validateName(name);
    const release = await this.lock(name);
    try {
      // Refuse to remove foreign directories, even empty ones.
      await this.root.getFileHandle(name, { create: false });
      await this.root.removeEntry(name);
      return true;
    } catch (error) {
      if ((error as { name?: string }).name === "NotFoundError") return false;
      throw storageError(error, "remove");
    } finally { await release(); }
  }
}

/** Creates an OPFS adapter for namespace `options.name` (default `"default"`). Call from a dedicated worker. */
export const createOPFSStorage = (options: OPFSStorageOptions = {}): Promise<OPFSStorage> => OPFSStorage.create(options);
