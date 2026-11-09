// Dedicated-worker side of the browser suite. OPFS sync access handles exist only
// in dedicated workers, so the page (scripts/browser-test.mjs) sends tasks here by
// message. The runner serves this file and contract.ts type-stripped by
// TypeScript's transpileModule; dist/ and DSON are served as built. Tasks:
//   'capabilities'  which required APIs this browser exposes to a worker
//   'suite'         the shared contract cases per adapter, failures collected per case
//   'hold'          opens shared.bin, writes and flushes, and keeps it open
//   'busy'          a second worker must see BUSY for open and remove
//   'release'       closes the held handle
//   'reopen'        a fresh worker reads the flushed bytes; with `retry` it waits
//                   for the browser to release a terminated owner's lock
//   'foreign-dir'   a directory under a valid name is never opened, removed or listed
import { createMemoryStorage, type AdapterOptions, type StorageAdapter, type StorageFile } from '../dist/index.mjs';
import { createOPFSStorage } from '../dist/opfs.mjs';
import * as dson from '../node_modules/defuss-dson/dist/sequence.mjs';
import { contractCases, runCase, dsonContract, assert, equal, type ContractCase } from './contract.ts';

// Structural views of the worker globals used here, so the tests need no DOM or
// WebWorker lib (which would conflict with the Node types of the vitest files).
interface Directory {
  getDirectoryHandle(name: string, options?: { create: boolean }): Promise<Directory>;
  removeEntry(name: string): Promise<void>;
}
interface WorkerScope {
  navigator: { storage?: { getDirectory?: () => Promise<Directory> }; locks?: { request?: unknown } };
  FileSystemFileHandle?: { prototype?: { createSyncAccessHandle?: unknown } };
  onmessage: ((event: { data: Request }) => void) | null;
  postMessage(message: unknown): void;
}
interface Request { id: number; task: string; namespace: string; adapters: string[]; retry?: boolean }
type Thrown = { name?: string; code?: string; message?: string; stack?: string; cause?: { name?: string; message?: string } };
const scope = globalThis as unknown as WorkerScope;

const SHARED = [4, 8, 15, 16, 23, 42];
let held: StorageFile | undefined;
async function erase(store: StorageAdapter): Promise<void> { for (const name of await store.list()) await store.remove(name); }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// WebKit stacks omit the message, so failures carry name, code, message and cause explicitly.
const describe = (caught: unknown): string => { const error = caught as Thrown | undefined; return `${error?.name ?? 'Error'}${error?.code ? ` ${error.code}` : ''}: ${error?.message ?? error}` +
  (error?.cause ? ` (cause ${error.cause.name}: ${error.cause.message})` : '') + `\n${error?.stack ?? ''}`; };

/** Runs every contract case for one adapter, recording failures instead of stopping at the first. */
async function suite(adapter: string, namespace: string) {
  const passed: string[] = []; const failed: { name: string; message: string }[] = [];
  const make = async (suffix: number | string, options: AdapterOptions = {}): Promise<StorageAdapter> =>
    adapter === 'memory' ? createMemoryStorage(options) : createOPFSStorage({ ...options, name: `${namespace}-${suffix}` });
  const cases: [string, (store: StorageAdapter) => Promise<unknown>, number | string][] = [
    ...contractCases.map(([name, body]: ContractCase, i): [string, (store: StorageAdapter) => Promise<unknown>, number] =>
      [name, store => runCase(store, body, options => make(i, options)), i]),
    ['DSON 1.3.0 integration', store => dsonContract(store, dson), 'dson']];
  for (const [name, body, suffix] of cases) {
    let store: StorageAdapter | undefined;
    try { store = await make(suffix); await body(store); passed.push(`${adapter}: ${name}`); }
    catch (error) { failed.push({ name: `${adapter}: ${name}`, message: describe(error) }); }
    finally { if (store) await erase(store).catch(() => {}); }
  }
  return { passed, failed };
}

const tasks: Record<string, (request: Request) => Promise<unknown>> = {
  capabilities: async () => ({
    getDirectory: typeof scope.navigator.storage?.getDirectory === 'function',
    syncAccessHandle: typeof scope.FileSystemFileHandle?.prototype?.createSyncAccessHandle === 'function',
    webLocks: typeof scope.navigator.locks?.request === 'function',
  }),
  suite: async ({ namespace, adapters }) => {
    const passed: string[] = []; const failed: { name: string; message: string }[] = [];
    for (const adapter of adapters) { const r = await suite(adapter, namespace); passed.push(...r.passed); failed.push(...r.failed); }
    return { passed, failed };
  },
  hold: async ({ namespace }) => {
    const store = await createOPFSStorage({ name: namespace }); held = await store.open('shared.bin', { create: true });
    await held.truncate(0); await held.append(new Uint8Array(SHARED)); await held.flush(); return 'held';
  },
  release: async () => { await held?.close(); held = undefined; return 'released'; },
  busy: async ({ namespace }) => {
    const store = await createOPFSStorage({ name: namespace });
    for (const fn of [() => store.open('shared.bin'), () => store.remove('shared.bin')]) {
      let code: unknown; try { await fn(); } catch (e) { code = (e as Thrown).code; } equal(code, 'BUSY', 'cross-worker ownership');
    }
    return 'busy';
  },
  reopen: async ({ namespace, retry }) => {
    const store = await createOPFSStorage({ name: namespace });
    // A terminated worker's lock and sync handle are released asynchronously by the browser.
    const deadline = Date.now() + (retry ? 10000 : 0); let attempts = 0; let f: StorageFile;
    for (;;) {
      attempts++;
      try { f = await store.open('shared.bin'); break; }
      catch (error) { if ((error as Thrown).code !== 'BUSY' || Date.now() >= deadline) throw error; await sleep(50); }
    }
    try { equal([...await f.readExactly(0, SHARED.length)], SHARED); } finally { await f.close(); }
    await erase(store); return { persisted: true, attempts };
  },
  'foreign-dir': async ({ namespace }) => {
    const store = await createOPFSStorage({ name: namespace });
    const origin = await scope.navigator.storage!.getDirectory!();
    const root = await (await origin.getDirectoryHandle('defuss-storage')).getDirectoryHandle(namespace);
    await root.getDirectoryHandle('sub.bin', { create: true });
    for (const fn of [() => store.open('sub.bin'), () => store.open('sub.bin', { create: true }), () => store.remove('sub.bin')]) {
      let code: unknown; try { await fn(); } catch (e) { code = (e as Thrown).code; } equal(code, 'UNSUPPORTED', 'foreign directory');
    }
    equal(await store.list(), []); await root.removeEntry('sub.bin'); return 'foreign-dir';
  },
};

scope.onmessage = async ({ data: request }) => {
  try {
    const task = tasks[request.task]; assert(task, `unknown test task ${request.task}`);
    scope.postMessage({ id: request.id, result: await task(request) });
  } catch (error) { scope.postMessage({ id: request.id, error: { message: describe(error), code: (error as Thrown | undefined)?.code } }); }
};
