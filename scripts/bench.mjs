// Byte-I/O benchmark: a report, never a CI gate. Correctness is checked on every
// run (digests, offsets, admission bounds); timings are recorded, not judged.
//
// Workloads per version (this build and the 0.1.0 release tarball) and adapter:
//   - sequential appends at several chunk sizes, then a separately timed flush
//   - the same appends with 16 in flight (0.2.0 batches them into vectored writes)
//   - a full stream scan: throughput and time to first chunk; and a scan whose
//     consumer checksums every byte, so read-ahead can overlap reading and work
//   - random 4 KiB reads (read and readInto): p50/p95/p99 latency, and readInto
//     throughput with eight calls in flight on a read-only handle
//   - producer overload: un-awaited appends, with pending high-water marks
//   - slow producer through appendChunks and slow stream consumer (pull-driven)
//   - this build's opt-in features against its own defaults: write buffer,
//     buffer hand-off (transfer), appendChunks window, synchronous native I/O
// plus one native file larger than the child process's V8 heap limit, written
// and verified in bounded chunks against a streaming SHA-256 reference. The
// sequential and option workloads live in bench-core.mjs, shared with the OPFS
// benchmark in browsers (bench-browsers.mjs).
//
// Runs on Node.js (`bun run bench`) and on Bun (`bun run bench:bun`). Bun has no
// V8 heap flag, so its large-file child runs unlimited and only its peak RSS
// bounds the file.
//
// Throughput and flush figures carry median, min and max across repetitions.
// Data is deterministic (seeded xorshift32). File timings include the OS page
// cache: they are warm-cache numbers, not device or durability measurements.
// UNKNOWN: the page-cache share of each native timing; no cold-cache run exists.
// VERIFIED: (0.2.0 runs) interleaving with alternating order moved the 1 MiB
// native stream ratio against 0.1.0 from 0.41x to 0.99x, so a fixed version
// order biased the comparison.
// Env: BENCH_REPS (default 5), BENCH_DATASET_MIB (32), BENCH_LARGE_MIB (512, 0 skips).
// Results: benchmarks/<version>-<platform>-<arch>.json and output/bench.json; on
// Bun, the same names with a -bun suffix.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { cpus, tmpdir, totalmem } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MiB, fill, round, workloads } from './bench-core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const bun = process.versions.bun;
const ADMISSION = Symbol.for('defuss-storage.v0.admission');
const env = (key, fallback) => { const v = Number(process.env[key] ?? fallback); if (!Number.isSafeInteger(v) || v < 0) throw new Error(`${key} must be a nonnegative integer`); return v; };
const config = {
  reps: env('BENCH_REPS', 5), datasetBytes: env('BENCH_DATASET_MIB', 32) * MiB, largeBytes: env('BENCH_LARGE_MIB', 512) * MiB,
  chunkSizes: [4096, 65536, MiB], randomReads: 2000, randomReadBytes: 4096, overloadCalls: 2000, overloadChunk: 65536,
};
const { sequentialSuite, optionsSuite } = workloads(config, message => console.error(`${new Date().toISOString()} INFO ${message}`));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Samples process memory every 5 ms while `run` executes; a sampled peak can miss short spikes. */
async function withMemoryPeak(run) {
  const peak = { rss: 0, heapUsed: 0, external: 0, arrayBuffers: 0 };
  const sample = () => { const m = process.memoryUsage(); for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], m[k]); };
  globalThis.gc?.(); sample(); const timer = setInterval(sample, 5);
  try { return { value: await run(), peak }; } finally { clearInterval(timer); sample(); }
}

/** Imports a package build: this checkout's dist/ or the extracted 0.1.0 tarball. */
async function loadVersion(label, dir) {
  const load = file => import(pathToFileURL(path.join(dir, file)).href);
  const [core, node] = await Promise.all([load('index.mjs'), load('node.mjs')]);
  return { label, core, node };
}

