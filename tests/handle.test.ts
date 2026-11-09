// The shared handle (ManagedFile) through createStorageFile with real backends:
// admission accounting, partial and failing I/O, lifecycle, error normalization
// and borrowed buffers. Each failure is injected by the backend itself.
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';
import { createMemoryStorage, createStorageFile, type StorageFileBackend } from '../dist/index.mjs';
import { codedError, faultBackend, rejection, reservations as admission, stalledBackend } from './fixtures.ts';

const noop: Omit<StorageFileBackend, 'size'> = { read: () => 0, write: () => 0, truncate() {}, flush() {}, close() {} };
/** Consumer work slower than the stream read-ahead threshold (5 µs). */
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 1));

describe('admission', () => {
  test('a stalled backend cannot make retained write copies exceed the pending budget', async () => {
    const stall = stalledBackend();
    const f = createStorageFile('stalled', stall.backend, { maxWriteBytes: 1024, maxPendingWriteBytes: 4096, maxPendingOperations: 64 });
    const calls = Array.from({ length: 100 }, () => f.append(new Uint8Array(1024)));
    expect(admission(f)).toEqual({ operations: 4, writeBytes: 4096 });
    // Admission is in call order: the first four fit the byte budget, the rest reject at once.
    const overflow = await Promise.allSettled(calls.slice(4));
    expect(overflow.every(r => r.status === 'rejected' && (r.reason as { code?: string }).code === 'QUEUE_FULL')).toBe(true);
    // Rejected calls never reached the backend; only the first accepted write is in flight.
    await stall.entered; expect(stall.writes).toBe(1); expect(stall.received).toBe(1024);
    stall.open();
    expect((await Promise.all(calls.slice(0, 4))).map(r => r.offset)).toEqual([0, 1024, 2048, 3072]);
    expect(admission(f)).toEqual({ operations: 0, writeBytes: 0 }); await f.close();
  });
  test('a call rejected at admission keeps its transfer buffer attached', async () => {
    const stall = stalledBackend(); const f = createStorageFile('transfer', stall.backend, { maxPendingOperations: 1 });
    const running = f.append(new Uint8Array(4)); const refused = new Uint8Array(4);
    await expect(f.append(refused, { transfer: true })).rejects.toMatchObject({ code: 'QUEUE_FULL' }); expect(refused.buffer.byteLength).toBe(4);
    stall.open(); await running; await f.close();
  });
  test('counters return to zero after success, failure, abort and close', async () => {
    const stall = stalledBackend();
    const f = createStorageFile('accounting', stall.backend, { maxWriteBytes: 8, maxPendingWriteBytes: 16, maxPendingOperations: 8 });
    const signal = { aborted: false };
    const pending = [f.append(new Uint8Array(8)), f.write(0, new Uint8Array(4), { signal }), f.size(), f.read(0, 4)];
    expect(admission(f)).toEqual({ operations: 4, writeBytes: 12 });
    signal.aborted = true; stall.open();
    expect((await Promise.allSettled(pending)).map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
    expect(admission(f)).toEqual({ operations: 0, writeBytes: 0 });
    // A pre-aborted call and a call after close reserve nothing and perform no I/O.
    const writes = stall.writes;
    await expect(f.append(new Uint8Array(8), { signal })).rejects.toMatchObject({ code: 'ABORTED' });
    await f.close(); await expect(f.append(new Uint8Array(8))).rejects.toMatchObject({ code: 'CLOSED' });
    expect(admission(f)).toEqual({ operations: 0, writeBytes: 0 }); expect(stall.writes).toBe(writes);
  });
  test('a failing backend write releases its reservation and keeps the queue usable', async () => {
    let fail = true; let size = 0;
    const f = createStorageFile('failing', {
      ...noop, size: () => size,
      write: (at, input) => { if (fail) throw codedError('nospace', 'ENOSPC'); size = at + input.length; return input.length; },
    }, { maxPendingWriteBytes: 8, maxWriteBytes: 8 });
    await expect(f.append(new Uint8Array(8))).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect(admission(f)).toEqual({ operations: 0, writeBytes: 0 });
    fail = false; expect(await f.append(new Uint8Array(8))).toEqual({ offset: 0, byteLength: 8 }); await f.close();
  });
});

describe('partial and failing backend I/O', () => {
  test('partial reads and writes are completed; zero write progress is rejected', async () => {
    const bytes = new Uint8Array(32); let size = 0, closed = 0, writeCalls = 0, zero = false;
    const f = createStorageFile('partial', {
      size: () => size,
      read: (at, out) => { const n = Math.min(2, out.length, Math.max(0, size - at)); out.set(bytes.subarray(at, at + n)); return n; },
      write: (at, input) => { if (zero) return 0; writeCalls++; const n = Math.min(3, input.length); bytes.set(input.subarray(0, n), at); size = Math.max(size, at + n); return n; },
      truncate: n => { size = n; }, flush() {}, close() { closed++; },
    });
    await f.append(new Uint8Array([1, 2, 3, 4, 5, 6, 7])); expect(writeCalls).toBe(3);
    expect([...await f.readExactly(0, 7)]).toEqual([1, 2, 3, 4, 5, 6, 7]); zero = true;
    await expect(f.append(new Uint8Array([8]))).rejects.toMatchObject({ code: 'IO_ERROR' }); zero = false;
    await f.append(new Uint8Array([9])); await f.close(); await f.close(); expect(closed).toBe(1);
  });
  test('invalid backend read and write counts reject IO_ERROR and leave the queue usable', async () => {
    for (const bad of [-1, 1.5, NaN, 99]) {
      const fault = faultBackend(); const f = createStorageFile('counts', fault.backend);
      await f.append(new Uint8Array([1, 2, 3]));
      const { read, write } = fault.backend;
      fault.backend.read = () => bad; await expect(f.read(0, 3)).rejects.toMatchObject({ code: 'IO_ERROR' }); fault.backend.read = read;
      fault.backend.write = () => bad; await expect(f.append(new Uint8Array(2))).rejects.toMatchObject({ code: 'IO_ERROR' }); fault.backend.write = write;
      expect([...await f.read(0, 9)]).toEqual([1, 2, 3]); await f.close();
    }
  });
  test('one read completes across alternating synchronous and asynchronous backend calls', async () => {
    const fault = faultBackend(); fault.size = 16;
    const expected = Array.from({ length: 16 }, (_, i) => i + 1); fault.bytes.set(expected);
    const reads: { at: number; length: number }[] = []; let calls = 0;
    fault.backend.read = (at, out) => {
      reads.push({ at, length: out.length });
      const count = Math.min(3, out.length); out.set(fault.bytes.subarray(at, at + count));
      return ++calls % 2 ? Promise.resolve(count) : count;
    };
    const f = createStorageFile('mixed-reads', fault.backend);
    const target = new Uint8Array(16);
    expect(await f.readInto(0, target)).toBe(16); expect([...target]).toEqual(expected);
    expect([...await f.readExactly(0, 16)]).toEqual(expected);
    expect(reads).toEqual([
      { at: 0, length: 16 }, { at: 3, length: 13 }, { at: 6, length: 10 },
      { at: 9, length: 7 }, { at: 12, length: 4 }, { at: 15, length: 1 },
      { at: 0, length: 16 }, { at: 3, length: 13 }, { at: 6, length: 10 },
      { at: 9, length: 7 }, { at: 12, length: 4 }, { at: 15, length: 1 },
    ]);
    await f.close();
  });
  test('reads reject an invalid backend size instead of reporting EOF', async () => {
    for (const size of [-1, 1.5, NaN]) {
      const f = createStorageFile('broken-size', { ...noop, size: () => size });
      await expect(f.read(0, 4)).rejects.toMatchObject({ code: 'IO_ERROR' }); await f.close();
    }
  });
  test('quota, permission and generic write failures map to codes and do not claim rollback', async () => {
    for (const [code, expected] of [['ENOSPC', 'QUOTA_EXCEEDED'], ['EACCES', 'PERMISSION_DENIED'], [undefined, 'IO_ERROR']] as const) {
      const fault = faultBackend(); const f = createStorageFile('faults', fault.backend); let calls = 0;
      const { write } = fault.backend;
      // The first call persists 2 bytes, the second fails: a partial mutation stays visible.
      fault.backend.write = (at, input) => { if (calls++) throw codedError('fault', code); return write.call(fault.backend, at, input.subarray(0, 2)); };
      await expect(f.append(new Uint8Array([7, 8, 9, 10]))).rejects.toMatchObject({ code: expected });
      expect(await f.size()).toBe(2); expect([...await f.read(0, 9)]).toEqual([7, 8]);
      fault.backend.write = write; expect(await f.append(new Uint8Array([1]))).toEqual({ offset: 2, byteLength: 1 }); await f.close();
    }
  });
  test('cancelling between partial writes reports ABORTED without claiming rollback', async () => {
    const signal = { aborted: false }; let size = 0;
    const f = createStorageFile('partial', { ...noop, size: () => size, write: () => { size++; signal.aborted = true; return 1; } });
    await expect(f.append(new Uint8Array([1, 2, 3]), { signal })).rejects.toMatchObject({ code: 'ABORTED' });
    expect(await f.size()).toBe(1); await f.close();
  });
  test('flush failures reject explicitly and leave earlier bytes and the queue intact', async () => {
    const fault = faultBackend(); const f = createStorageFile('flush', fault.backend);
    await f.append(new Uint8Array([1, 2])); fault.backend.flush = () => { throw codedError('eio', 'EIO'); };
    await expect(f.flush()).rejects.toMatchObject({ code: 'IO_ERROR' }); expect([...await f.read(0, 9)]).toEqual([1, 2]);
    fault.backend.flush = () => {}; await f.flush(); await f.close();
  });
  test('stream reads one chunk ahead of a slow consumer and never the entire source', async () => {
    let reads = 0, maximum = 0;
    const f = createStorageFile('huge', {
      ...noop, size: () => 8 * 1024 ** 3,
      read: (_at, out) => { reads++; maximum = Math.max(maximum, out.length); out.fill(7); return out.length; },
      write() { throw new Error('unused'); },
    });
    const stream = f.stream({ chunkSize: 4096 }); expect(reads).toBe(0);
    // The first pull has no consumer time to go by, so nothing is read ahead yet.
    await stream.next(); await f.size(); expect(reads).toBe(1);
    for (let pulled = 2; pulled <= 4; pulled++) {
      await pause(); expect((await stream.next()).value!.length).toBe(4096);
      // size() is queued behind the read-ahead, so it has run by now: exactly one chunk ahead.
      await f.size(); expect(reads).toBe(pulled + 1);
    }
    await stream.return!(undefined); await f.size(); expect(reads).toBe(5); expect(maximum).toBe(4096); await f.close();
  });
  test('a read-ahead keeps pull-time outcomes: its error waits for its pull, close wins, and an abandoned one is handled', async () => {
    let reads = 0, failAt = 2;
    const f = createStorageFile('ahead', { ...noop, size: () => 4, read: (at, out) => { reads++; if (at === failAt) throw codedError('eio', 'EIO'); out.fill(1); return out.length; } });
    /** Pulls two chunks slowly, so the read of chunk 2 is queued ahead and has run. */
    const twoSlow = async (stream: AsyncIterableIterator<Uint8Array>) => { await stream.next(); await pause(); await stream.next(); await f.size(); };
    const failing = f.stream({ chunkSize: 1 }); await twoSlow(failing); expect(reads).toBe(3);
    await expect(failing.next()).rejects.toMatchObject({ code: 'IO_ERROR' });
    // The read-ahead of chunk 2 fails again here, but nobody pulls it; an unhandled rejection would fail the run.
    const abandoned = f.stream({ chunkSize: 1 }); await twoSlow(abandoned); await abandoned.return!(undefined);
    failAt = -1; const paused = f.stream({ chunkSize: 1 }); await twoSlow(paused);
    const closing = f.close(); await expect(paused.next()).rejects.toMatchObject({ code: 'CLOSED' }); await closing;
  });
});

describe('lifecycle', () => {
  test('a failing backend close rejects with a normalized error and stays idempotent', async () => {
    let calls = 0;
    const f = createStorageFile('close-fails', { ...noop, size: () => 0, close() { calls++; throw codedError('eio', 'EIO'); } });
    const first = f.close(); expect(f.close()).toBe(first);
    await expect(first).rejects.toMatchObject({ code: 'IO_ERROR' }); await expect(f.size()).rejects.toMatchObject({ code: 'CLOSED' }); expect(calls).toBe(1);
  });
  test('close under saturation waits for in-flight work and closes the backend once', async () => {
    const stall = stalledBackend(); let closes = 0; stall.backend.close = () => { closes++; };
    const f = createStorageFile('closing', stall.backend, { maxPendingOperations: 2 });
    const accepted = [f.append(new Uint8Array([1])), f.append(new Uint8Array([2]))];
    await expect(f.append(new Uint8Array([3]))).rejects.toMatchObject({ code: 'QUEUE_FULL' });
    const closing = f.close(); expect(f.close()).toBe(closing); await expect(f.read(0, 1)).rejects.toMatchObject({ code: 'CLOSED' });
    await stall.entered; expect(closes).toBe(0);
    stall.open(); await Promise.all(accepted); await closing; expect(closes).toBe(1); expect(stall.size).toBe(2);
  });
});

describe('errors', () => {
  test('legacy numeric DOMException codes normalize through their names', async () => {
    const f = createStorageFile('dom-errors', {
      ...noop, size() { throw new DOMException('missing', 'NotFoundError'); }, write() { throw new DOMException('full', 'QuotaExceededError'); },
    });
    await expect(f.size()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.write(0, new Uint8Array([1]))).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    await f.close();
    // OPFS rejects getFileHandle on a directory with TypeMismatchError; the native adapter reports UNSUPPORTED.
    const g = createStorageFile('dom-dir', { ...noop, size() { throw new DOMException('dir', 'TypeMismatchError'); } });
    await expect(g.size()).rejects.toMatchObject({ code: 'UNSUPPORTED' }); await g.close();
  });
  test('known StorageError codes survive the ESM/CommonJS boundary; unknown codes stay IO_ERROR', async () => {
    const cjs = createRequire(import.meta.url)('../dist/index.cjs') as typeof import('../dist/index.mjs');
    for (const [thrown, expected] of [
      [new cjs.StorageError('BUSY', 'cjs busy'), 'BUSY'],
      [new cjs.StorageError('QUEUE_FULL', 'cjs full'), 'QUEUE_FULL'],
      [Object.assign(new Error('foreign'), { name: 'StorageError', code: 'NOT_A_CODE' }), 'IO_ERROR'],
      [codedError('lookalike', 'BUSY'), 'IO_ERROR'],
    ] as const) {
      const fault = faultBackend(); fault.backend.size = () => { throw thrown; };
      const f = createStorageFile('codes', fault.backend);
      const error = await rejection(f.size()); expect(error.code).toBe(expected); expect(error.cause).toBe(thrown); await f.close();
    }
  });
});

describe('inputs and buffers', () => {
  test('detached and shared byte inputs fail before any mutation', async () => {
    const f = await createMemoryStorage().open('data', { create: true });
    const a = new Uint8Array(4); structuredClone(a, { transfer: [a.buffer] });
    await expect(f.append(a)).rejects.toBeInstanceOf(TypeError);
    await expect(f.append(new Uint8Array(new SharedArrayBuffer(4)))).rejects.toBeInstanceOf(TypeError);
    expect(await f.size()).toBe(0); await f.close();
  });
  test('readInto rejects a borrowed target that was detached or resized before or during I/O', async () => {
    const resizable = (target: Uint8Array) => target.buffer as ArrayBuffer;
    const mutations: ((target: Uint8Array) => void)[] = [
      target => { structuredClone(target.buffer, { transfer: [resizable(target)] }); },
      target => resizable(target).resize(16),
      target => resizable(target).resize(2),
    ];
    for (const mutate of mutations) {
      const stall = stalledBackend(); stall.size = 8; stall.backend.read = (_at, out) => { out.fill(5); return Math.min(2, out.length); };
      const f = createStorageFile('borrowed', stall.backend); const blocker = f.append(new Uint8Array(1)); await stall.entered;
      const target = new Uint8Array(new ArrayBuffer(4, { maxByteLength: 16 }));
      const pending = f.readInto(0, target); mutate(target); stall.open(); await blocker;
      await expect(pending).rejects.toMatchObject({ code: 'IO_ERROR' }); await f.close();
    }
    // Resized between two partial backend reads.
    const fault = faultBackend(); fault.size = 8; const target = new Uint8Array(new ArrayBuffer(4, { maxByteLength: 16 }));
    fault.backend.read = (_at, out) => { out.fill(5, 0, 2); resizable(target).resize(16); return 2; };
    const f = createStorageFile('borrowed', fault.backend);
    await expect(f.readInto(0, target)).rejects.toMatchObject({ code: 'IO_ERROR' }); await f.close();
  });
  test('memory capacity failure preserves existing bytes and the queue remains usable', async () => {
    const f = await createMemoryStorage({ maxFileBytes: 4 }).open('data', { create: true });
    try {
      await f.append(new Uint8Array([1, 2]));
      await expect(f.append(new Uint8Array(3))).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
      expect([...await f.read(0, 4)]).toEqual([1, 2]); await f.append(new Uint8Array([3])); expect(await f.size()).toBe(3);
    } finally { await f.close(); }
  });
});

describe('append batching', () => {
  /** A fault backend with a vectored write; every backend write call is recorded. */
  const vectored = () => {
    const fault = faultBackend(); const calls: string[] = []; const { write } = fault.backend;
    fault.backend.write = (at, input) => { calls.push(`write ${at}+${input.length}`); return write.call(fault.backend, at, input); };
    fault.backend.writev = (at, chunks) => {
      calls.push(`writev ${at}x${chunks.length}`); let n = 0;
      for (const chunk of chunks) n += write.call(fault.backend, at + n, chunk) as number;
      return n;
    };
    return { fault, calls, write };
  };
  const bytes = (...values: number[]) => new Uint8Array(values);
  test('a lone append writes at once; appends arriving while it runs share one vectored write', async () => {
    const { fault, calls } = vectored(); const { write } = fault.backend;
    let open!: () => void, entered!: () => void; const gate = new Promise<void>(r => { open = r; }); const running = new Promise<void>(r => { entered = r; });
    fault.backend.write = async (at, input) => { const n = write(at, input); entered(); await gate; return n; };
    const f = createStorageFile('batched', fault.backend);
    const first = f.append(bytes(1)); await running;
    const later = [2, 3, 4].map(v => f.append(bytes(v, v))); expect(calls).toEqual(['write 0+1']);
    open();
    expect((await Promise.all([first, ...later])).map(r => r.offset)).toEqual([0, 1, 3, 5]);
    expect(calls).toEqual(['write 0+1', 'writev 1x3']); expect([...fault.bytes.subarray(0, 7)]).toEqual([1, 2, 2, 3, 3, 4, 4]);
    expect(admission(f)).toEqual({ operations: 0, writeBytes: 0 }); await f.close();
  });
  test('any other operation between appends ends the batch, so call order holds', async () => {
    const { fault, calls } = vectored(); const f = createStorageFile('split', fault.backend);
    const results = await Promise.all([f.append(bytes(1, 1)), f.append(bytes(2)), f.write(0, bytes(9)), f.append(bytes(3)), f.append(bytes(4))]);
    expect(results.map(r => r?.offset)).toEqual([0, 2, undefined, 3, 4]);
    expect(calls).toEqual(['writev 0x2', 'write 0+1', 'writev 3x2']); expect([...fault.bytes.subarray(0, 5)]).toEqual([9, 1, 2, 3, 4]); await f.close();
  });
  test('a short vectored write is completed; a failing one rejects exactly the appends it carried', async () => {
    const { fault, calls, write } = vectored(); const f = createStorageFile('partial-batch', fault.backend);
    // One byte per call: the batch is finished by further calls over the remaining chunks.
    fault.backend.writev = (at, chunks) => { calls.push(`writev ${at}x${chunks.length}`); return write.call(fault.backend, at, chunks.find(c => c.length)!.subarray(0, 1)) as number; };
    expect((await Promise.all([f.append(bytes(1, 2)), f.append(bytes()), f.append(bytes(3))])).map(r => r.offset)).toEqual([0, 2, 2]);
    expect(calls).toEqual(['writev 0x3', 'writev 1x3', 'write 2+1']); expect([...fault.bytes.subarray(0, 3)]).toEqual([1, 2, 3]);
    fault.backend.writev = () => { throw codedError('eio', 'EIO'); };
    const settled = await Promise.allSettled([f.append(bytes(4)), f.append(bytes(5)), f.size(), f.append(bytes(6))]);
    expect(settled.map(r => r.status === 'fulfilled' ? r.value : (r.reason as { code: string }).code)).toEqual(['IO_ERROR', 'IO_ERROR', 3, { offset: 3, byteLength: 1 }]);
    expect(admission(f)).toEqual({ operations: 0, writeBytes: 0 }); await f.close();
  });
  test('cancellation removes an append from its batch, and stops the batch between partial writes', async () => {
    const { fault, calls, write } = vectored(); const f = createStorageFile('abort-batch', fault.backend);
    // Fired after the call (so the call-time check passes) but before the batch starts.
    const before = { aborted: false };
    const queued = [f.append(bytes(1)), f.append(bytes(2), { signal: before }), f.append(bytes(3))]; before.aborted = true;
    const settled = await Promise.allSettled(queued);
    expect(settled.map(r => r.status === 'fulfilled' ? r.value.offset : (r.reason as { code: string }).code)).toEqual([0, 'ABORTED', 1]);
    expect(calls).toEqual(['writev 0x2']);
    // The first append is cancelled after one of its bytes landed; the next append is written by a later call.
    const during = { aborted: false };
    fault.backend.writev = (at, chunks) => { calls.push(`writev ${at}x${chunks.length}`); during.aborted = true; return write.call(fault.backend, at, chunks[0]!.subarray(0, 1)) as number; };
    const next = await Promise.allSettled([f.append(bytes(4, 4), { signal: during }), f.append(bytes(5))]);
    expect(next.map(r => r.status === 'fulfilled' ? r.value.offset : (r.reason as { code: string }).code)).toEqual(['ABORTED', 3]);
    expect([...fault.bytes.subarray(0, 4)]).toEqual([1, 3, 4, 5]); expect(await f.size()).toBe(4); await f.close();
  });
});

describe('write buffer', () => {
  test('appends fill one backend write per buffer, and an idle handle resolves them without queuing', async () => {
    const fault = faultBackend(); const calls: number[] = []; const { write } = fault.backend;
    fault.backend.write = (at, input) => { calls.push(input.length); return write.call(fault.backend, at, input); };
    const f = createStorageFile('buffered', fault.backend, { writeBuffer: 16 }); await f.size();
    let queued = 0;
    for (let i = 0; i < 40; i++) { const p = f.append(new Uint8Array([i])); queued += admission(f).operations; expect((await p).offset).toBe(i); }
    // Only the appends that found the buffer full (17th, 33rd) waited for its write.
    expect(queued).toBe(2); expect(calls).toEqual([16, 16]);
    await f.flush(); expect(calls).toEqual([16, 16, 8]); expect([...fault.bytes.subarray(0, 40)]).toEqual(Array.from({ length: 40 }, (_, i) => i));
    await f.close(); expect(() => createStorageFile('bad', fault.backend, { writeBuffer: 1.5 })).toThrow(RangeError);
  });
  test('a cancelled queued append keeps earlier buffered bytes at their offsets', async () => {
    const fault = faultBackend(); const f = createStorageFile('cancelled', fault.backend, { writeBuffer: 8 }); await f.size();
    expect(await f.append(new Uint8Array([1]))).toEqual({ offset: 0, byteLength: 1 });
    // Queued behind size(), then cancelled before its turn: the handle forgets its size, the buffered byte stays.
    const signal = { aborted: false }; const sized = f.size(); const cancelled = f.append(new Uint8Array([2]), { signal }); signal.aborted = true;
    expect(await sized).toBe(1); await expect(cancelled).rejects.toMatchObject({ code: 'ABORTED' });
    await f.flush(); expect(await f.append(new Uint8Array([3]))).toEqual({ offset: 1, byteLength: 1 });
    expect([...await f.read(0, 9)]).toEqual([1, 3]); await f.close();
  });
  test('a failed buffer write discards the buffered appends and rejects the operation that needed it, close included', async () => {
    const fault = faultBackend(); const { write } = fault.backend; const f = createStorageFile('lost', fault.backend, { writeBuffer: 8 });
    await f.append(new Uint8Array([1])); await f.flush(); await f.append(new Uint8Array([2, 3]));
    fault.backend.write = () => { throw codedError('disk full', 'ENOSPC'); };
    const error = await rejection(f.read(0, 9)) as { code?: string; message?: string };
    expect(error.code).toBe('QUOTA_EXCEEDED'); expect(error.message).toMatch(/buffered appends/);
    fault.backend.write = write; expect(await f.size()).toBe(1); expect([...await f.read(0, 9)]).toEqual([1]);
    await f.append(new Uint8Array([4])); fault.backend.write = () => { throw codedError('eio', 'EIO'); };
    // The backend still closes (ownership released); close reports the lost bytes.
    await expect(f.close()).rejects.toMatchObject({ code: 'IO_ERROR' }); expect(fault.closes).toBe(1);
  });
});

describe('size tracking', () => {
  /** A fault backend that counts size() queries. */
  const counted = () => { const fault = faultBackend(); let queries = 0; const { size } = fault.backend; fault.backend.size = () => { queries++; return size.call(fault.backend); }; return { fault, queries: () => queries }; };
  test('the handle queries the backend size once and tracks it through its own mutations', async () => {
    const { fault, queries } = counted(); const f = createStorageFile('tracked', fault.backend);
    await f.append(new Uint8Array([1, 2])); await f.append(new Uint8Array([3])); await f.write(5, new Uint8Array([9])); await f.write(9, new Uint8Array());
    expect(await f.size()).toBe(6); expect([...await f.read(0, 99)]).toEqual([1, 2, 3, 0, 0, 9]);
    await f.truncate(2); expect(await f.size()).toBe(2); expect(await f.append(new Uint8Array([4]))).toEqual({ offset: 2, byteLength: 1 });
    expect(queries()).toBe(1); await f.close();
  });
  test('a failed mutation or a short read makes the handle query the backend again', async () => {
    const { fault, queries } = counted(); const f = createStorageFile('retracked', fault.backend);
    await f.append(new Uint8Array([1, 2, 3])); const { write } = fault.backend; let calls = 0;
    // A partial write followed by a failure leaves the size uncertain.
    fault.backend.write = (at, input) => { if (calls++) throw codedError('fault', 'EIO'); return write.call(fault.backend, at, input.subarray(0, 1)); };
    await expect(f.append(new Uint8Array([7, 8]))).rejects.toMatchObject({ code: 'IO_ERROR' });
    expect(await f.size()).toBe(4); expect(queries()).toBe(2); fault.backend.write = write;
    // A file shrunk outside the handle shows up as a short read; the next size is queried, not assumed.
    fault.size = 1; expect([...await f.read(0, 9)]).toEqual([1]); expect(await f.size()).toBe(1); expect(queries()).toBe(3);
    await f.close();
  });
});
