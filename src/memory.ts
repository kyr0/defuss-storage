/**
 * In-memory adapter: the reference implementation of the contract and the
 * default for tests and ephemeral data. Imported from the root entry point
 * because it needs no platform API.
 *
 * @module
 */
import { ManagedFile } from "./file.js";
import { StorageError } from "./errors.js";
import { handleLimits, integer, openOptions, validateName, type HandleLimits } from "./validate.js";
import type { AdapterOptions, OpenOptions, StorageAdapter, StorageFile } from "./types.js";

export interface MemoryStorageOptions extends AdapterOptions {
  /** Per-file capacity limit; growth past it rejects QUOTA_EXCEEDED. Default 256 MiB. Not a total heap limit. */
  maxFileBytes?: number;
}

/**
 * One named file. `buffer` is capacity, `size` the logical length.
 * Invariant: `buffer[size..]` is all zero, so growing within capacity zero-fills
 * for free and a shrink-then-grow never revives discarded bytes.
 */
interface Entry { buffer: Uint8Array; size: number; busy: boolean }

/**
 * Bytes live in this instance only; two instances never share names.
 * Ownership is the `busy` flag of an entry, so it is exact within the instance
 * (`capabilities.ownership: "instance"`).
 */
export class MemoryStorage implements StorageAdapter {
  readonly capabilities = Object.freeze({ persistent: false, flush: "memory", ownership: "instance", snapshots: false, atomicReplace: false } as const);
  private readonly entries = new Map<string, Entry>();
  private readonly limits: HandleLimits;
  private readonly maxFileBytes: number;
  constructor(options: MemoryStorageOptions = {}) {
    this.limits = handleLimits(options);
    this.maxFileBytes = integer(options.maxFileBytes ?? 256 * 1024 * 1024, "maxFileBytes");
  }
  /**
   * Opens or creates `name`. All checks and the ownership flag are set before
   * the first await, so two concurrent opens of one name cannot both succeed.
   */
  async open(name: string, options: OpenOptions = {}): Promise<StorageFile> {
    validateName(name);
    const opts = openOptions(options);
    let entry = this.entries.get(name);
    if (entry?.busy) throw new StorageError("BUSY", `defuss-storage: ${name} is open`);
    if (entry && opts.exclusive) throw new StorageError("ALREADY_EXISTS", `defuss-storage: ${name} exists`);
    if (!entry) {
      if (!opts.create) throw new StorageError("NOT_FOUND", `defuss-storage: ${name} does not exist`);
      entry = { buffer: new Uint8Array(0), size: 0, busy: false };
      this.entries.set(name, entry);
    }
    entry.busy = true;
    const row = entry;
    /**
     * Sets the logical size. Capacity grows geometrically (at least doubling,
     * minimum 1 KiB, capped at maxFileBytes) so N appends cost O(N) amortized
     * copies; shrinking zeroes the tail to keep the Entry invariant.
     * VERIFIED: (memory capacity test) a rejected growth leaves the existing
     * bytes untouched and the queue usable.
     */
    const resize = (size: number) => {
      if (size > this.maxFileBytes) throw new StorageError("QUOTA_EXCEEDED", "defuss-storage: maxFileBytes exceeded");
      if (size > row.buffer.length) {
        const capacity = Math.min(this.maxFileBytes, Math.max(size, 1024, row.buffer.length * 2));
        const next = new Uint8Array(capacity);
        next.set(row.buffer.subarray(0, row.size));
        row.buffer = next;
      }
      if (size < row.size) row.buffer.fill(0, size, row.size);
      row.size = size;
    };
    return new ManagedFile(name, opts.readOnly, this.limits, {
      size: () => row.size,
      read: (offset, target) => {
        const count = Math.min(target.length, Math.max(0, row.size - offset));
        target.set(row.buffer.subarray(offset, offset + count));
        return count;
      },
      write: (offset, data) => {
        if (offset + data.length > row.size) resize(offset + data.length);
        row.buffer.set(data, offset);
        return data.length;
      },
      truncate: resize,
      flush: () => undefined,
      close: () => { row.busy = false; },
    }, { writeBuffer: opts.writeBuffer });
  }
  async list(): Promise<string[]> { return [...this.entries.keys()].sort(); }
  async remove(name: string): Promise<boolean> {
    validateName(name);
    if (this.entries.get(name)?.busy) throw new StorageError("BUSY", `defuss-storage: ${name} is open`);
    return this.entries.delete(name);
  }
}

/** Creates an empty, independent in-memory namespace. */
export const createMemoryStorage = (options: MemoryStorageOptions = {}): MemoryStorage => new MemoryStorage(options);
