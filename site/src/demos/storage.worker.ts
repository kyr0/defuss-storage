// The demo worker: hosts defuss-storage where OPFS sync access handles exist (a
// dedicated worker; VERIFIED: the package's browser suite checks that the main
// thread is rejected) and runs the demo operations the page asks for. When this
// context has no OPFS it falls back to the memory adapter and says so in every
// reply. VERIFIED: (site e2e, WebKit 26.5) an ephemeral context has no OPFS.
import { appendChunks, createMemoryStorage, type StorageAdapter, type StorageFile } from 'defuss-storage';
import { createOPFSStorage } from 'defuss-storage/opfs';
import { createDirectoryStorage } from 'defuss-storage/directory';
import type { Backend, BenchCase, FileView, Operation, Progress, Reply, Request, Requests, SeekRow } from './protocol.ts';

interface Limits { maxPendingOperations?: number; maxPendingWriteBytes?: number }

const post = (message: Reply | Progress, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TAIL = 256;
const memory = new Map<string, StorageAdapter>();
let opfsProblem: string | undefined;

/** An adapter for `name`: OPFS when this context has it, else a memory adapter that lives as long as the worker. */
/** The folder the visitor picked; each demo keeps its files in its own subfolder of defuss-storage-demo/. */
let picked: FileSystemDirectoryHandle | undefined;

async function adapter(name: string, limits: Limits = {}, wanted: Backend = 'opfs'): Promise<{ storage: StorageAdapter; backend: Backend }> {
  if (wanted === 'directory') {
    if (!picked) throw Object.assign(new Error('no folder picked'), { code: 'NO_FOLDER' });
    const demos = await picked.getDirectoryHandle('defuss-storage-demo', { create: true });
    const folder = await demos.getDirectoryHandle(name, { create: true });
    return { storage: await createDirectoryStorage(folder, { ...limits, name: `picked:${name}` }), backend: 'directory' };
  }
  if (wanted === 'opfs' && opfsProblem === undefined) {
    try {
      return { storage: await createOPFSStorage({ name, ...limits }), backend: 'opfs' };
    } catch (error) {
      opfsProblem = String((error as { code?: string }).code ?? error);
    }
  }
  const key = `${name}:${JSON.stringify(limits)}`;
  let storage = memory.get(key);
  if (!storage) memory.set(key, (storage = createMemoryStorage(limits)));
  return { storage, backend: 'memory' };
}
// A memory adapter lives in this worker, per name and limits: its files last as long as the page.

/** Opens `name`, runs `body`, and always closes the handle, so other tabs can open the file in between. */
async function withFile<T>(storage: StorageAdapter, name: string, body: (file: StorageFile) => Promise<T>): Promise<T> {
  const file = await storage.open(name, { create: true });
  try { return await body(file); } finally { await file.close(); }
}

async function view(file: StorageFile, backend: Backend): Promise<FileView> {
  const size = await file.size();
  const tailOffset = Math.max(0, size - TAIL);
  const tail = await file.readExactly(tailOffset, size - tailOffset);
  return { backend, ...(backend === 'memory' ? { reason: opfsProblem } : {}), size, tail, tailOffset };
}

const elapsed = (started: number) => performance.now() - started;
/** Admission limits for the backpressure demo. One chunk always fits the byte budget (the page keeps it so). */
const limitsFor = (ops: number, bytes: number, chunk: number): Limits => ({ maxPendingOperations: ops, maxPendingWriteBytes: Math.max(bytes, chunk) });
let ownerFile: StorageFile | undefined;

async function benchmark(report: (progress: number, step: string) => void): Promise<{ cases: BenchCase[]; backend: Backend }> {
  const { storage, backend } = await adapter('site-bench');
  const total = 16 * 1024 * 1024;
  const cases: BenchCase[] = [];
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  const steps = 6;
  let step = 0;
  const appendCase = async (id: BenchCase['id'], chunk: number, options: { writeBuffer?: number; transfer?: boolean }) => {
    report(step++ / steps, id);
    const runs: number[] = [];
    for (let run = 0; run < 3; run++) {
      const ms = await withFile(storage, 'bench.bin', async file => {
        await file.truncate(0);
        const handle = options.writeBuffer ? await reopen(storage, file, options.writeBuffer) : file;
        const source = new Uint8Array(chunk).fill(7);
        const started = performance.now();
        for (let written = 0; written < total; written += chunk)
          await handle.append(options.transfer ? source.slice() : source, options.transfer ? { transfer: true } : undefined);
        await handle.flush();
        const time = elapsed(started);
        if (handle !== file) await handle.close();
        return time;
      });
      runs.push(total / 1024 / 1024 / (ms / 1000));
    }
    cases.push({ id, unit: 'MiB/s', value: median(runs) });
  };
  await appendCase('append4k', 4096, {});
  await appendCase('append4kBuffered', 4096, { writeBuffer: 1024 * 1024 });
  await appendCase('append1mCopy', 1024 * 1024, {});
  await appendCase('append1mTransfer', 1024 * 1024, { transfer: true });
  report(step++ / steps, 'stream64k');
  const streamRuns: number[] = [];
  const readRuns: number[] = [];
  await withFile(storage, 'bench.bin', async file => {
    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      let bytes = 0;
      for await (const chunk of file.stream({ chunkSize: 64 * 1024 })) bytes += chunk.byteLength;
      streamRuns.push(bytes / 1024 / 1024 / (elapsed(started) / 1000));
    }
    report(step++ / steps, 'readInto4k');
    const target = new Uint8Array(4096);
    const size = await file.size();
    for (let run = 0; run < 3; run++) {
      const reads = 2000;
      const started = performance.now();
      for (let i = 0; i < reads; i++) await file.readInto(Math.floor(Math.random() * (size / 4096)) * 4096, target);
      readRuns.push((elapsed(started) * 1000) / reads);
    }
  });
  cases.push({ id: 'stream64k', unit: 'MiB/s', value: median(streamRuns) }, { id: 'readInto4k', unit: 'µs', value: median(readRuns) });
  await storage.remove('bench.bin');
  report(1, 'done');
  return { cases, backend };
}