/** Un-awaited appends: how many are admitted, and how much input the handle retains at peak. */
async function overload(storage, name) {
  const file = await storage.open(name, { create: true, exclusive: true });
  try {
    const chunk = fill(new Uint8Array(config.overloadChunk), 7); const calls = []; const high = { operations: 0, writeBytes: 0 };
    const { peak } = await withMemoryPeak(async () => {
      for (let i = 0; i < config.overloadCalls; i++) {
        calls.push(file.append(chunk));
        const now = file[ADMISSION]; if (now) { high.operations = Math.max(high.operations, now.operations); high.writeBytes = Math.max(high.writeBytes, now.writeBytes); }
      }
      return Promise.allSettled(calls);
    });
    const settled = await Promise.allSettled(calls);
    const accepted = settled.filter(r => r.status === 'fulfilled').length;
    const rejected = settled.filter(r => r.status === 'rejected'); const queueFull = rejected.filter(r => r.reason.code === 'QUEUE_FULL').length;
    if (rejected.length !== queueFull) throw new Error(`unexpected overload failure: ${rejected.find(r => r.reason.code !== 'QUEUE_FULL')?.reason}`);
    if ((await file.size()) !== accepted * chunk.length) throw new Error('overload size mismatch');
    return { calls: config.overloadCalls, chunkBytes: chunk.length, accepted, queueFull, pendingHighWater: file[ADMISSION] ? high : 'not instrumented in this version', sampledPeak: peak };
  } finally { await file.close(); await storage.remove(name); }
}

/** Slow producer (1 ms per chunk) through appendChunks, and a slow consumer (1 ms per pulled chunk). */
async function slowPaths(lib, storage) {
  const file = await storage.open('slow.bin', { create: true, exclusive: true }); const chunks = 200; const size = 16384;
  try {
    // Sampled at each source pull: pull-driven ingestion means the previous append has settled by then.
    const atPull = { operations: 0, writeBytes: 0 };
    async function* producer() {
      for (let i = 0; i < chunks; i++) {
        const now = file[ADMISSION]; atPull.operations = Math.max(atPull.operations, now.operations); atPull.writeBytes = Math.max(atPull.writeBytes, now.writeBytes);
        await sleep(1); yield fill(new Uint8Array(size), i);
      }
    }
    let start = performance.now(); let count = 0;
    for await (const receipt of lib.core.appendChunks(file, producer())) {
      if (receipt.offset !== count++ * size) throw new Error('appendChunks offset mismatch');
    }
    const producerMs = performance.now() - start;
    start = performance.now(); let pulled = 0;
    for await (const part of file.stream({ chunkSize: size })) { await sleep(1); pulled += part.length; }
    const consumerMs = performance.now() - start; if (pulled !== chunks * size) throw new Error('slow consumer length mismatch');
    return { chunks, chunkBytes: size, producerDelayMs: 1, producerMs: round(producerMs), maxPendingAtSourcePull: atPull, consumerDelayMs: 1, consumerMs: round(consumerMs) };
  } finally { await file.close(); await storage.remove('slow.bin'); }
}

/** Child-process mode: writes and verifies `bytes` through bounded chunks under a small V8 heap limit. */
async function largeChild(dir, bytes) {
  const { appendChunks } = await import(pathToFileURL(path.join(root, 'dist/index.mjs')).href);
  const { createFileStorage } = await import(pathToFileURL(path.join(root, 'dist/node.mjs')).href);
  const chunkSize = MiB; const reference = createHash('sha256');
  async function* source() { const chunk = new Uint8Array(chunkSize); for (let i = 0; i * chunkSize < bytes; i++) { fill(chunk, i); reference.update(chunk); yield chunk; } }
  const file = await (await createFileStorage(dir)).open('large.bin', { create: true, exclusive: true });
  try {
    let start = performance.now(); for await (const _receipt of appendChunks(file, source())) { /* receipts are not retained */ }
    await file.flush(); const writeMs = performance.now() - start;
    start = performance.now(); const copy = createHash('sha256'); let seen = 0;
    for await (const part of file.stream({ chunkSize })) { copy.update(part); seen += part.length; }
    const readMs = performance.now() - start; const [expected, actual] = [reference.digest('hex'), copy.digest('hex')];
    if (seen !== bytes || expected !== actual) throw new Error(`large file verification failed: ${expected} != ${actual}`);
    const m = process.memoryUsage();
    return { bytes, chunkBytes: chunkSize, sha256: actual, writeMiBps: round(bytes / MiB / (writeMs / 1000)), readMiBps: round(bytes / MiB / (readMs / 1000)),
      maxRssBytes: process.resourceUsage().maxRSS * 1024, finalHeapUsedBytes: m.heapUsed, finalExternalBytes: m.external };
  } finally { await file.close(); }
}

/**
 * Runs largeChild in a separate process with a 32 MiB V8 heap limit (none on
 * Bun), after checking for twice the file size in free disk space (the file
 * plus headroom).
 */
