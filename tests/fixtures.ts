// Real backends and temporary directories shared by the test files. A backend is
// an ordinary StorageFileBackend driven through createStorageFile: the code under
// test is the shipped handle, and failures are injected by the backend itself
// rather than by a mocking framework.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { StorageFile, StorageFileBackend } from '../dist/index.mjs';

export interface Admission { operations: number; writeBytes: number; readBytes: number }
/** Internal accounting hook (not public API): reservations, plus bytes of overlapping reads now running. */
export function admission(file: StorageFile): Admission {
  return (file as unknown as Record<symbol, Admission>)[Symbol.for('defuss-storage.v0.admission')]!;
}
/** Reservation counters only, for handles whose reads never overlap. */
export function reservations(file: StorageFile): { operations: number; writeBytes: number } {
  const { operations, writeBytes } = admission(file); return { operations, writeBytes };
}

/** Runs `body` with a fresh temporary directory that is removed afterwards. */
export async function withTempDir<T>(prefix: string, body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), `defuss-${prefix}-`));
  try { return await body(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

export interface StalledBackend {
  backend: StorageFileBackend;
  size: number;
  /** Backend write calls and bytes received so far. */
  writes: number;
  received: number;
  /** Resolves when the first write reaches the backend. */
  entered: Promise<void>;
  /** Lets every pending and future write complete. */
  open(): void;
}
/** A backend whose writes wait until `open()` is called. */
export function stalledBackend(): StalledBackend {
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const state: StalledBackend = {
    size: 0, writes: 0, received: 0, open: () => release(), entered: new Promise<void>(resolve => { entered = resolve; }),
    backend: {
      size: () => state.size, read: () => 0, truncate() {}, flush() {}, close() {},
      write: async (at, input) => {
        state.writes++; state.received += input.length; entered(); await gate;
        state.size = Math.max(state.size, at + input.length); return input.length;
      },
    },
  };
  return state;
}

export interface FaultBackend { backend: StorageFileBackend; bytes: Uint8Array; size: number; closes: number }
/** A 64-byte array backend whose methods a test can replace to inject faults. */
export function faultBackend(): FaultBackend {
  const state: FaultBackend = {
    bytes: new Uint8Array(64), size: 0, closes: 0,
    backend: {
      size: () => state.size,
      read: (at, out) => { const n = Math.min(out.length, Math.max(0, state.size - at)); out.set(state.bytes.subarray(at, at + n)); return n; },
      write: (at, input) => { state.bytes.set(input, at); state.size = Math.max(state.size, at + input.length); return input.length; },
      truncate: n => { state.bytes.fill(0, n); state.size = n; }, flush() {}, close() { state.closes++; },
    },
  };
  return state;
}

/** An Error carrying a platform `code`, like Node's fs errors. */
export const codedError = (message: string, code: string | undefined): Error => Object.assign(new Error(message), { code });

/** The rejection reason of `promise`; fails the test if it resolves. */
export async function rejection(promise: Promise<unknown>): Promise<{ code?: string; cause?: unknown; suppressed?: unknown }> {
  return promise.then(value => { throw new Error(`expected a rejection, got ${String(value)}`); }, (error: unknown) => error as never);
}
