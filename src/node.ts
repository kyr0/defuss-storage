/**
 * Native file adapter (`defuss-storage/node`): one directory of regular files,
 * accessed through `node:fs/promises` FileHandles with explicit offsets, or
 * through synchronous calls on their descriptors with `io: "sync"`.
 *
 * Kept out of the root entry point so browser bundles never see `node:*` imports.
 *
 * @module
 */
import { constants, fstatSync, fsyncSync, ftruncateSync, readSync, writeSync, writevSync } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, stat, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { ManagedFile, type ByteBackend } from "./file.js";
import { StorageError, storageError } from "./errors.js";
import { handleLimits, openOptions, validateName, type HandleLimits } from "./validate.js";
import type { AdapterOptions, OpenOptions, StorageAdapter, StorageFile } from "./types.js";

export interface FileStorageOptions extends AdapterOptions {
  /** Create the root directory when absent. Default true. */
  create?: boolean;
  /**
   * `"async"` (default): I/O runs on libuv's thread pool. `"sync"`: each read,
   * write, size query, truncation and flush is a blocking call on the calling
   * thread, which skips the thread-pool round trip. Use it in a worker thread or
   * a CLI; on the main thread of a server it blocks every other task for the
   * call's full duration, an fsync or a slow disk included.
   */
  io?: "async" | "sync";
}

/**
 * Byte primitives over one FileHandle. Why a synchronous variant: an async call
 * costs a thread-pool round trip whatever its size. VERIFIED: (probe, macOS
 * arm64, 4 KiB) FileHandle.write 8.9 µs and read 7.6 µs against writeSync 3.4 µs
 * and readSync 0.8 µs on the same descriptor; Node.js 26 and Bun 1.4 accept
 * synchronous calls on a FileHandle's `fd`.
 */
function fileBackend(file: FileHandle, io: "async" | "sync"): Omit<ByteBackend, "close"> {
  if (io === "sync") {
    const fd = file.fd;
    return {
      size: () => fstatSync(fd).size,
      read: (offset, target) => readSync(fd, target, 0, target.length, offset),
      write: (offset, data) => writeSync(fd, data, 0, data.length, offset),
      writev: (offset, chunks) => writevSync(fd, chunks, offset),
      truncate: size => ftruncateSync(fd, size),
      flush: () => fsyncSync(fd),
    };
  }
  return {
    size: async () => (await file.stat()).size,
    read: async (offset, target) => (await file.read(target, 0, target.length, offset)).bytesRead,
    write: async (offset, data) => (await file.write(data, 0, data.length, offset)).bytesWritten,
    writev: async (offset, chunks) => (await file.writev(chunks, offset)).bytesWritten,
    truncate: size => file.truncate(size),
    flush: () => file.sync(),
  };
}

// One registry across the ESM and CommonJS builds in this JS realm. This is
// cooperative ownership, not an OS lock: other processes/workers are excluded
// from the supported concurrent-writer model.
const registryKey = Symbol.for("defuss-storage.v0.file-owners");
/** The realm-global owner set, keyed by canonical file path. `Symbol.for` makes both module builds find the same set. */
function owners(): Set<string> {
  const host = globalThis as unknown as { [key: symbol]: Set<string> | undefined };
  return host[registryKey] ??= new Set<string>();
}
/**
 * Claims `location` synchronously (before any await) and returns its release
 * function; throws BUSY if it is already owned. Synchronous claiming is what
 * makes two concurrent opens of one name in a realm mutually exclusive.
 */