async function large() {
  if (!config.largeBytes) return { skipped: 'BENCH_LARGE_MIB=0' };
  const dir = await mkdtemp(path.join(tmpdir(), 'defuss-storage-large-'));
  try {
    const fs = await statfs(dir); const free = fs.bavail * fs.bsize;
    if (free < config.largeBytes * 2) return { skipped: `only ${Math.floor(free / MiB)} MiB free, need ${2 * config.largeBytes / MiB}` };
    // VERIFIED: (probe, Bun 1.4.3) `bun --max-old-space-size=32` ignores the
    // flag (a script under it held 172 MiB of heap; Node.js aborts), so Bun's
    // run must not claim a heap limit.
    const heapMiB = bun ? null : 32;
    const child = spawnSync(process.execPath, [...(heapMiB ? [`--max-old-space-size=${heapMiB}`] : []), fileURLToPath(import.meta.url), '--large-child', dir, String(config.largeBytes)], { encoding: 'utf8' });
    if (child.status !== 0) throw new Error(`large-file child failed: ${child.stderr}`);
    return { v8HeapLimitMiB: heapMiB, ...JSON.parse(child.stdout),
      limit: heapMiB ? 'The V8 heap is limited; ArrayBuffer memory and RSS are not OS-enforced on every platform, so maxRssBytes is the measured evidence that the file was never resident.'
        : 'No heap limit (Bun has no V8 heap flag); maxRssBytes is the only evidence that the file was never resident.' };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

if (process.argv[2] === '--large-child') {
  process.stdout.write(JSON.stringify(await largeChild(process.argv[3], Number(process.argv[4]))));
} else {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const scratch = await mkdtemp(path.join(tmpdir(), 'defuss-storage-bench-'));
  try {
    execFileSync('tar', ['xzf', path.join(root, 'release/defuss-storage-0.1.0.tgz'), '-C', scratch]);
    const versions = [await loadVersion(pkg.version, path.join(root, 'dist')), await loadVersion('0.1.0', path.join(scratch, 'package/dist'))];
    const report = {
      version: pkg.version, generatedAt: new Date().toISOString(), runtime: bun ? `bun ${bun}` : `node ${process.version}`, node: process.version, platform: process.platform, arch: process.arch,
      cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem(), config,
      notes: [
        'Report only: timings vary per machine and run and are never CI thresholds.',
        'Native-file timings include the OS page cache (warm cache); flush latency depends on the device and file system.',
        'Memory peaks are sampled every 5 ms in-process and can miss short spikes; the memory adapter retains file data by design.',
        'No database or cross-engine comparison is implied.',
      ],
      sequential: {}, overload: {}, slow: {},
    };
    const adapters = {};
    for (const lib of versions) {
      const dir = await mkdtemp(path.join(scratch, `${lib.label}-`));
      adapters[lib.label] = { memory: lib.core.createMemoryStorage({ maxFileBytes: 1024 * MiB }), file: await lib.node.createFileStorage(dir) };
      report.sequential[lib.label] = {}; report.overload[lib.label] = {};
    }
    for (const adapter of ['memory', 'file']) {
      const results = await sequentialSuite(adapter, Object.fromEntries(versions.map(lib => [lib.label, adapters[lib.label][adapter]])));
      for (const lib of versions) {
        report.sequential[lib.label][adapter] = results[lib.label];
        report.overload[lib.label][adapter] = await overload(adapters[lib.label][adapter], 'overload.bin');
      }
    }
    for (const lib of versions) if (lib.core.appendChunks) report.slow[lib.label] = await slowPaths(lib, adapters[lib.label].file);
    const native = versions[0].node;
    report.options = await optionsSuite(versions[0].core, { async: await native.createFileStorage(path.join(scratch, 'opt-async')), sync: await native.createFileStorage(path.join(scratch, 'opt-sync'), { io: 'sync' }) });
    report.large = await large();
    const json = JSON.stringify(report, null, 2) + '\n';
    await mkdir(path.join(root, 'benchmarks'), { recursive: true }); await mkdir(path.join(root, 'output'), { recursive: true });
    const suffix = bun ? '-bun' : '';
    const versioned = path.join(root, 'benchmarks', `${pkg.version}-${process.platform}-${process.arch}${suffix}.json`);
    await writeFile(versioned, json); await writeFile(path.join(root, `output/bench${suffix}.json`), json);
    console.log(`${new Date().toISOString()} INFO benchmark report ${path.relative(root, versioned)}`);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
