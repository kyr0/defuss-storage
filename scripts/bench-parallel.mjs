// Parallel OPFS benchmark in real browsers: a report, never a CI gate.
// Scans read one file through one owning handle in one worker, or through
// shared read-only handles in 1, 2, 4 and 8 workers, each streaming an equal
// byte range. Writes append the same total either to one file from one worker,
// or to one file per worker from 2, 4 and 8 workers, or write it to one file
// through shared writers from 2, 4 and 8 workers, each its own byte range
// (where the browser has shared writers). `work` steps per 16 bytes
// stand in for a decoder or encoder: 0 measures the I/O alone, 64 a consumer
// that codes at a few hundred MiB/s per core. Each figure is the median of the
// runs' whole throughput, opens and closes included. Every scan and fill checks
// its byte count, so a short read or write fails the run.
// VERIFIED: (runs, 2026-11-20, load average 5 to 10) one cell moved 3× between
// runs (Chromium, 4 shared scans: 618 MiB/s with 32 MiB, 2,041 with 128 MiB and
// five runs), so use BENCH_DATASET_MIB=128 or more and compare ratios within a run.
//
// Usage: node scripts/bench-parallel.mjs [chromium] [firefox] [webkit]   (default: all three)
// Env: BENCH_REPS (default 3), BENCH_DATASET_MIB (32).
// Results: benchmarks/<version>-<platform>-<arch>-parallel.json (the site reads it) and output/bench-parallel.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, withBrowser } from './browsers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const browsers = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox', 'webkit'];
const env = (key, fallback) => { const v = Number(process.env[key] ?? fallback); if (!Number.isSafeInteger(v) || v < 1) throw new Error(`${key} must be a positive integer`); return v; };
const config = { reps: env('BENCH_REPS', 3), bytes: env('BENCH_DATASET_MIB', 32) * 1048576, works: [0, 64], chunkSizes: [65536, 1048576], workers: [1, 2, 4, 8] };
const log = message => console.error(`${new Date().toISOString()} INFO ${message}`);

/** Runs in the page: one dataset, then every (work, chunkSize, layout) cell. */
async function pageBench(config) {
  let sequence = 0;
  const call = (worker, task, args) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const listener = ({ data }) => { if (data.id !== id) return; worker.removeEventListener('message', listener); if (data.error) reject(new Error(data.error)); else resolve(data.result); };
    worker.addEventListener('message', listener); worker.postMessage({ id, task, ...args });
  });
  const namespace = `bench-parallel-${Date.now()}`;
  const workers = Array.from({ length: Math.max(...config.workers) }, () => new Worker('/scripts/bench-parallel-worker.mjs', { type: 'module' }));
  const results = [];
  try {
    const { sharedWriters } = await call(workers[0], 'setup', { namespace, bytes: config.bytes });
    const median = values => values.sort((a, b) => a - b)[values.length >> 1];
    const layouts = [{ label: 'owning x1', count: 1, shared: false }, ...config.workers.map(count => ({ label: `shared x${count}`, count, shared: true }))];
    for (const work of config.works) for (const chunkSize of config.chunkSizes) {
      const runs = Object.fromEntries(layouts.map(l => [l.label, []]));
      for (let rep = 0; rep < config.reps; rep++) for (const { label, count, shared } of layouts) {
        const part = Math.ceil(config.bytes / count); const started = performance.now();
        const scans = await Promise.all(workers.slice(0, count).map((worker, i) =>
          call(worker, 'scan', { namespace, start: i * part, end: Math.min(config.bytes, (i + 1) * part), work, chunkSize, shared })));
        const seconds = (performance.now() - started) / 1000;
        if (scans.reduce((sum, s) => sum + s.bytes, 0) !== config.bytes) throw new Error(`${label}: short scan`);
        runs[label].push(config.bytes / 1048576 / seconds);
      }
      results.push({ kind: 'scan', work, chunkSize, mibPerSecond: Object.fromEntries(Object.entries(runs).map(([label, values]) => [label, Math.round(median(values))])) });
    }
    const many = config.workers.filter(count => count > 1);
    const writers = [{ label: 'one file x1', count: 1, shared: false }, ...many.map(count => ({ label: `own files x${count}`, count, shared: false })),
      ...(sharedWriters ? many.map(count => ({ label: `shared file x${count}`, count, shared: true })) : [])];
    for (const work of config.works) for (const chunkSize of config.chunkSizes) {
      const runs = Object.fromEntries(writers.map(w => [w.label, []]));
      for (let rep = 0; rep < config.reps; rep++) for (const { label, count, shared } of writers) {
        const part = Math.ceil(config.bytes / count); const started = performance.now();
        const fills = await Promise.all(workers.slice(0, count).map((worker, i) => shared
          ? call(worker, 'fillShared', { namespace, start: i * part, end: Math.min(config.bytes, (i + 1) * part), work, chunkSize })
          : call(worker, 'fill', { namespace, name: `fill-${i}.bin`, bytes: Math.min(part, config.bytes - i * part), work, chunkSize })));
        const seconds = (performance.now() - started) / 1000;
        if (fills.reduce((sum, f) => sum + f.bytes, 0) !== config.bytes) throw new Error(`${label}: short write`);
        if (shared && await call(workers[0], 'drop', { namespace, name: 'fill-shared.bin' }) !== config.bytes) throw new Error(`${label}: wrong file size`);
        runs[label].push(config.bytes / 1048576 / seconds);
      }
      results.push({ kind: 'write', work, chunkSize, mibPerSecond: Object.fromEntries(Object.entries(runs).map(([label, values]) => [label, Math.round(median(values))])) });
    }
  } finally {
    for (const worker of workers) worker.terminate();
    await (await (await navigator.storage.getDirectory()).getDirectoryHandle('defuss-storage')).removeEntry(namespace, { recursive: true }).catch(() => {});
  }
  return results;
}

const server = await serve(root);
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const report = { version: pkg.version, date: new Date().toISOString(), cpus: cpus().length, config, browsers: {} };
try {
  for (const name of browsers) await withBrowser(name, async (page, version) => {
    page.setDefaultTimeout(600000);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    log(`browser=${name} version=${version} start`);
    const results = await page.evaluate(pageBench, config);
    report.browsers[name] = { version, results };
    for (const { kind, work, chunkSize, mibPerSecond } of results) log(`browser=${name} kind=${kind} work=${work} chunk=${chunkSize} ${Object.entries(mibPerSecond).map(([k, v]) => `${k.replaceAll(' ', '')}=${v}`).join(' ')}`);
  });
} finally { await new Promise(resolve => server.close(resolve)); }
await mkdir(path.join(root, 'output'), { recursive: true });
const json = JSON.stringify(report, null, 2) + '\n';
await writeFile(path.join(root, 'output/bench-parallel.json'), json);
await writeFile(path.join(root, 'benchmarks', `${pkg.version}-${process.platform}-${process.arch}-parallel.json`), json);