/** The write-buffer case needs its own handle option: close the plain handle's name and reopen buffered. */
async function reopen(storage: StorageAdapter, file: StorageFile, writeBuffer: number): Promise<StorageFile> {
  await file.close();
  return storage.open('bench.bin', { writeBuffer });
}

// Seek demo: the open log and its index (offset and length per record), kept by this worker.
let seek: { file: StorageFile; offsets: Float64Array; lengths: Uint16Array; count: number } | undefined;
const seekIndex = () => {
  if (!seek) throw Object.assign(new Error('write records first'), { code: 'NO_RECORDS' });
  return seek;
};
const ROOMS = ['attic', 'boiler', 'cellar', 'garage', 'garden', 'kitchen', 'server-room', 'studio'];
const SEEK_EPOCH = Date.UTC(2026, 0, 1);
/** Record `index` of the demo log: one line of variable length, so offsets cannot be computed, only indexed. */
/** Six hex digits that look random but follow from `index` (a 32-bit integer mix), so every run writes the same file. */
const hash6 = (index: number): string => {
  let mixed = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
  return ((mixed ^ (mixed >>> 16)) >>> 0).toString(16).padStart(8, '0').slice(0, 6);
};
const seekRecord = (index: number): string =>
  `${String(index).padStart(7, '0')} ${new Date(SEEK_EPOCH + index * 1000).toISOString()} ${ROOMS[index % ROOMS.length]} temp=${(12 + ((index * 7919) % 230) / 10).toFixed(1)} humidity=${30 + ((index * 104_729) % 50)}% ${hash6(index)}\n`;

