// Native-adapter behavior that needs a real file system or real processes:
// realm-wide ownership across module builds, foreign entries, close-failure
// quarantine, and persistence across process boundaries.
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, fstatSync, readdirSync } from 'node:fs';
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
  test('a failing overlapping read releases its budget; read-write handles never overlap', () => withTempDir('overlap-fail', async dir => {
    const { f } = await readOnly(dir);
    const target = new Uint8Array(new ArrayBuffer(4096, { maxByteLength: 8192 }));
    const failing = f.readInto(0, target); (target.buffer as ArrayBuffer).resize(8192);
    await expect(failing).rejects.toMatchObject({ code: 'IO_ERROR' }); expect(admission(f).readBytes).toBe(0);
    expect((await f.read(0, 4)).length).toBe(4); await f.close();
    const rw = await (await createFileStorage(dir)).open('data');
    const reads = [rw.read(0, 4096), rw.read(4096, 4096)]; expect(admission(rw).readBytes).toBe(0);
    await Promise.all(reads); await rw.close();
  }));
});
