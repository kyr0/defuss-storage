// OPFS benchmark in real browsers: a report, never a CI gate. Playwright opens
// each requested browser on a local server; a dedicated worker
// (bench-worker.mjs) runs the workloads shared with the Node.js and Bun
// benchmark (bench-core.mjs) on OPFS, for this build and the 0.1.0 tarball
// interleaved, then this build's opt-in features (write buffer, appendChunks
// window, transfer). Every workload checks its bytes, so a wrong result fails
// the run instead of being recorded.
//
// The server sends cross-origin isolation headers (COOP/COEP), since an
// isolated context may use a finer `performance.now()`. VERIFIED: (runs) with
// them all three engines report crossOriginIsolated, with timer steps of 5 µs
// (Chromium) and 20 µs (Firefox, WebKit). The report records the observed step:
// per-call latencies below it are quantized, so compare means.
// Timings include the browser's OPFS implementation and the OS page cache.
//
// Usage: node scripts/bench-browsers.mjs [chromium] [firefox] [webkit]   (default: all three)
// Env: BENCH_REPS (default 5), BENCH_DATASET_MIB (32).
// Results: benchmarks/<version>-<platform>-<arch>-browsers.json and output/bench-browsers.json.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MiB } from './bench-core.mjs';
import { serve, withBrowser } from './browsers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const browsers = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox', 'webkit'];
const env = (key, fallback) => { const v = Number(process.env[key] ?? fallback); if (!Number.isSafeInteger(v) || v < 1) throw new Error(`${key} must be a positive integer`); return v; };
const config = { reps: env('BENCH_REPS', 5), datasetBytes: env('BENCH_DATASET_MIB', 32) * MiB, chunkSizes: [4096, 65536, MiB], randomReads: 2000, randomReadBytes: 4096 };
const log = message => console.error(`${new Date().toISOString()} INFO ${message}`);

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
// The 0.1.0 tarball is extracted below tmp/ so the server, rooted at the repository, can serve it.
await mkdir(path.join(root, 'tmp'), { recursive: true });
const scratch = await mkdtemp(path.join(root, 'tmp', 'bench-browsers-'));
const server = await serve(root, { headers: { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-origin' } });
try {
  execFileSync('tar', ['xzf', path.join(root, 'release/defuss-storage-0.1.0.tgz'), '-C', scratch]);
  const old = '/' + path.relative(root, path.join(scratch, 'package/dist')).split(path.sep).join('/');
  const versions = [{ label: pkg.version, core: '/dist/index.mjs', opfs: '/dist/opfs.mjs' }, { label: '0.1.0', core: `${old}/index.mjs`, opfs: `${old}/opfs.mjs` }];
  const report = {
    version: pkg.version, generatedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
    cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem(), config,
    notes: [
      'Report only: timings vary per machine, browser and run and are never CI thresholds.',
      'OPFS timings include the browser implementation and the OS page cache (warm cache).',
      'Per-call latencies below timerStepMicros are quantized; compare the mean.',
    ],
    browsers: {},
  };
  for (const name of browsers) {
    log(`${name}: running`);
    report.browsers[name] = await withBrowser(name, async (page, version) => {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const request = { config, namespace: `bench-${Date.now()}`, versions };
      // page.evaluate has no timeout of its own, so a stuck worker (a lock never
      // granted, a hung OPFS call) ends the run after 30 minutes instead of never.
      const reply = await page.evaluate(request => new Promise(resolve => {
        const worker = new Worker('/scripts/bench-worker.mjs', { type: 'module' });
        const finish = data => { clearTimeout(timer); worker.terminate(); resolve(data); };
        const timer = setTimeout(() => finish({ error: 'worker timeout after 30 minutes', lines: [] }), 30 * 60 * 1000);
        worker.onmessage = ({ data }) => finish(data);
        worker.onerror = event => finish({ error: `worker failed: ${event.message ?? 'unknown'}`, lines: [] });
        worker.postMessage(request);
      }), request);
      for (const line of reply.lines) console.error(line.replace(' INFO ', ` INFO ${name} `));
      if (reply.error) throw new Error(`${name}: ${reply.error}`);
      return { version, ...reply.result };
    });
  }
  const json = JSON.stringify(report, null, 2) + '\n';
  await mkdir(path.join(root, 'benchmarks'), { recursive: true }); await mkdir(path.join(root, 'output'), { recursive: true });
  const versioned = path.join(root, 'benchmarks', `${pkg.version}-${process.platform}-${process.arch}-browsers.json`);
  await writeFile(versioned, json); await writeFile(path.join(root, 'output/bench-browsers.json'), json);
  console.log(`${new Date().toISOString()} INFO benchmark report ${path.relative(root, versioned)}`);
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