const handlers: { [O in Operation]: (args: Requests[O]['args'], id: number) => Promise<Requests[O]['result']> } = {
  'dir:set': async ({ handle }) => { picked = handle; return { name: handle.name }; },
  'persist:state': async ({ backend: wanted }) => {
    const { storage, backend } = await adapter('site-persist', {}, wanted);
    return withFile(storage, 'journal.log', file => view(file, backend));
  },
  'persist:append': async ({ text, backend: wanted }) => {
    const { storage, backend } = await adapter('site-persist', {}, wanted);
    return withFile(storage, 'journal.log', async file => {
      const started = performance.now();
      const { offset, byteLength } = await file.append(encoder.encode(`${text}\n`));
      await file.flush();
      const ms = elapsed(started);
      return { ...(await view(file, backend)), offset, byteLength, ms };
    });
  },
  'persist:read': async ({ backend: wanted }) => {
    const { storage, backend } = await adapter('site-persist', {}, wanted);
    return withFile(storage, 'journal.log', async file => {
      const started = performance.now();
      const size = await file.size();
      const bytes = await file.readExactly(Math.max(0, size - 64 * 1024), Math.min(size, 64 * 1024));
      const ms = elapsed(started);
      return { ...(await view(file, backend)), text: decoder.decode(bytes), ms };
    });
  },
  'persist:truncate': async ({ backend: wanted }) => {
    const { storage, backend } = await adapter('site-persist', {}, wanted);
    return withFile(storage, 'journal.log', async file => {
      await file.truncate(0);
      await file.flush();
      return view(file, backend);
    });
  },
  'owner:open': async () => {
    const { storage, backend } = await adapter('site-owner');
    if (!ownerFile) ownerFile = await storage.open('shared.bin', { create: true });
    return { backend };
  },
  'owner:close': async () => {
    await ownerFile?.close();
    ownerFile = undefined;
    return null;
  },
  'limits:fire': async ({ calls, chunk, ops, bytes, backend: wanted }) => {
    const { storage, backend } = await adapter('site-limits', limitsFor(ops, bytes, chunk), wanted);
    return withFile(storage, 'limits.bin', async file => {
      await file.truncate(0);
      const source = new Uint8Array(chunk);
      const started = performance.now();
      // Every call is issued before any of them completes, as in an un-awaited loop.
      // VERIFIED: (site e2e, three engines) the defaults admit all 64; a limit of 16 operations admits 16.
      const results = await Promise.allSettled(Array.from({ length: calls }, () => file.append(source)));
      const ms = elapsed(started);
      const states = results.map(result => result.status === 'fulfilled' ? 'ok' as const
        : (result.reason as { code?: string }).code === 'QUEUE_FULL' ? 'full' as const : 'error' as const);
      return { states, ms, backend };
    });
  },
  'limits:chunks': async ({ calls, chunk, ops, bytes, backend: wanted }) => {
    const { storage, backend } = await adapter('site-limits', limitsFor(ops, bytes, chunk), wanted);
    return withFile(storage, 'limits.bin', async file => {
      await file.truncate(0);
      const inFlight = Math.max(1, Math.min(ops, Math.floor(bytes / chunk)));
      async function* source() { for (let i = 0; i < calls; i++) yield new Uint8Array(chunk); }
      const started = performance.now();
      let count = 0;
      for await (const _receipt of appendChunks(file, source(), { inFlight })) count++;
      return { count, ms: elapsed(started), backend };
    });
  },
  'bench:run': async (_args, id) => benchmark((progress, step) => post({ id, progress, step })),
  'seek:generate': async ({ records, backend: wanted }, id) => {
    const { storage, backend } = await adapter('site-seek', {}, wanted);
    await seek?.file.close();
    seek = undefined;
    // The write buffer turns a million small appends into about seventy 1 MiB writes.
    const file = await storage.open('records.log', { create: true, writeBuffer: 1024 * 1024 });
    try {
      await file.truncate(0);
      const offsets = new Float64Array(records);
      const lengths = new Uint16Array(records);
      const started = performance.now();
      for (let index = 0; index < records; index++) {
        // Each receipt is the index entry: no size query, no scan.
        const { offset, byteLength } = await file.append(encoder.encode(seekRecord(index)));
        offsets[index] = offset;
        lengths[index] = byteLength;
        if (index % 25_000 === 0) post({ id, progress: index / records, step: 'write' });
      }
      await file.flush();
      const writeMs = elapsed(started);
      const bytes = await file.size();
      // A thousand reads spread over the file, each straight to its offset.
      const probes = Math.min(1000, records);
      const seekStarted = performance.now();
      for (let probe = 0; probe < probes; probe++) {
        const index = (probe * 7919 + 13) % records;
        await file.readExactly(offsets[index]!, lengths[index]!);
      }
      const seekMicros = elapsed(seekStarted) * 1000 / probes;
      seek = { file, offsets, lengths, count: records };
      return { records, bytes, writeMs, seekMicros, backend };
    } catch (error) {
      await file.close();
      throw error;
    }
  },
  'seek:rows': async ({ from, count }) => {
    const index = seekIndex();
    const rows: SeekRow[] = [];
    for (let at = Math.max(0, from); at < Math.min(index.count, from + Math.min(count, 256)); at++)
      rows.push({ index: at, offset: index.offsets[at]!, text: decoder.decode(await index.file.readExactly(index.offsets[at]!, index.lengths[at]!)).trimEnd() });
    return { rows };
  },
  'seek:jump': async ({ index: at }) => {
    const index = seekIndex();
    if (!Number.isSafeInteger(at) || at < 0 || at >= index.count) throw Object.assign(new RangeError(`record ${at} is outside 0..${index.count - 1}`), { code: 'RANGE' });
    const bytes = await index.file.readExactly(index.offsets[at]!, index.lengths[at]!);
    return { index: at, offset: index.offsets[at]!, byteLength: bytes.byteLength, text: decoder.decode(bytes).trimEnd() };
  },
};

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  const handler = handlers[data.op] as (args: unknown, id: number) => Promise<unknown>;
  try {
    const value = await handler(data.args, data.id);
    const transfer = value && typeof value === 'object' && 'tail' in value ? [(value as FileView).tail.buffer] : [];
    post({ id: data.id, ok: true, value }, transfer);
  } catch (error) {
    const { code = 'ERROR', message = String(error) } = error as { code?: string; message?: string };
    post({ id: data.id, ok: false, code, message });
  }
};
