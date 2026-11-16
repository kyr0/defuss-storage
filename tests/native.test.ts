// Native-adapter behavior that needs a real file system or real processes:
// realm-wide ownership across module builds, foreign entries, close-failure
// quarantine, and persistence across process boundaries.
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, fstatSync, readdirSync, statSync } from 'node:fs';
import { mkdir, stat, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createFileStorage } from '../dist/node.mjs';
import { admission, withTempDir } from './fixtures.ts';

const nodeEntry = JSON.stringify(new URL('../dist/node.mjs', import.meta.url).href);
/** Runs `script` as an ES module in a new process of the current runtime (Node.js or Bun). */
const runModule = (script: string): string => execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });

describe('ownership and foreign entries', () => {
  test('ownership spans adapter instances and the ESM/CommonJS builds', () => withTempDir('owners', async dir => {
    const other = createRequire(import.meta.url)('../dist/node.cjs') as typeof import('../dist/node.mjs');
    const a = await createFileStorage(dir); const b = await other.createFileStorage(dir); const f = await a.open('data', { create: true });
    try {
      await expect(b.open('data')).rejects.toMatchObject({ code: 'BUSY' }); await expect(b.remove('data')).rejects.toMatchObject({ code: 'BUSY' });
    } finally { await f.close(); }
    const g = await b.open('data'); await g.close();
  }));
  test('symlinks are refused without modifying their targets', () => withTempDir('links', async dir => {
    const target = path.join(dir, 'target'); await writeFile(target, 'safe'); await symlink(target, path.join(dir, 'link'));
    const s = await createFileStorage(dir); await expect(s.open('link')).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(s.remove('link')).rejects.toMatchObject({ code: 'UNSUPPORTED' }); expect(await s.list()).toEqual(['target']);
  }));
  test('directories under valid names are refused and unlisted, like OPFS', () => withTempDir('dirs', async dir => {
    await mkdir(path.join(dir, 'sub.bin')); const s = await createFileStorage(dir);
    await expect(s.open('sub.bin')).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(s.open('sub.bin', { create: true })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(s.remove('sub.bin')).rejects.toMatchObject({ code: 'UNSUPPORTED' }); expect(await s.list()).toEqual([]);
  }));
  test('a root that is a regular file is UNSUPPORTED whether or not create is set', () => withTempDir('root', async dir => {
    const file = path.join(dir, 'plain'); await writeFile(file, 'x');
    for (const create of [true, false]) await expect(createFileStorage(file, { create })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  }));
});

describe('close failure', () => {
  test.skipIf(process.platform === 'win32')('a failed close quarantines ownership for this realm; a new process can open the file', () => withTempDir('quarantine', async dir => {
    const storage = await createFileStorage(dir); const f = await storage.open('data', { create: true });
    await f.append(new Uint8Array([1, 2, 3])); await f.flush();
    // Close the descriptor underneath the FileHandle, so FileHandle.close() really fails (EBADF).
    const info = await stat(path.join(dir, 'data'));
    const fd = readdirSync('/dev/fd').map(Number).find(n => { try { const s = fstatSync(n); return n > 2 && s.ino === info.ino && s.dev === info.dev; } catch { return false; } });
    closeSync(fd!);
    await expect(f.close()).rejects.toMatchObject({ code: 'IO_ERROR' });
    // The first owner's state is uncertain: no second owner in this realm, through any adapter instance.
    await expect(storage.open('data')).rejects.toMatchObject({ code: 'BUSY' }); await expect(storage.remove('data')).rejects.toMatchObject({ code: 'BUSY' });
    await expect((await createFileStorage(dir)).open('data')).rejects.toMatchObject({ code: 'BUSY' });
    const other = await storage.open('other', { create: true }); await other.close();
    // Recovery means ending the owner context: a fresh process sees the flushed bytes.
    expect(runModule(`const { createFileStorage } = await import(${nodeEntry});
      const f = await (await createFileStorage(${JSON.stringify(dir)})).open('data'); process.stdout.write(JSON.stringify([...await f.read(0, 9)])); await f.close();`)).toBe('[1,2,3]');
  }));
});

describe('process boundaries', () => {
  test('flushed bytes written by one process are read by a new process', () => withTempDir('process', async dir => {
    runModule(`const { createFileStorage } = await import(${nodeEntry});
      const f = await (await createFileStorage(${JSON.stringify(dir)})).open('data', { create: true, exclusive: true });
      await f.append(new Uint8Array([1, 2, 3])); await f.flush(); await f.close();`);
    const f = await (await createFileStorage(dir)).open('data'); expect([...await f.read(0, 9)]).toEqual([1, 2, 3]); await f.close();
  }));
  test('a killed owner process leaves no ownership behind and its written bytes stay readable', () => withTempDir('kill', async dir => {
    // The child flushes, reports, then keeps its handle open until it is killed.
    const child = spawn(process.execPath, ['--input-type=module', '-e', `const { createFileStorage } = await import(${nodeEntry});
      const f = await (await createFileStorage(${JSON.stringify(dir)})).open('data', { create: true });
      await f.append(new Uint8Array([7, 8])); await f.flush(); await f.append(new Uint8Array([9]));
      process.stdout.write('ready'); setInterval(() => {}, 1000);`], { stdio: ['ignore', 'pipe', 'inherit'] });
    const [chunk] = await once(child.stdout, 'data') as [Buffer]; expect(String(chunk)).toBe('ready');
    child.kill('SIGKILL'); await once(child, 'exit');
    // Ownership is realm-scoped, so nothing survives the process; the flushed prefix is on disk.
    // The unflushed append reached the OS page cache before the kill, so it is visible too;
    // a process kill is not a power loss and proves nothing about durability.
    const f = await (await createFileStorage(dir)).open('data'); expect([...await f.read(0, 9)]).toEqual([7, 8, 9]); await f.close();
  }));
});

describe('synchronous I/O', () => {
  test('io must be "async" or "sync"; a sync read-only handle runs its reads one by one', () => withTempDir('sync-io', async dir => {
    await expect(createFileStorage(dir, { io: 'fast' as 'sync' })).rejects.toBeInstanceOf(TypeError);
    const s = await createFileStorage(dir, { io: 'sync' }); const w = await s.open('data', { create: true });
    await w.append(new Uint8Array(8192).fill(3)); await w.close();
    const f = await s.open('data', { readOnly: true }); const reads = [f.read(0, 4096), f.read(4096, 4096)];
    // Overlap would gain nothing: each read is a blocking call on this thread.
    expect(admission(f).readBytes).toBe(0); expect((await Promise.all(reads)).map(r => r[0])).toEqual([3, 3]); await f.close();
  }));
});

describe('read-only handles', () => {
  /** A 64 KiB file of known bytes, reopened read-only with the given read bound. */
  const readOnly = async (dir: string, maxReadBytes?: number) => {
    const bytes = Uint8Array.from({ length: 65536 }, (_, i) => i % 251);
    const w = await (await createFileStorage(dir)).open('data', { create: true }); await w.append(bytes); await w.close();
    return { bytes, f: await (await createFileStorage(dir, maxReadBytes ? { maxReadBytes } : {})).open('data', { readOnly: true }) };
  };
  test('reads overlap and return the right bytes; the handle drains them on close', () => withTempDir('overlap', async dir => {
    const { bytes, f } = await readOnly(dir);
    const reads = Array.from({ length: 8 }, (_, i) => f.read(i * 4096, 4096));
    // All eight started at once: their bytes are in flight together.
    expect(admission(f)).toEqual({ operations: 8, writeBytes: 0, readBytes: 32768 });
    const closing = f.close(); await expect(f.size()).rejects.toMatchObject({ code: 'CLOSED' });
    expect((await Promise.all(reads)).map(r => r[0])).toEqual(Array.from({ length: 8 }, (_, i) => bytes[i * 4096]));
    await closing; expect(admission(f)).toEqual({ operations: 0, writeBytes: 0, readBytes: 0 });
  }));
  test('overlapping reads stay within maxReadBytes together and start in call order', () => withTempDir('overlap-bound', async dir => {
    const { bytes, f } = await readOnly(dir, 8192);
    const [a, b, c] = [f.read(0, 4096), f.read(4096, 8192), f.readInto(12288, new Uint8Array(4096))];
    // b does not fit beside a; c would fit but waits behind b, so a large read is never starved.
    expect(admission(f).readBytes).toBe(4096);
    expect([...(await a).subarray(0, 2)]).toEqual([...bytes.subarray(0, 2)]);
    expect((await b).length).toBe(8192); expect(await c).toBe(4096);
    expect(admission(f)).toEqual({ operations: 0, writeBytes: 0, readBytes: 0 }); await f.close();
  }));
  test('a failing overlapping read releases its budget', () => withTempDir('overlap-fail', async dir => {
    const { f } = await readOnly(dir);
    const target = new Uint8Array(new ArrayBuffer(4096, { maxByteLength: 8192 }));
    const failing = f.readInto(0, target); (target.buffer as ArrayBuffer).resize(8192);
    await expect(failing).rejects.toMatchObject({ code: 'IO_ERROR' }); expect(admission(f).readBytes).toBe(0);
    expect((await f.read(0, 4)).length).toBe(4); await f.close();
  }));
});

describe('writable handles', () => {
  test('reads overlap between mutations; a mutation waits for the reads before it and holds back those after it', () => withTempDir('overlap-rw', async dir => {
    const s = await createFileStorage(dir); const f = await s.open('data', { create: true });
    await f.append(new Uint8Array(8192).fill(1));
    const before = [f.read(0, 4096), f.read(4096, 4096)];
    const write = f.write(0, new Uint8Array(8192).fill(2)); const after = [f.read(0, 4096), f.readExactly(4096, 4096)];
    // Only the two reads before the write are running.
    expect(admission(f)).toEqual({ operations: 5, writeBytes: 8192, readBytes: 8192 });
    expect((await Promise.all(before)).map(r => [r[0], r[4095]])).toEqual([[1, 1], [1, 1]]); await write;
    expect((await Promise.all(after)).map(r => [r[0], r[4095]])).toEqual([[2, 2], [2, 2]]);
    expect(admission(f)).toEqual({ operations: 0, writeBytes: 0, readBytes: 0 });
    // Close drains reads and mutations alike.
    const last = [f.read(0, 1), f.append(new Uint8Array([3])), f.read(8192, 1)]; const closing = f.close();
    expect((await Promise.all(last)).map(r => r instanceof Uint8Array ? r[0] : r.offset)).toEqual([2, 8192, 3]); await closing;
    // A write buffer is drained by the read that needs it, so those handles keep reading one by one.
    const b = await s.open('buffered', { create: true, writeBuffer: 64 }); await b.append(new Uint8Array(16));
    const reads = [b.read(0, 8), b.read(8, 8)]; expect(admission(b).readBytes).toBe(0); await Promise.all(reads); await b.close();
  }));
});

describe('synchronous I/O at call time', () => {
  /** A file with synchronous I/O and its size on disk, which shows what has been written when a call returns. */
  const opened = async (dir: string, options = {}) => {
    const f = await (await createFileStorage(dir, { io: 'sync', ...options })).open('data', { create: true });
    return { f, onDisk: () => statSync(path.join(dir, 'data')).size };
  };
  const small = (value: number) => new Uint8Array(100).fill(value);
  test('an idle handle writes before the call returns and stays reserved until the event loop turns', () => withTempDir('sync-direct', async dir => {
    const { f, onDisk } = await opened(dir, { maxPendingOperations: 2 });
    const first = f.append(small(1)); expect(onDisk()).toBe(100);
    // A burst is admitted as if the first call were still pending: the second queues, the third is refused.
    expect(admission(f)).toMatchObject({ operations: 1, writeBytes: 100 });
    const second = f.write(0, small(2)); expect(admission(f)).toMatchObject({ operations: 2, writeBytes: 200 });
    await expect(f.append(small(3))).rejects.toMatchObject({ code: 'QUEUE_FULL' }); expect(onDisk()).toBe(100);
    expect(await first).toEqual({ offset: 0, byteLength: 100 }); await second;
    expect(admission(f)).toMatchObject({ operations: 0, writeBytes: 0 });
    // A write at an offset takes the same path, and so does a handed-over buffer, which is detached all the same.
    const write = f.write(100, small(4)); expect(onDisk()).toBe(200); await write;
    const whole = new Uint8Array(65536).fill(5);
    const transferred = f.append(whole, { transfer: true }); expect(whole.buffer.byteLength).toBe(0); expect(onDisk()).toBe(65736);
    expect(await transferred).toEqual({ offset: 200, byteLength: 65536 });
    expect([...await f.read(0, 1), ...await f.read(100, 1), ...await f.read(65735, 1)]).toEqual([2, 4, 5]); await f.close();
  }));
  test('small appends that come in bursts queue as a whole to share one write; an append that ran alone ends that', () => withTempDir('sync-burst', async dir => {
    const { f, onDisk } = await opened(dir);
    // The first burst: its first append is written at call time, the others queue.
    const first = [f.append(small(1)), f.append(small(2)), f.append(small(3))]; expect(onDisk()).toBe(100); await Promise.all(first);
    // The handle has seen a burst, so the next one queues from its first append on.
    const second = [f.append(small(4)), f.append(small(5))]; expect(onDisk()).toBe(300);
    expect((await Promise.all([...first, ...second])).map(r => r.offset)).toEqual([0, 100, 200, 300, 400]);
    // That append queued and ran alone; the one after it is written at call time again.
    await f.append(small(6)); const alone = f.append(small(7)); expect(onDisk()).toBe(700); await alone;
    // Inputs of 64 KiB and more gain nothing from sharing a write: the first of a burst never queues.
    const large = [f.append(new Uint8Array(65536).fill(8)), f.append(new Uint8Array(65536).fill(9))]; expect(onDisk()).toBe(66236);
    expect((await Promise.all(large)).map(r => r.offset)).toEqual([700, 66236]);
    expect((await Promise.all([0, 100, 200, 300, 400, 500, 600, 700, 66236].map(at => f.read(at, 1)))).map(r => r[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(await f.size()).toBe(131772); await f.close();
  }));
});
