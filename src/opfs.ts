/**
 * Browser adapter (`defuss-storage/opfs`) over the Origin Private File System.
 *
 * Uses `FileSystemSyncAccessHandle` (dedicated workers only) for explicit-offset
 * I/O and Web Locks for ownership across workers and tabs of one origin.
 * Files live in `defuss-storage/<namespace>/` below the origin's OPFS root.
 *
 * @module
 */
import { ManagedFile } from "./file.js";
import { StorageError, storageError } from "./errors.js";
import { handleLimits, openOptions, validateName, type HandleLimits } from "./validate.js";
import type { AdapterOptions, OpenOptions, StorageAdapter, StorageFile } from "./types.js";

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
interface OpfsFile { kind: "file"; createSyncAccessHandle?: () => Promise<SyncHandle> }
interface Directory {
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<Directory>;
  getFileHandle(name: string, options: { create: boolean }): Promise<OpfsFile>;
  removeEntry(name: string): Promise<void>;
  entries(): AsyncIterableIterator<[string, { kind: string }]>;
}
interface LockManager {
  request(name: string, options: { ifAvailable: true; mode: "exclusive" }, callback: (lock: object | null) => Promise<void>): Promise<void>;
}
export interface OPFSStorageOptions extends AdapterOptions {
  /** Namespace below the origin's defuss-storage directory. Default "default". */
  name?: string;
}

/**
 * Takes the exclusive Web Lock `name` without waiting and returns its release
 * function; rejects BUSY if another context holds it.
 *
 * Why `ifAvailable` instead of queuing: an open of a busy file should fail
 * fast like the other adapters, not hang until the owner closes. VERIFIED:
 * (two-worker 'busy' task) open and remove reject BUSY while another worker owns the file. The lock is
 * held for as long as the callback's promise is pending, so the callback
 * awaits `held`, which only the returned release function resolves.
 */
async function acquire(locks: LockManager, name: string): Promise<() => Promise<void>> {
  let unlock!: () => void;
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const held = new Promise<void>(r => { unlock = r; });
  const acquired = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const request = locks.request(name, { ifAvailable: true, mode: "exclusive" }, async lock => {
    if (!lock) { reject(new StorageError("BUSY", "defuss-storage: file already has an owner")); return; }
    resolve();
    await held;
  });
  void request.catch(reject);
  await acquired;
  return async () => { unlock(); await request; };
}

/**
 * OPFS adapter for one namespace. Ownership is origin-wide but cooperative:
 * only code using this package's lock names is excluded (`"origin-cooperative"`).
 * The sync access handle additionally locks its file natively, so a foreign
 * writer gets NoModificationAllowedError, reported as BUSY.
 */
export class OPFSStorage implements StorageAdapter {
  readonly capabilities = Object.freeze({ persistent: true, flush: "file", ownership: "origin-cooperative", snapshots: false, atomicReplace: false } as const);
  private constructor(
    readonly name: string,
    private readonly root: Directory,
    private readonly locks: LockManager,
    private readonly limits: HandleLimits,
  ) {}
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
    };
    if (host.document !== undefined || !host.navigator?.storage?.getDirectory || !host.navigator.locks?.request) {
      throw new StorageError("UNSUPPORTED", "defuss-storage: OPFS requires a secure dedicated worker with Web Locks");
    }
    try {
      const origin = await host.navigator.storage.getDirectory();
      const base = await origin.getDirectoryHandle("defuss-storage", { create: true });
      const root = await base.getDirectoryHandle(name, { create: true });
      return new OPFSStorage(name, root, host.navigator.locks, limits);
    } catch (error) { throw storageError(error, "create OPFS storage"); }
  }
  /** Lock name for one file. Validated names contain no `:`, so the key is unambiguous per namespace and file. */
  private lock(name: string): Promise<() => Promise<void>> {
    return acquire(this.locks, `defuss-storage:v0:${this.name}:${name}`);
  }
  /**
   * Opens `name` under its Web Lock, which stays held until close.
   * A directory under a valid name rejects UNSUPPORTED (TypeMismatchError), as on native files.
   */
  async open(name: string, options: OpenOptions = {}): Promise<StorageFile> {
    validateName(name);
    const opts = openOptions(options);
    const release = await this.lock(name);
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
      handle = await file.createSyncAccessHandle();
      const sync = handle;
      return new ManagedFile(name, opts.readOnly, this.limits, {
        size: () => sync.getSize(),
        read: (offset, target) => sync.read(target, { at: offset }),
        write: (offset, data) => sync.write(data, { at: offset }),
        truncate: size => sync.truncate(size),
        flush: () => sync.flush(),
        // No `finally`: if the sync handle cannot be closed the Web Lock stays
        // held (quarantined) until this worker ends and the browser releases it.
        // UNKNOWN: no browser operation is known that makes close() fail, so this
        // path is covered by code review only. VERIFIED: (termination scenario,
        // three engines) ending the worker releases its lock for a fresh worker.
        close: async () => { sync.close(); await release(); },
      }, { writeBuffer: opts.writeBuffer });
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
