/**
 * Browser adapter (`defuss-storage/directory`) over a `FileSystemDirectoryHandle`:
 * a folder on disk that the user picked with `showDirectoryPicker()` (Chromium),
 * or any OPFS directory. Runs in windows and workers.
 *
 * Reads take a snapshot with `getFile()`. Every backend write commits through a
 * `FileSystemWritableFileStream` (`createWritable({ keepExistingData: true })`),
 * which the browser writes to a copy of the file and swaps in on `close()`
 * (see `file-handle.ts` for why each write commits).
 *
 * Ownership uses Web Locks named after the adapter's `name` (default: the
 * directory's name), so adapters with the same name exclude each other across
 * workers and tabs of an origin.
 *
 * @module
 */
import { ManagedFile } from "./file.js";
import { fileBackend, type FileHandle } from "./file-handle.js";
import { StorageError, storageError } from "./errors.js";
import { acquire, type LockManager } from "./locks.js";
import { handleLimits, openOptions, validateName, type HandleLimits } from "./validate.js";
import type { AdapterOptions, OpenOptions, StorageAdapter, StorageFile } from "./types.js";

// Structural host interfaces keep declarations independent of DOM lib versions;
// a DOM FileSystemDirectoryHandle satisfies DirectoryHandle.
/**
 * The parts of a `FileSystemDirectoryHandle` this adapter needs to be passed.
 * Why `entries()` is not among them: TypeScript's DOM lib declares the handle's
 * async iteration only in `DOM.AsyncIterable`, so requiring it would reject a
 * plain DOM handle at compile time. VERIFIED: (site tsc) a
 * FileSystemDirectoryHandle lacked `entries`. Every browser with the handle
 * iterates it at runtime; `list()` reads it there.
 */
export interface DirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
  getFileHandle(name: string, options: { create: boolean }): Promise<FileHandle>;
  removeEntry(name: string): Promise<void>;
}
interface IterableDirectory { entries(): AsyncIterableIterator<[string, { readonly kind: string }]> }
export interface DirectoryStorageOptions extends AdapterOptions {
  /**
   * Ownership scope: adapters with the same name exclude each other's opens
   * across workers and tabs. Default: the directory's name. Give two different
   * folders with the same name different names, or they exclude each other.
   */
  name?: string;
}

/**
 * Adapter over one directory handle. Ownership is origin-wide but cooperative,
 * as in the OPFS adapter: only opens through this package with the same
 * adapter name are excluded (`"origin-cooperative"`).
 */
export class DirectoryStorage implements StorageAdapter {
  readonly capabilities = Object.freeze({ persistent: true, flush: "file", ownership: "origin-cooperative", snapshots: false, atomicReplace: false, sharedWriters: false } as const);
  private constructor(
    readonly name: string,
    private readonly root: DirectoryHandle,
    private readonly locks: LockManager,
    private readonly limits: HandleLimits,
  ) {}
  /**
   * Checks the handle and Web Locks. Rejects TypeError for anything but a
   * directory handle, and UNSUPPORTED without Web Locks.
   */
  static async create(directory: DirectoryHandle, options: DirectoryStorageOptions = {}): Promise<DirectoryStorage> {
    if (directory?.kind !== "directory" || typeof directory.getFileHandle !== "function") {
      throw new TypeError("defuss-storage: createDirectoryStorage needs a FileSystemDirectoryHandle");
    }
    const name = options.name ?? directory.name;
    if (typeof name !== "string") throw new TypeError("defuss-storage: name must be a string");
    const limits = handleLimits(options);
    const locks = (globalThis as unknown as { navigator?: { locks?: LockManager } }).navigator?.locks;
    if (!locks?.request) throw new StorageError("UNSUPPORTED", "defuss-storage: directory storage requires Web Locks");
    return new DirectoryStorage(name, directory, locks, limits);
  }
  /** Lock for one file, shared or exclusive; the adapter name is encoded, so no folder name can make the key ambiguous. */
  private lock(name: string, shared = false): Promise<() => Promise<void>> {
    return acquire(this.locks, `defuss-storage:v0:directory:${encodeURIComponent(this.name)}:${name}`, shared ? "shared" : "exclusive");
  }
  /**
   * Opens `name` under its Web Lock (shared for a shared reader), which stays held until close. Rejects
   * UNSUPPORTED for a shared writer: every write commits a copy of the whole
   * file, so two writers' commits would replace each other's bytes. HYPOTHESIS:
   * (falsifier: both of two overlapping commits keep their bytes); rejects
   * UNSUPPORTED for a writable open where the browser lacks `createWritable`,
   * and for a directory under a valid name (TypeMismatchError).
   */
  async open(name: string, options: OpenOptions = {}): Promise<StorageFile> {
    validateName(name);
    const opts = openOptions(options);
    if (opts.shared && !opts.readOnly) throw new StorageError("UNSUPPORTED", "defuss-storage: directory handles have no shared writers");
    const release = await this.lock(name, opts.shared);
    try {
      let file: FileHandle;
      try {
        file = await this.root.getFileHandle(name, { create: false });
        if (opts.exclusive) throw new StorageError("ALREADY_EXISTS", `defuss-storage: ${name} exists`);
      } catch (error) {
        if ((error as { name?: string }).name !== "NotFoundError" || !opts.create) throw error;
        file = await this.root.getFileHandle(name, { create: true });
      }
      if (!opts.readOnly && typeof file.createWritable !== "function") {
        throw new StorageError("UNSUPPORTED", "defuss-storage: this browser cannot write to directory handles");
      }
      return new ManagedFile(name, opts.readOnly, this.limits, fileBackend(file, release), { writeBuffer: opts.writeBuffer });
    } catch (error) {
      await release();
      throw storageError(error, "open");
    }
  }
  /** Files with valid names only; foreign entries (other names, directories) are skipped, never touched. */
  async list(): Promise<string[]> {
    const names: string[] = [];
    try {
      for await (const [name, handle] of (this.root as unknown as IterableDirectory).entries()) {
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

/**
 * Creates an adapter over `directory`, a `FileSystemDirectoryHandle` from
 * `showDirectoryPicker()` or OPFS. Request read-write permission first (for a
 * picked folder: `showDirectoryPicker({ mode: "readwrite" })`); without it
 * writes reject PERMISSION_DENIED.
 */
export const createDirectoryStorage = (directory: DirectoryHandle, options: DirectoryStorageOptions = {}): Promise<DirectoryStorage> =>
  DirectoryStorage.create(directory, options);
