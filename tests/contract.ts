// Shared contract cases. The same cases run against memory and native files under
// vitest (Node.js) and bun test (Bun), and against memory and real OPFS in dedicated
// workers of Chromium, Firefox and WebKit (tests/browser-worker.ts). That is why
// this module uses its own small assertion helpers instead of a runner's `expect`:
// a browser worker has no test runner. It imports the built dist/, not src/.
import { appendChunks, type AdapterOptions, type OpenOptions, type StorageAdapter, type StorageFile } from '../dist/index.mjs';
import type * as Dson from 'defuss-dson/sequence';

/** What a contract case receives: the adapter under test and helpers that track opened files. */
export interface CaseContext {
  storage: StorageAdapter;
  /** Opens through `storage`; defaults to `data.bin` with `{ create: true }`. */
  open: (name?: string, options?: OpenOptions) => Promise<StorageFile>;
  /** A second adapter of the same kind and namespace, created with `options`. */
  limited: (options: AdapterOptions) => Promise<{ adapter: StorageAdapter; open: CaseContext['open'] }>;
}
export type ContractCase = [name: string, body: (context: CaseContext) => Promise<void>];
type Thrown = { code?: string; name?: string; message?: string };

export function assert(value: unknown, message = 'assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
/** Structural equality through JSON, which is exact for the byte arrays, numbers and plain objects compared here. */
export function equal(actual: unknown, expected: unknown, message = 'values differ'): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
/** Asserts that `fn` rejects with a StorageError `code` or an error `name` such as 'RangeError'. */
export async function rejects(fn: () => unknown, code: string): Promise<void> {
  try { await fn(); } catch (caught) {
    const error = caught as Thrown;
    assert(error.code === code || error.name === code, `expected ${code}, got ${error.code ?? error.name}: ${error.message}`);
    return;
  }
  throw new Error(`expected rejection ${code}`);
}
const data = (...values: number[]): Uint8Array => new Uint8Array(values);
/** Consumes an async iterator to completion, discarding its values. */
async function drain(iterator: AsyncIterable<unknown>): Promise<void> { for await (const _ of iterator) { /* discard */ } }
export async function collect(stream: AsyncIterable<Uint8Array>): Promise<number[]> {
  const out: number[] = []; for await (const chunk of stream) out.push(...chunk); return out;
}
/**
 * Runs one contract case. `configure(options)` creates another adapter of the same
 * kind and namespace with the given AdapterOptions; files opened through the
 * case's `open` (on either adapter) are closed afterwards even if the case fails.
 */
export async function runCase(storage: StorageAdapter, testCase: ContractCase[1], configure: (options: AdapterOptions) => StorageAdapter | Promise<StorageAdapter>): Promise<void> {
  const opened: StorageFile[] = [];
  const track = (adapter: StorageAdapter): CaseContext['open'] => async (name = 'data.bin', options = { create: true }) => {
    const file = await adapter.open(name, options); opened.push(file); return file;
  };
  const limited = async (options: AdapterOptions) => { const adapter = await configure(options); return { adapter, open: track(adapter) }; };
  try { await testCase({ storage, open: track(storage), limited }); }
  finally { await Promise.allSettled(opened.map(file => file.close())); }
}
/** Settles every promise and returns `code`/`name` of each rejection, or 'ok'. */
export async function outcomes(promises: Promise<unknown>[]): Promise<string[]> {
  return (await Promise.allSettled(promises)).map(r => r.status === 'fulfilled' ? 'ok' : String((r.reason as Thrown).code ?? (r.reason as Thrown).name));
}

export const contractCases: ContractCase[] = [
  ['missing files never appear implicitly', async ({ storage }) => {
    await rejects(() => storage.open('missing.bin'), 'NOT_FOUND'); equal(await storage.list(), []);
  }],
  ['create, flush, close and reopen preserve bytes', async ({ open }) => {
    const f = await open(); equal(await f.size(), 0); await f.append(data(1, 2, 3)); await f.flush(); await f.close();
    const g = await open('data.bin', {}); equal([...await g.read(0, 9)], [1, 2, 3]);
  }],
  ['exclusive create rejects existing files without truncating', async ({ storage, open }) => {
    const f = await open(); await f.append(data(7)); await f.close();
    await rejects(() => storage.open('data.bin', { create: true, exclusive: true }), 'ALREADY_EXISTS');
    const g = await open(); equal([...await g.read(0, 1)], [7]);
  }],
  ['write snapshots the supplied view at invocation', async ({ open }) => {
    const f = await open(); const source = data(9, 1, 2, 3, 8); const pending = f.write(0, source.subarray(1, 4)); source.fill(0); await pending;
    equal([...await f.read(0, 9)], [1, 2, 3]);
  }],
  ['read buffers cannot mutate the stored bytes', async ({ open }) => {
    const f = await open(); await f.append(data(1, 2, 3)); const result = await f.read(0, 3); result.fill(9);
    equal([...await f.read(0, 3)], [1, 2, 3]);
  }],
  ['overwrite keeps the suffix and zero-length writes keep size', async ({ open }) => {
    const f = await open(); await f.append(data(1, 2, 3, 4)); await f.write(1, data(8)); await f.write(100, data());
    equal([...await f.read(0, 10)], [1, 8, 3, 4]); equal(await f.size(), 4);
  }],
  ['writes beyond EOF zero-fill gaps', async ({ open }) => {
    const f = await open(); await f.append(data(1)); await f.write(4, data(8, 9)); equal([...await f.read(0, 10)], [1, 0, 0, 0, 8, 9]);
  }],
  ['shrink then grow never revives discarded bytes', async ({ open }) => {
    const f = await open(); await f.append(data(1, 2, 3, 4)); await f.truncate(1); await f.truncate(5);
    equal([...await f.read(0, 5)], [1, 0, 0, 0, 0]);
  }],
  ['concurrent appends return disjoint ordered offsets', async ({ open }) => {
    const f = await open(); const results = await Promise.all(Array.from({ length: 64 }, (_, i) => f.append(data(i, i))));
    equal(results, Array.from({ length: 64 }, (_, i) => ({ offset: i * 2, byteLength: 2 })));
    equal([...await f.read(0, 128)], Array.from({ length: 128 }, (_, i) => Math.floor(i / 2)));
    equal(await f.append(data()), { offset: 128, byteLength: 0 });
  }],
  ['EOF, zero-length reads and exact reads are distinct', async ({ open }) => {
    const f = await open(); await f.append(data(4, 5)); equal([...await f.read(1, 9)], [5]); equal([...await f.read(9, 2)], []);
    equal([...await f.readExactly(20, 0)], []); await rejects(() => f.readExactly(1, 2), 'UNEXPECTED_EOF');
  }],
  ['readInto respects target windows and leaves unread bytes intact', async ({ open }) => {
    const f = await open(); await f.append(data(1, 2, 3)); const buffer = data(9, 9, 9, 9, 9);
    equal(await f.readInto(1, buffer.subarray(1, 4)), 2); equal([...buffer], [9, 2, 3, 9, 9]);
  }],
  ['streams honor ranges, chunk bounds and independent outputs', async ({ open }) => {
    const f = await open(); await f.append(data(0, 1, 2, 3, 4, 5, 6)); const chunks: Uint8Array[] = [];
    for await (const chunk of f.stream({ start: 1, end: 6, chunkSize: 2 })) chunks.push(chunk);
    equal(chunks.map(x => [...x]), [[1, 2], [3, 4], [5]]); chunks[0]!.fill(99);
    equal(await collect(f.stream({ start: 5, end: 100, chunkSize: 1 })), [5, 6]); equal(await collect(f.stream({ start: 100 })), []);
  }],
  ['streams fix their end but do not promise snapshot isolation', async ({ open }) => {
    const f = await open(); await f.append(data(1, 2, 3)); const stream = f.stream({ chunkSize: 1 });
    equal([...(await stream.next()).value], [1]); await f.append(data(4)); await f.write(1, data(8));
    equal(await collect(stream), [8, 3]);
  }],
  ['a mutation queued after a read-ahead is still seen by its chunk', async ({ open }) => {
    const f = await open(); await f.append(data(1, 2, 3, 4)); const stream = f.stream({ chunkSize: 1 });
    // A consumer slower than the read-ahead threshold: from the second pull on, the next chunk is read early.
    equal([...(await stream.next()).value], [1]); await new Promise(resolve => setTimeout(resolve, 1));
    equal([...(await stream.next()).value], [2]); await f.write(2, data(9)); await f.truncate(3);
    equal([...(await stream.next()).value], [9]); await rejects(() => stream.next(), 'UNEXPECTED_EOF');
  }],
  ['unexpected truncation during a stream fails visibly', async ({ open }) => {
    const f = await open(); await f.append(data(1, 2, 3)); const stream = f.stream({ chunkSize: 1 }); await stream.next(); await f.truncate(1);
    await rejects(() => stream.next(), 'UNEXPECTED_EOF');
  }],
  ['breaking a stream retains caller ownership', async ({ open }) => {
    const f = await open(); await f.append(data(1, 2)); for await (const _ of f.stream({ chunkSize: 1 })) break;
    await f.append(data(3)); equal(await f.size(), 3);
  }],
  ['cancellation stops reads and writes before I/O', async ({ open }) => {
    const f = await open(); const signal = { aborted: true, reason: 'test' };
    await rejects(() => f.read(0, 1, { signal }), 'ABORTED'); await rejects(() => f.append(data(2), { signal }), 'ABORTED');
    await rejects(() => f.truncate(2, { signal }), 'ABORTED'); equal(await f.size(), 0);
    await f.append(data(1, 2)); signal.aborted = false; const s = f.stream({ chunkSize: 1, signal }); await s.next(); signal.aborted = true;
    await rejects(() => s.next(), 'ABORTED');
  }],
  ['close drains accepted work and is idempotent', async ({ open }) => {
    const f = await open(); const writes = [f.append(data(1)), f.append(data(2))]; const close = f.close(); assert(close === f.close());
    await rejects(() => f.size(), 'CLOSED'); await rejects(() => f.append(data(3)), 'CLOSED'); await Promise.all(writes); await close;
    const g = await open(); equal([...await g.read(0, 5)], [1, 2]);
  }],
  ['read-only handles reject all mutations', async ({ open }) => {
    const f = await open(); await f.append(data(1)); await f.close(); const g = await open('data.bin', { readOnly: true });
    equal([...await g.read(0, 1)], [1]); await g.flush(); await rejects(() => g.write(0, data()), 'READ_ONLY');
    await rejects(() => g.append(data(2)), 'READ_ONLY'); await rejects(() => g.truncate(0), 'READ_ONLY');
  }],
  ['owned files reject other opens and deletion', async ({ storage, open }) => {
    const f = await open(); await rejects(() => storage.open('data.bin'), 'BUSY'); await rejects(() => storage.remove('data.bin'), 'BUSY');
    await f.close(); equal(await storage.remove('data.bin'), true); equal(await storage.remove('data.bin'), false);
  }],
  ['listing is sorted and removal preserves unrelated files', async ({ storage, open }) => {
    for (const name of ['c.bin', 'a.bin', 'b.bin']) await (await open(name)).close();
    equal(await storage.list(), ['a.bin', 'b.bin', 'c.bin']); await storage.remove('b.bin'); equal(await storage.list(), ['a.bin', 'c.bin']);
  }],
  ['names are portable and cannot traverse directories', async ({ storage }) => {
    for (const name of ['', '../x', '.', '..', '/x', 'a/b', 'a\\b', 'UPPER', 'x.', 'nul', 'con.bin', 'a'.repeat(129), 'x\0y']) {
      await rejects(() => storage.open(name, { create: true }), 'TypeError'); await rejects(() => storage.remove(name), 'TypeError');
    }
    equal(await storage.list(), []);
  }],
  ['invalid offsets, allocation bounds and options fail before I/O', async ({ storage, open }) => {
    const f = await open();
    for (const value of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      await rejects(() => f.read(value, 1), 'RangeError'); await rejects(() => f.truncate(value), 'RangeError');
    }
    await rejects(() => f.read(Number.MAX_SAFE_INTEGER, 1), 'RangeError');
    await rejects(() => f.read(0, f.maxReadBytes + 1), 'RangeError');
    await rejects(() => f.stream({ chunkSize: 0 }).next(), 'RangeError');
    await rejects(() => f.stream({ start: 5, end: 4 }).next(), 'RangeError');
    await rejects(() => storage.open('bad.bin', { exclusive: true }), 'TypeError');
    await rejects(() => storage.open('bad.bin', { readOnly: true, create: true }), 'TypeError');
    equal(await f.size(), 0);
  }],
  ['write admission rejects bursts beyond the pending budgets before any I/O', async ({ limited }) => {
    const { open } = await limited({ maxWriteBytes: 4, maxPendingWriteBytes: 8, maxPendingOperations: 3 });
    const f = await open();
    // Admission is synchronous, so a burst issued without awaiting saturates deterministically.
    const burst = [f.append(data(1, 2, 3, 4)), f.append(data(5, 6, 7, 8)), f.append(data(9)), f.size(), f.read(0, 1), f.append(data())];
    equal(await outcomes(burst), ['ok', 'ok', 'QUEUE_FULL', 'ok', 'QUEUE_FULL', 'QUEUE_FULL']);
    await rejects(() => f.write(0, data(1, 2, 3, 4, 5)), 'RangeError');
    equal([...await f.read(0, 9)], [1, 2, 3, 4, 5, 6, 7, 8]);
    // Every reservation was released: the full budget is admissible again.
    equal(await outcomes([f.write(0, data(0, 0, 0, 0)), f.write(4, data(0, 0, 0, 0)), f.append(data())]), ['ok', 'ok', 'ok']);
    equal(await f.size(), 8);
  }],
  ['close stays admissible under saturation and drains accepted work', async ({ limited }) => {
    const { open } = await limited({ maxPendingOperations: 2 });
    const f = await open(); const accepted = [f.append(data(1)), f.append(data(2))];
    await rejects(() => f.append(data(3)), 'QUEUE_FULL');
    const closing = f.close(); assert(closing === f.close()); await rejects(() => f.size(), 'CLOSED');
    equal(await outcomes(accepted), ['ok', 'ok']); await closing;
    const g = await open(); equal([...await g.read(0, 9)], [1, 2]);
  }],
  ['admission options are positive safe integers with maxWriteBytes <= maxPendingWriteBytes', async ({ limited }) => {
    for (const key of ['maxWriteBytes', 'maxPendingWriteBytes', 'maxPendingOperations']) {
      for (const value of [0, -1, 1.5, NaN, Infinity]) await rejects(() => limited({ [key]: value } as AdapterOptions), 'RangeError');
    }
    await rejects(() => limited({ maxWriteBytes: 9, maxPendingWriteBytes: 8 }), 'RangeError');
    // An explicit bound below a default lowers the other default instead of failing.
    const { open } = await limited({ maxPendingWriteBytes: 2 }); const f = await open();
    await rejects(() => f.append(data(1, 2, 3)), 'RangeError'); equal(await f.append(data(1, 2)), { offset: 0, byteLength: 2 });
  }],
  ['appendChunks yields each append\'s actual offset, also with interleaved writers', async ({ open }) => {
    const f = await open(); const results: unknown[] = [];
    async function* source() { yield data(1, 2); yield data(); yield data(3); }
    for await (const receipt of appendChunks(f, source())) {
      results.push(receipt); if (results.length === 1) await f.append(data(9));
    }
    equal(results, [{ offset: 0, byteLength: 2 }, { offset: 3, byteLength: 0 }, { offset: 3, byteLength: 1 }]);
    equal([...await f.read(0, 9)], [1, 2, 9, 3]);
  }],
  ['a write buffer holds small appends until another operation needs their bytes', async ({ open }) => {
    const f = await open('buffered.bin', { create: true, writeBuffer: 4 });
    equal(await f.append(data(1, 2)), { offset: 0, byteLength: 2 }); equal(await f.append(data(3)), { offset: 2, byteLength: 1 });
    equal(await f.size(), 3); equal([...await f.read(0, 9)], [1, 2, 3]);
    // Larger than the buffer: written directly, after what is buffered.
    await f.append(data(4)); equal(await f.append(data(5, 5, 5, 5, 5)), { offset: 4, byteLength: 5 });
    await f.append(data(6)); await f.write(0, data(9)); await f.append(data(7)); await f.truncate(10);
    equal([...await f.read(0, 99)], [9, 2, 3, 4, 5, 5, 5, 5, 5, 6]);
    // readInto and readExactly also write what is buffered before reading.
    await f.append(data(8)); const into = new Uint8Array(1); equal(await f.readInto(10, into), 1); equal([...into], [8]);
    await f.append(data(7)); equal([...await f.readExactly(11, 1)], [7]); await f.append(data(6)); await f.close();
    const g = await open('buffered.bin'); equal([...await g.read(10, 9)], [8, 7, 6]); await g.close();
    await rejects(() => open('other.bin', { create: true, writeBuffer: -1 }), 'RangeError');
    await rejects(() => open('buffered.bin', { readOnly: true, writeBuffer: 4 }), 'TypeError');
  }],
  ['transfer hands a whole buffer over without a copy and refuses partial views', async ({ open }) => {
    const f = await open(); const whole = data(1, 2, 3);
    equal(await f.append(whole, { transfer: true }), { offset: 0, byteLength: 3 }); equal(whole.buffer.byteLength, 0);
    const later = data(7, 7); const pending = f.write(1, later, { transfer: true }); equal(later.buffer.byteLength, 0); await pending;
    const part = new Uint8Array(new ArrayBuffer(8), 2, 4);
    await rejects(() => f.write(0, part, { transfer: true }), 'TypeError'); equal(part.buffer.byteLength, 8);
    await rejects(() => f.append(data(1), { transfer: 'yes' as unknown as boolean }), 'TypeError');
    equal([...await f.read(0, 9)], [1, 7, 7]);
  }],
  ['appendChunks with inFlight writes every chunk in order', async ({ open }) => {
    const f = await open(); async function* source() { for (let i = 0; i < 40; i++) yield data(i, i); }
    const receipts: { offset: number }[] = []; for await (const receipt of appendChunks(f, source(), { inFlight: 16 })) receipts.push(receipt);
    equal(receipts.map(r => r.offset), Array.from({ length: 40 }, (_, i) => i * 2));
    equal([...await f.read(0, 80)], Array.from({ length: 80 }, (_, i) => Math.floor(i / 2)));
  }],
  ['appendChunks early break closes the source and leaves the file open', async ({ open }) => {
    const f = await open(); let closed = false;
    async function* source() { try { yield data(1); yield data(2); } finally { closed = true; } }
    for await (const _ of appendChunks(f, source())) break;
    assert(closed, 'source not closed'); equal(await f.append(data(4)), { offset: 1, byteLength: 1 });
  }],
  ['appendChunks abort and append failures keep written bytes and close only the source', async ({ open, limited }) => {
    const f = await open(); const signal = { aborted: false }; let closed = 0;
    async function* source(...chunks: Uint8Array[]) { try { yield* chunks; } finally { closed++; } }
    const it = appendChunks(f, source(data(1), data(2)), { signal });
    equal((await it.next()).value, { offset: 0, byteLength: 1 }); signal.aborted = true;
    await rejects(() => it.next(), 'ABORTED'); equal(closed, 1); equal([...await f.read(0, 9)], [1]);
    const small = await (await limited({ maxWriteBytes: 2 })).open('small.bin');
    await rejects(() => drain(appendChunks(small, source(data(1, 2), data(3, 4, 5)))), 'RangeError'); equal(closed, 2);
    equal([...await small.read(0, 9)], [1, 2]);
    await small.close(); await rejects(() => drain(appendChunks(small, source(data(6)))), 'CLOSED'); equal(closed, 3);
  }],
  ['mixed operation trace matches an independent byte-array model', async ({ open }) => {
    const f = await open(); let expected: number[] = []; let seed = 0x51f15e;
    const random = (n: number): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    for (let step = 0; step < 180; step++) {
      const op = random(3); const payload = Uint8Array.from({ length: 1 + random(12) }, () => random(256));
      if (op === 0) { const r = await f.append(payload); equal(r.offset, expected.length); expected.push(...payload); }
      if (op === 1) { const at = random(90); await f.write(at, payload); while (expected.length < at + payload.length) expected.push(0); expected.splice(at, payload.length, ...payload); }
      if (op === 2) { const size = random(100); await f.truncate(size); expected.length = Math.min(expected.length, size); while (expected.length < size) expected.push(0); }
      equal(await f.size(), expected.length); equal([...await f.read(0, 256)], expected, `trace step ${step}`);
    }
    equal(await collect(f.stream({ chunkSize: 7 })), expected);
  }],
];

/** DSON 1.3.0 frames: append, direct seek through recorded offsets, incremental decode at several chunk sizes. */
export async function dsonContract(storage: StorageAdapter, dson: typeof Dson): Promise<{ frames: number; bytes: number }> {
  const f = await storage.open('records.dsq', { create: true, exclusive: true });
  try {
    const offsets: number[] = [];
    for (let i = 0; i < 9; i++) {
      const value: Record<string, unknown> = { id: BigInt(i), date: new Date(i), bytes: new Uint8Array([i, 10, 255]), tags: new Map([['n', i]]) }; value.self = value;
      offsets.push((await f.append(dson.encodeFrame(value))).offset);
    }
    for (const offset of offsets) {
      const header = await f.readExactly(offset, dson.FRAME_HEADER_BYTES); const meta = dson.inspectFrame(header);
      const record = dson.decodeFrame(await f.readExactly(offset, meta.byteLength));
      const value = record.value as { self: unknown; id: bigint; tags: Map<string, number> };
      assert(value.self === value); equal(value.tags.get('n'), Number(value.id));
    }
    for (const chunkSize of [1, 7, 16, 127]) {
      const decoder = new dson.SequenceDecoder(); const records: Dson.SequenceRecord[] = [];
      for await (const chunk of f.stream({ chunkSize })) records.push(...decoder.push(chunk));
      decoder.finish(); equal(records.map(r => r.offset), offsets); equal(records.map(r => Number((r.value as { id: bigint }).id)), [0,1,2,3,4,5,6,7,8]);
    }
    await f.flush();
    return { frames: offsets.length, bytes: await f.size() };
  } finally { await f.close(); }
}
