/**
 * Exclusive Web Locks for the browser adapters (OPFS and directory handles):
 * one lock per open file, taken without waiting.
 *
 * @module
 */
import { StorageError } from "./errors.js";

// Structural host interface keeps declarations independent of DOM lib versions.
export interface LockManager {
  request(name: string, options: { ifAvailable: true; mode: "exclusive" }, callback: (lock: object | null) => Promise<void>): Promise<void>;
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
export async function acquire(locks: LockManager, name: string): Promise<() => Promise<void>> {
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
