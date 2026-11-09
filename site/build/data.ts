// The figures behind the charts, read from the repository at build time: the
// published benchmark reports and the built package. Nothing on the page is
// typed in by hand, so a new `make bench` or build changes the charts with it.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

export interface Range { readonly median: number; readonly min: number; readonly max: number }
export interface Latency { readonly mean: number; readonly p50: number; readonly p95: number; readonly p99: number }

/** One adapter, chunk size and package version of one environment. */
export interface Row {
  readonly version: string;
  readonly adapter: 'memory' | 'file' | 'opfs';
  readonly chunk: number;
  readonly append: Range;
  readonly pipelined: Range;
  readonly stream: Range;
  readonly streamChecksum: Range;
  readonly readInto: Latency;
  readonly read: Latency;
  readonly parallelReads: Range;
}

export interface Environment {
  readonly id: 'node' | 'bun' | 'chromium' | 'firefox' | 'webkit';
  readonly runtime: string;
  /** Smallest step of performance.now() in µs: per-call latencies below it are quantized (browsers only). */
  readonly timerStepMicros: number | null;
  readonly rows: readonly Row[];
  /** Median MiB/s of the append options (write buffer, sync I/O, inFlight, transfer). */
  readonly options: Readonly<Record<string, Range>>;
}

export interface SiteData {
  /** The package version in the repository's package.json: the hero's one version tag. */
  readonly packageVersion: string;
  readonly generatedAt: string;
  readonly cpu: string;
  readonly logicalCpus: number;
  /** Installed memory of the benchmark machine (os.totalmem() in the Node.js report). */
  readonly memoryBytes: number;
  readonly environments: readonly Environment[];
  readonly overload: { readonly calls: number; readonly chunkBytes: number; readonly versions: Readonly<Record<string, { accepted: number; queueFull: number; arrayBuffers: number }>> };
  readonly large: { readonly bytes: number; readonly heapLimitMiB: number; readonly maxRssBytes: number; readonly writeMiBps: number; readonly readMiBps: number };
  readonly sizes: readonly { readonly entry: string; readonly raw: number; readonly gzip: number; readonly brotli: number }[];
}

type Json = Record<string, any>;
const readJson = (file: string): Json => JSON.parse(readFileSync(file, 'utf8')) as Json;
const range = (value: Json): Range => ({ median: value.median, min: value.min, max: value.max });
const latency = (value: Json): Latency => ({ mean: value.mean, p50: value.p50, p95: value.p95, p99: value.p99 });

function rows(sequential: Json): Row[] {
  const out: Row[] = [];
  for (const [version, adapters] of Object.entries<Json>(sequential))
    for (const [adapter, chunks] of Object.entries<Json>(adapters))
      for (const [chunk, row] of Object.entries<Json>(chunks))
        out.push({
          version, adapter: adapter as Row['adapter'], chunk: Number(chunk),
          append: range(row.appendMiBps), pipelined: range(row.pipelinedAppendMiBps),
          stream: range(row.streamMiBps), streamChecksum: range(row.streamWithChecksumMiBps),
          readInto: latency(row.readIntoMicros), read: latency(row.readMicros),
          parallelReads: range(row.parallelReadsPerSecond),
        });
  return out;
}

const options = (report: Json): Record<string, Range> =>
  Object.fromEntries(Object.entries<Json>(report.options.appendMiBps).map(([name, value]) => [name, range(value)]));

/** The newest report set in `benchmarks/` (`<version>-<os>-<arch>.json` plus its -bun and -browsers twins). */
function newestReport(dir: string): string {
  const base = readdirSync(dir).filter(name => /^\d+\.\d+\.\d+-[a-z0-9]+-[a-z0-9]+\.json$/.test(name)).sort().at(-1);
  if (!base) throw new Error(`data: no benchmark report in ${dir}`);
  return path.join(dir, base.replace(/\.json$/, ''));
}

/** Bytes of one ESM entry of the package plus the local chunks it imports, as shipped. */
function entrySize(dist: string, file: string): { raw: number; gzip: number; brotli: number } {
  const seen = new Set<string>();
  let source = '';
  const walk = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const text = readFileSync(path.join(dist, name), 'utf8');
    source += text;
    for (const match of text.matchAll(/from\s*["']\.\/([^"']+)["']/g)) walk(match[1]!);
  };
  walk(file);
  return { raw: Buffer.byteLength(source), gzip: gzipSync(source, { level: 9 }).length, brotli: brotliCompressSync(source).length };
}

/** Collects every figure the page shows from `repo` (the defuss-storage checkout). */
export function siteData(repo: string): SiteData {
  const base = newestReport(path.join(repo, 'benchmarks'));
  const node = readJson(`${base}.json`);
  const bun = readJson(`${base}-bun.json`);
  const browsers = readJson(`${base}-browsers.json`);
  const environments: Environment[] = [
    { id: 'node', runtime: `Node.js ${String(node.node).replace(/^v/, '')}`, timerStepMicros: null, rows: rows(node.sequential), options: options(node) },
    { id: 'bun', runtime: `Bun ${String(bun.runtime).replace(/^bun /, '')}`, timerStepMicros: null, rows: rows(bun.sequential), options: options(bun) },
    ...(['chromium', 'firefox', 'webkit'] as const).map(id => {
      const browser = browsers.browsers[id];
      const name = { chromium: 'Chromium', firefox: 'Firefox', webkit: 'WebKit' }[id];
      return { id, runtime: `${name} ${browser.version}`, timerStepMicros: browser.timerStepMicros, rows: rows(browser.sequential), options: options(browser) };
    }),
  ];
  const overload = node.overload;
  const dist = path.join(repo, 'dist');
  return {
    packageVersion: String(readJson(path.join(repo, 'package.json')).version),
    generatedAt: node.generatedAt, cpu: node.cpu, logicalCpus: node.logicalCpus, memoryBytes: node.totalMemoryBytes, environments,
    overload: {
      calls: overload['0.2.0'].memory.calls, chunkBytes: overload['0.2.0'].memory.chunkBytes,
      versions: Object.fromEntries(Object.entries<Json>(overload).map(([version, adapters]) =>
        [version, { accepted: adapters.memory.accepted, queueFull: adapters.memory.queueFull, arrayBuffers: adapters.memory.sampledPeak.arrayBuffers }])),
    },
    large: { bytes: node.large.bytes, heapLimitMiB: node.large.v8HeapLimitMiB, maxRssBytes: node.large.maxRssBytes, writeMiBps: node.large.writeMiBps, readMiBps: node.large.readMiBps },
    sizes: [['defuss-storage', 'index.mjs'], ['defuss-storage/opfs', 'opfs.mjs'], ['defuss-storage/node', 'node.mjs']]
      .map(([entry, file]) => ({ entry: entry!, ...entrySize(dist, file!) })),
  };
}
