// Packed-consumer check: `bun pm pack`s the package, `bun add`s the tarball in a fresh
// directory and imports every entry point from ESM and CommonJS, then typechecks
// the declarations with no DOM or Node ambient types. This catches `exports` and
// `files` mistakes that tests importing dist/ directly cannot see. It also walks the
// root entry point's module graph in both formats and fails on any native import.
// A worker-thread consumer runs the native adapter with `io: "sync"` where it is
// meant to run, off the main thread (see writeWorkerConsumer).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const cwd = await mkdtemp(path.join(tmpdir(), 'defuss-storage-consumer-'));
// The project's package manager (packageManager in package.json); bun is a native
// executable on every platform, so no shell is needed to spawn it.
const bun = 'bun';

/** Total bytes of all files below `dir`. */
async function treeBytes(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += (await stat(path.join(entry.parentPath, entry.name))).size;
  }
  return total;
}

/** Specifiers imported, re-exported or required by the root entry, following relative chunks. */
async function rootGraphImports(dir, entry) {
  const seen = new Set(); const external = new Set(); const queue = [entry];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
  while (queue.length) {
    const file = queue.pop(); if (seen.has(file)) continue; seen.add(file);
    for (const [, specifier] of (await readFile(path.join(dir, file), 'utf8')).matchAll(pattern)) {
      if (specifier.startsWith('.')) queue.push(path.join(path.dirname(file), specifier)); else external.add(specifier);
    }
  }
  return { files: [...seen], external: [...external] };
}
/**
 * Writes worker.mjs (main thread) and sync-worker.mjs (a worker thread) into the
 * consumer. The worker imports the installed package and runs the native
 * adapter with `io: "sync"`: batched appends, a buffer transferred from the
 * main thread and handed over with `transfer`, positional write, reads,
 * stream, truncate, flush, a write-buffered handle fed by appendChunks, and
 * 200 ms of blocking writes. The main thread then reads every byte back
 * through the default async adapter and checks that its own timer kept firing
 * while the worker blocked. VERIFIED: (probe, Node.js 26 and 20, Bun 1.4.3) a
 * 5 ms main-thread interval fired 38 to 40 times during 200 ms of such writes;
 * the check asks for a tenth of the expected ticks.
 */
async function writeWorkerConsumer(cwd) {
  await writeFile(path.join(cwd, 'sync-worker.mjs'), `import { parentPort, workerData } from 'node:worker_threads';
import { appendChunks } from 'defuss-storage';
import { createFileStorage } from 'defuss-storage/node';
const expect = (ok, what) => { if (!ok) throw new Error('worker: ' + what); };
const handed = await new Promise(resolve => parentPort.once('message', buffer => resolve(new Uint8Array(buffer))));
const storage = await createFileStorage(workerData.dir, { io: 'sync' });
const f = await storage.open('worker.bin', { create: true, exclusive: true });
const receipts = await Promise.all(Array.from({ length: 16 }, (_, i) => f.append(new Uint8Array(4096).fill(i))));
expect(receipts.every((r, i) => r.offset === i * 4096), 'batched append offsets');
expect((await f.append(handed, { transfer: true })).offset === 65536 && handed.byteLength === 0, 'transfer');
await f.write(0, new Uint8Array([9, 9, 9, 9]));
expect((await f.readExactly(0, 4)).every(b => b === 9), 'readExactly');
const target = new Uint8Array(4096); expect(await f.readInto(4096, target) === 4096 && target.every(b => b === 1), 'readInto');
let streamed = 0; for await (const part of f.stream({ chunkSize: 8192 })) streamed += part.length;
expect(streamed === 131072 && await f.size() === 131072, 'stream and size');
await f.truncate(130048); await f.flush(); await f.close();
const b = await storage.open('buffered.bin', { create: true, writeBuffer: 65536 });
async function* chunks() { for (let i = 0; i < 200; i++) yield new Uint8Array(1024).fill(i & 255); }
let count = 0; for await (const r of appendChunks(b, chunks(), { inFlight: 4 })) expect(r.offset === count++ * 1024, 'appendChunks offsets');
await b.close();
const busy = await storage.open('busy.bin', { create: true }); const block = new Uint8Array(4096);
parentPort.postMessage({ busy: 'start' }); const start = performance.now(); let calls = 0;
while (performance.now() - start < 200) { await busy.write(0, block); calls++; }
parentPort.postMessage({ busy: 'end', ms: performance.now() - start, calls }); await busy.close();
parentPort.postMessage({ done: true });
`);
  await writeFile(path.join(cwd, 'worker.mjs'), `import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { createFileStorage } from 'defuss-storage/node';
const dir = await mkdtemp(path.join(tmpdir(), 'defuss-storage-worker-'));
const worker = new Worker(new URL('./sync-worker.mjs', import.meta.url), { workerData: { dir } });
const handed = new Uint8Array(65536).fill(0xab); worker.postMessage(handed.buffer, [handed.buffer]);
assert.equal(handed.byteLength, 0);
let ticks = 0; let timer; let busy;
await new Promise((resolve, reject) => {
  worker.on('message', m => {
    if (m.busy === 'start') timer = setInterval(() => ticks++, 5);
    else if (m.busy === 'end') { clearInterval(timer); busy = { ...m, ticks }; }
    else if (m.done) resolve();
  });
  worker.once('error', reject);
  worker.once('exit', code => { if (code) reject(new Error('worker exited with ' + code)); });
}).finally(() => clearInterval(timer));
assert.ok(busy.calls > 0 && busy.ticks >= busy.ms / 50, 'main thread kept running: ' + JSON.stringify(busy));
const storage = await createFileStorage(dir);
const f = await storage.open('worker.bin');
assert.equal(await f.size(), 130048);
assert.deepEqual([...await f.read(0, 5)], [9, 9, 9, 9, 0]);
assert.ok((await f.read(4096 * 15, 4096)).every(b => b === 15));
assert.ok((await f.read(65536, 130048 - 65536)).every(b => b === 0xab));
await f.close();
const g = await storage.open('buffered.bin'); const bytes = await g.read(0, 204800);
assert.equal(bytes.length, 204800); assert.ok(bytes.every((b, i) => b === (Math.floor(i / 1024) & 255)));
await g.close(); await rm(dir, { recursive: true, force: true });
`);
}

