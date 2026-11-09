/**
 * Browser adapter (`defuss-storage/directory`) over a `FileSystemDirectoryHandle`:
 * a folder on disk that the user picked with `showDirectoryPicker()` (Chromium),
 * or any OPFS directory. Runs in windows and workers.
 *
 * Reads take a snapshot with `getFile()`. Every backend write commits through a
 * `FileSystemWritableFileStream` (`createWritable({ keepExistingData: true })`),
 * which the browser writes to a copy of the file and swaps in on `close()`.
 * Why commit per write instead of keeping one stream open until `flush()`:
 * a stream's bytes stay invisible to `getFile()` until it closes, so an open
 * stream would break read-after-write, which every adapter guarantees. The
 * price is a copy of the file per backend write; the `writeBuffer` open option
 * and append batching (`writev`) turn many small appends into one commit.
 * HYPOTHESIS: the copy makes each commit cost grow with the file size
 * (falsifier: commit time flat across file sizes in a browser benchmark).
 *
 * Ownership uses Web Locks named after the adapter's `name` (default: the
 * directory's name), so adapters with the same name exclude each other across
 * workers and tabs of an origin.
 *
 * @module
 */
import { ManagedFile, type ByteBackend } from "./file.js";
import { StorageError, storageError } from "./errors.js";
import { acquire, type LockManager } from "./locks.js";
import { handleLimits, openOptions, validateName, type HandleLimits } from "./validate.js";
import type { AdapterOptions, OpenOptions, StorageAdapter, StorageFile } from "./types.js";

// Structural host interfaces keep declarations independent of DOM lib versions;
// a DOM FileSystemDirectoryHandle satisfies DirectoryHandle.
interface WritableStream {
  write(params: { type: "write"; position: number; data: ArrayBuffer }): Promise<void>;
  truncate(size: number): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}
interface FileSnapshot {
  readonly size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}
interface FileHandle {
  readonly kind: "file";
  getFile(): Promise<FileSnapshot>;
  createWritable?(options: { keepExistingData: boolean }): Promise<WritableStream>;
}
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
 * The bytes of `data` as an ArrayBuffer of exactly their length; a view that
 * covers a whole ArrayBuffer passes through without a copy. Why not the view:
 * WebKit's writable stream writes the entire buffer behind a view, ignoring its
 * offset and length. VERIFIED: (write-buffer contract case, WebKit 26.5) 1-byte
 * views of a 4-byte write buffer landed as 4 bytes each, [6, 2, 3, 0] instead
 * of [6]. An ArrayBuffer also fits the DOM's write type, which refuses views
 * that may sit on a SharedArrayBuffer.
 */
const exact = (data: Uint8Array): ArrayBuffer => {
  const { buffer } = data;
  return buffer instanceof ArrayBuffer && data.byteOffset === 0 && data.byteLength === buffer.byteLength ? buffer : data.slice().buffer as ArrayBuffer;
};

/**
 * Byte backend over one file handle; each write, writev and truncate is one
 * committed stream. Reads share one `getFile()` snapshot until the next commit
 * replaces the file. Why not a snapshot per read: VERIFIED: (site probe,
 * Chromium 151, OPFS-backed folder, 1,000 random record reads) 400 µs per read
 * with a fresh snapshot, 260 µs with a shared one. A read that fails is retried
 * once on a fresh snapshot. HYPOTHESIS: Chromium rejects reads of a snapshot
 * whose file another program changed (falsifier: change the file outside the
 * browser, then read through an open handle without an error).
 */
function fileBackend(file: FileHandle, release: () => Promise<void>): ByteBackend {
  let snapshot: Promise<FileSnapshot> | undefined;
  const current = (): Promise<FileSnapshot> => (snapshot ??= file.getFile());
  const commit = async (edit: (stream: WritableStream) => Promise<number>): Promise<number> => {
    snapshot = undefined;
    const stream = await file.createWritable!({ keepExistingData: true });
    let written: number;
    try { written = await edit(stream); } catch (error) {
      // Abort discards the copy; the file keeps its last committed bytes.
      await stream.abort(error).catch(() => {});
      throw error;
    }
    await stream.close();
    return written;
  };
  const slice = async (offset: number, length: number): Promise<Uint8Array> =>
    new Uint8Array(await (await current()).slice(offset, offset + length).arrayBuffer());
  return {
    size: async () => (await current()).size,
    read: async (offset, target) => {
      let bytes: Uint8Array;
      try { bytes = await slice(offset, target.length); } catch {
        snapshot = undefined;
        bytes = await slice(offset, target.length);
      }
      target.set(bytes);
      return bytes.length;
    },
    write: (offset, data) => commit(async stream => {
      await stream.write({ type: "write", position: offset, data: exact(data) });
      return data.length;
    }),
    writev: (offset, chunks) => commit(async stream => {
      let at = offset;
      for (const chunk of chunks) { await stream.write({ type: "write", position: at, data: exact(chunk) }); at += chunk.length; }
      return at - offset;
    }),
    truncate: async size => { await commit(async stream => { await stream.truncate(size); return 0; }); },
    // Nothing to flush: each write was committed when its stream closed.
    flush: () => {},
    close: release,
  };
}

/**
 * Adapter over one directory handle. Ownership is origin-wide but cooperative,
 * as in the OPFS adapter: only opens through this package with the same
 * adapter name are excluded (`"origin-cooperative"`).
 */
export class DirectoryStorage implements StorageAdapter {
  readonly capabilities = Object.freeze({ persistent: true, flush: "file", ownership: "origin-cooperative", snapshots: false, atomicReplace: false } as const);
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
  /** Lock name for one file; the adapter name is encoded, so no folder name can make the key ambiguous. */
  private lock(name: string): Promise<() => Promise<void>> {
    return acquire(this.locks, `defuss-storage:v0:directory:${encodeURIComponent(this.name)}:${name}`);
  }
  /**
   * Opens `name` under its Web Lock, which stays held until close. Rejects
   * UNSUPPORTED for a writable open where the browser lacks `createWritable`,
   * and for a directory under a valid name (TypeMismatchError).
   */
  async open(name: string, options: OpenOptions = {}): Promise<StorageFile> {
    validateName(name);
    const opts = openOptions(options);
    const release = await this.lock(name);
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