function acquire(location: string): () => void {
  const registry = owners();
  if (registry.has(location)) throw new StorageError("BUSY", "defuss-storage: file already has an owner");
  registry.add(location);
  return () => { registry.delete(location); };
}
/** Throws UNSUPPORTED if `location` exists and is not a regular file (directory, symlink, FIFO, device); absence is fine. */
async function rejectSpecialFile(location: string): Promise<void> {
  try {
    const info = await lstat(location);
    if (!info.isFile() || info.isSymbolicLink()) throw new StorageError("UNSUPPORTED", "defuss-storage: only regular files are supported");
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
}

/**
 * Native adapter over a trusted root directory.
 *
 * Ownership is cooperative within one JS realm: a name has at most one open
 * handle across every FileStorage instance and both module builds. A handle
 * whose close failed keeps its name owned for the rest of the realm, since its
 * descriptor may still be live; recovery means ending that process or worker.
 *
 * The root is canonicalized once with `realpath`, so the ownership key
 * `root/name` is the same for every path spelling and symlink that reaches the
 * directory, and lowercase-only names cannot alias on case-insensitive volumes.
 * VERIFIED: (macOS APFS probe, 2026-11-07) realpath returns the on-disk case of
 * a directory reached through a differently cased path. UNKNOWN: Windows NTFS.
 */
export class FileStorage implements StorageAdapter {
  readonly capabilities = Object.freeze({ persistent: true, flush: "file", ownership: "realm-cooperative", snapshots: false, atomicReplace: false } as const);
  private constructor(readonly root: string, private readonly limits: HandleLimits, private readonly io: "async" | "sync") {}
  /**
   * Validates options, optionally creates `root`, and canonicalizes it.
   * Rejects UNSUPPORTED if `root` exists but is not a directory, whether or not
   * `create` is set.
   */
  static async create(root: string, options: FileStorageOptions = {}): Promise<FileStorage> {
    if (typeof root !== "string" || !root) throw new TypeError("defuss-storage: root must be a nonempty path");
    if (options.create !== undefined && typeof options.create !== "boolean") throw new TypeError("defuss-storage: create must be boolean");
    if (options.io !== undefined && options.io !== "async" && options.io !== "sync") throw new TypeError('defuss-storage: io must be "async" or "sync"');
    const limits = handleLimits(options);
    try {
      if (options.create ?? true) {
        // VERIFIED: (probe + root-file test) recursive mkdir accepts an existing
        // directory but throws EEXIST when a regular file occupies the path; the
        // stat below then reports UNSUPPORTED, the same code as with create:false.
        await mkdir(root, { recursive: true }).catch((error: unknown) => {
          if ((error as { code?: string }).code !== "EEXIST") throw error;
        });
      }
      const canonical = await realpath(root);
      if (!(await stat(canonical)).isDirectory()) throw new StorageError("UNSUPPORTED", "defuss-storage: root is not a directory");
      return new FileStorage(canonical, limits, options.io ?? "async");
    } catch (error) { throw storageError(error, "create file storage"); }
  }
  /**
   * Opens a regular file under the root with exclusive in-realm ownership.
   *
   * Symlinks are refused twice: `lstat` gives a clear UNSUPPORTED up front, and
   * `O_NOFOLLOW` (where the platform has it) closes the race where a symlink is
   * swapped in between that check and the open. Creation uses `O_CREAT|O_EXCL`
   * first, so it never truncates an existing file and can tell "created" from
   * "already there" without a separate existence check.
   */
  async open(name: string, options: OpenOptions = {}): Promise<StorageFile> {
    validateName(name);
    const opts = openOptions(options);
    const location = path.join(this.root, name);
    const release = acquire(location);
    let handle: FileHandle | undefined;
    try {
      await rejectSpecialFile(location);
      const base = (opts.readOnly ? constants.O_RDONLY : constants.O_RDWR) | (constants.O_NOFOLLOW ?? 0);
      if (opts.create) {
        try { handle = await open(location, base | constants.O_CREAT | constants.O_EXCL, 0o600); }
        catch (error) {
          if ((error as { code?: string }).code !== "EEXIST" || opts.exclusive) throw error;
          handle = await open(location, base);
        }
      } else handle = await open(location, base);
      if (!(await handle.stat()).isFile()) throw new StorageError("UNSUPPORTED", "defuss-storage: only regular files are supported");
      const file = handle;
      return new ManagedFile(name, opts.readOnly, this.limits, {
        ...fileBackend(file, this.io),
        // No `finally`: if close fails the descriptor may still be open, so the
        // name stays owned (quarantined) until this realm ends. Never retried.
        // VERIFIED: (EBADF quarantine test) later opens and removes reject BUSY.
        close: async () => { await file.close(); release(); },
        // Async read-only handles let positional preads run concurrently on libuv's
        // pool; synchronous reads block this thread, so overlapping gains nothing.
      }, { overlapReads: opts.readOnly && this.io === "async", writeBuffer: opts.writeBuffer });
    } catch (error) {
      // Cleanup never replaces the open error. Ownership is released only when
      // no descriptor was acquired or it closed; otherwise it stays quarantined.
      const closed = handle ? await handle.close().then(() => true, () => false) : true;
      if (closed) release();
      throw storageError(error, "open");
    }
  }
  /** Regular files with valid names only; foreign entries (other names, directories, symlinks) are skipped, never touched. */
  async list(): Promise<string[]> {
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      return entries.filter(entry => {
        if (!entry.isFile()) return false;
        try { validateName(entry.name); return true; } catch { return false; }
      }).map(entry => entry.name).sort();
    } catch (error) { throw storageError(error, "list"); }
  }
  /** Takes ownership for the duration of the unlink, so removing an open file rejects BUSY. */
  async remove(name: string): Promise<boolean> {
    validateName(name);
    const location = path.join(this.root, name);
    const release = acquire(location);
    try {
      await rejectSpecialFile(location);
      await unlink(location);
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return false;
      throw storageError(error, "remove");
    } finally { release(); }
  }
}

/** Creates a native adapter rooted at `root` (created by default). See {@link FileStorage.create}. */
export const createFileStorage = (root: string, options: FileStorageOptions = {}): Promise<FileStorage> => FileStorage.create(root, options);