try {
  const tarball = execFileSync(bun, ['pm', 'pack', '--destination', cwd, '--ignore-scripts', '--quiet'], { cwd: root, encoding: 'utf8' }).trim();
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync(bun, ['add', '--ignore-scripts', tarball], { cwd, stdio: 'pipe' });
  await writeFile(path.join(cwd, 'smoke.mjs'), `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { appendChunks, createMemoryStorage } from 'defuss-storage';
import { createFileStorage } from 'defuss-storage/node';
import { createOPFSStorage } from 'defuss-storage/opfs';
import { createDirectoryStorage } from 'defuss-storage/directory';
const require=createRequire(import.meta.url);
const common=require('defuss-storage');
for (const [make, ingest] of [[createMemoryStorage, appendChunks], [common.createMemoryStorage, common.appendChunks]]) {
 const f=await make({maxPendingOperations:2}).open('data',{create:true}); await f.append(new Uint8Array([1,2])); assert.equal(await f.size(),2);
 const burst=await Promise.allSettled([f.size(),f.size(),f.size()]); assert.equal(burst[2].reason.code,'QUEUE_FULL');
 async function* chunks(){ yield new Uint8Array([3]); } for await (const r of ingest(f, chunks())) assert.deepEqual(r,{offset:2,byteLength:1});
 await f.close();
}
assert.equal(typeof createFileStorage,'function'); assert.equal(typeof require('defuss-storage/node').createFileStorage,'function');
assert.equal(typeof createOPFSStorage,'function'); await assert.rejects(createOPFSStorage(),{code:'UNSUPPORTED'});
assert.equal(typeof require('defuss-storage/directory').createDirectoryStorage,'function'); await assert.rejects(createDirectoryStorage({}),TypeError);
`);
  execFileSync(process.execPath, ['smoke.mjs'], { cwd, stdio: 'pipe' });
  await writeWorkerConsumer(cwd);
  execFileSync(process.execPath, ['worker.mjs'], { cwd, stdio: 'pipe', timeout: 120000 });
  const declarations = `import { appendChunks, createMemoryStorage, type AdmissionOptions, type StorageAdapter, type CancellationSignal, type StorageErrorCode } from 'defuss-storage';
import { createFileStorage } from 'defuss-storage/node';
import { createOPFSStorage } from 'defuss-storage/opfs';
import { createDirectoryStorage, type DirectoryHandle } from 'defuss-storage/directory';
const limits: AdmissionOptions = { maxWriteBytes: 1024, maxPendingWriteBytes: 4096, maxPendingOperations: 8 };
const store: StorageAdapter = createMemoryStorage(limits);
const signal: CancellationSignal = { aborted: false };
const full: StorageErrorCode = 'QUEUE_FULL';
async function* source(): AsyncIterable<Uint8Array> { yield new Uint8Array(1); }
async function use() {
  const file = await store.open('bytes', { create: true }); await file.read(0, 3, { signal });
  for await (const receipt of appendChunks(file, source(), { signal })) void receipt.offset;
  await file.close();
}
void full;
void use; void createFileStorage; void createOPFSStorage;
async function folder(handle: DirectoryHandle) { const storage = await createDirectoryStorage(handle, { name: 'docs', maxPendingOperations: 8 }); return storage.capabilities.ownership; }
void folder;
`;
  await writeFile(path.join(cwd, 'consumer.mts'), declarations);
  await writeFile(path.join(cwd, 'consumer.cts'), declarations);
  await writeFile(path.join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, lib: ['ES2022'], types: [], skipLibCheck: false }, include: ['consumer.*ts'] }));
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(cwd, 'tsconfig.json')], { cwd, stdio: 'pipe' });
  const metadata = JSON.parse(await readFile(path.join(cwd, 'node_modules/defuss-storage/package.json'), 'utf8'));
  assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0);
  const installed = path.join(cwd, 'node_modules/defuss-storage');
  const rootImports = {};
  for (const entry of ['dist/index.mjs', 'dist/index.cjs']) {
    const graph = await rootGraphImports(installed, entry);
    assert.deepEqual(graph.external, [], `${entry} must not import platform modules: ${graph.external}`);
    rootImports[entry] = graph.files;
  }
  const report = { version: metadata.version, packageBytes: (await stat(tarball)).size, unpackedBytes: await treeBytes(installed), esm: true, commonjs: true, syncIoWorkerThread: true, declarationsWithoutDOMOrNode: true, runtimeDependencies: 0, rootEntryModuleGraph: rootImports, rootEntryExternalImports: [] };
  await mkdir(path.join(root, 'output'), { recursive: true }); await writeFile(path.join(root, 'output/package-results.json'), JSON.stringify(report, null, 2)+'\n');
  console.log('Packed consumers passed: ESM, CommonJS, all entry points, synchronous I/O in a worker thread, TypeScript without DOM/Node ambient types; zero runtime dependencies; root entry imports no platform modules.');
} catch (error) {
  if (error.stdout) console.error(error.stdout.toString()); if (error.stderr) console.error(error.stderr.toString()); throw error;
} finally { await rm(cwd, { recursive: true, force: true }); }
