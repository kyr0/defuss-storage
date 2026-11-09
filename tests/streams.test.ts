// appendChunks lifecycle beyond the shared contract cases: pull timing against a
// stalled backend, and source-cleanup semantics with hand-written iterators.
import { expect, test } from 'vitest';
import { appendChunks, createMemoryStorage, createStorageFile } from '../dist/index.mjs';
import { rejection, reservations, stalledBackend } from './fixtures.ts';

/** A source built from explicit next/return functions, for cleanup edge cases. */
const source = (next: () => Promise<IteratorResult<Uint8Array>>, onReturn: () => Promise<IteratorResult<Uint8Array>>): AsyncIterable<Uint8Array> =>
  ({ [Symbol.asyncIterator]: () => ({ next, return: onReturn }) });

test('appendChunks pulls the next chunk only after the previous append settled', async () => {
  const stall = stalledBackend(); const f = createStorageFile('ingest', stall.backend); let pulls = 0;
  async function* chunks() { for (let i = 0; i < 3; i++) { pulls++; yield new Uint8Array([i]); } }
  const it = appendChunks(f, chunks()); const first = it.next();
  await stall.entered; expect(pulls).toBe(1);
  stall.open(); expect((await first).value).toEqual({ offset: 0, byteLength: 1 });
  expect((await it.next()).value).toEqual({ offset: 1, byteLength: 1 }); expect(pulls).toBe(2);
  await it.return?.(); await f.close();
});
test('appendChunks keeps the primary error when closing the source also fails', async () => {
  const f = await createMemoryStorage().open('ingest', { create: true }); await f.close();
  const cleanup = new Error('return failed');
  const failing = source(async () => ({ done: false, value: new Uint8Array(1) }), async () => { throw cleanup; });
  const error = await rejection(appendChunks(f, failing).next());
  expect(error.code).toBe('CLOSED'); expect(error.suppressed).toBe(cleanup);
});
test('appendChunks does not close a source whose next() threw, and rejects non-iterables', async () => {
  const f = await createMemoryStorage().open('ingest', { create: true }); let returned = false; const boom = new Error('producer failed');
  const throwing = source(async () => { throw boom; }, async () => { returned = true; return { done: true, value: undefined }; });
  expect(await rejection(appendChunks(f, throwing).next())).toBe(boom); expect(returned).toBe(false);
  await expect(appendChunks(f, [new Uint8Array(1)] as unknown as AsyncIterable<Uint8Array>).next()).rejects.toBeInstanceOf(TypeError);
  expect(await f.size()).toBe(0); await f.close();
});
test('appendChunks with inFlight keeps that many appends outstanding and yields receipts in call order', async () => {
  const stall = stalledBackend(); const f = createStorageFile('window', stall.backend); let pulls = 0;
  async function* chunks() { for (let i = 0; i < 5; i++) { pulls++; yield new Uint8Array([i, i]); } }
  const it = appendChunks(f, chunks(), { inFlight: 3 }); const first = it.next();
  await stall.entered; await Promise.resolve();
  // Three appends issued, no fourth pull while all three are outstanding.
  expect(pulls).toBe(3); expect(reservations(f).operations).toBe(3);
  stall.open(); const receipts = [(await first).value];
  for await (const receipt of { [Symbol.asyncIterator]: () => it }) receipts.push(receipt);
  expect(receipts.map(r => r!.offset)).toEqual([0, 2, 4, 6, 8]); expect(pulls).toBe(5); await f.close();
});
test('appendChunks with inFlight settles every issued append before it finishes, on failure and on break', async () => {
  const storage = createMemoryStorage({ maxWriteBytes: 2 });
  async function* chunks(...values: number[][]) { for (const v of values) yield new Uint8Array(v); }
  const f = await storage.open('failing', { create: true });
  const it = appendChunks(f, chunks([1], [2, 3, 4], [5]), { inFlight: 3 });
  expect((await it.next()).value).toEqual({ offset: 0, byteLength: 1 });
  // The oversized second chunk fails at its turn; the third was issued before and still lands.
  await expect(it.next()).rejects.toBeInstanceOf(RangeError);
  expect(reservations(f).operations).toBe(0); expect([...await f.read(0, 9)]).toEqual([1, 5]);
  const g = await storage.open('broken', { create: true }); let closed = false;
  async function* closing() { try { yield new Uint8Array([1]); yield new Uint8Array([2]); yield new Uint8Array([3]); } finally { closed = true; } }
  for await (const _ of appendChunks(g, closing(), { inFlight: 3 })) break;
  expect(closed).toBe(true); expect(reservations(g).operations).toBe(0); expect(await g.size()).toBe(3);
  for (const inFlight of [0, 1.5]) await expect(appendChunks(g, chunks([1]), { inFlight }).next()).rejects.toBeInstanceOf(RangeError);
  await f.close(); await g.close();
});
