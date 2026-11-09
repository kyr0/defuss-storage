// Pure builders of the ECharts options behind every chart: data in, option
// object out, no DOM. ECharts' own aria description stays off: it replaces the
// element's aria-label with a series dump; each chart carries a short label and
// the benchmark page repeats the figures in a table.
// VERIFIED: (test/client.test.ts) series and notes match the published reports. Colours are design tokens that the defuss-shadcn chart
// component resolves against the element and re-resolves on theme changes.
import type { Environment, Range, Row, SiteData } from '../build/data.ts';

export type Metric = 'append' | 'pipelined' | 'stream' | 'streamChecksum' | 'readInto';
export type Adapter = Row['adapter'];
type Text = (key: string, values?: Record<string, string | number>) => string;
type Option = Record<string, unknown>;

export const CHUNKS = [4096, 65536, 1048576] as const;
export const chunkLabel = (chunk: number): string => (chunk >= 1048576 ? `${chunk / 1048576} MiB` : `${chunk / 1024} KiB`);
/** Fixed bar geometry, so the whiskers can find the centre of each version's bar. */
const BAR_WIDTH = 34;
const BAR_GAP = 0.2;
const VERSION_COLOURS: Record<string, string> = { '0.1.0': 'color-mix(in oklch, var(--muted-foreground) 55%, var(--muted))', '0.2.0': 'var(--st-accent)' };

/** The metric's value of one row: a median with its range, or a latency mean (no range). */
export function metricValue(row: Row, metric: Metric): Range {
  if (metric === 'readInto') return { median: row.readInto.mean, min: row.readInto.mean, max: row.readInto.mean };
  return row[metric];
}

export function rowsFor(environment: Environment, adapter: Adapter, version: string): Row[] {
  return CHUNKS.map(chunk => environment.rows.find(row => row.adapter === adapter && row.version === version && row.chunk === chunk))
    .filter((row): row is Row => Boolean(row));
}

/** Grouped bars per chunk size, one series per version, with min-max whiskers. */
/** `ink` is the resolved whisker colour: custom series draw outside the token resolver. */
export function explorerOption(environment: Environment, adapter: Adapter, metric: Metric, text: Text, ink: string): Option {
  const versions = ['0.1.0', '0.2.0'];
  const categories = CHUNKS.map(chunkLabel);
  const unit = metric === 'readInto' ? text('unitMicros') : text('unitMiBps');
  const series: Option[] = [];
  versions.forEach((version, index) => {
    const values = rowsFor(environment, adapter, version).map(row => metricValue(row, metric));
    const id = `v${version}`;
    series.push({
      id, name: version, type: 'bar', barGap: `${BAR_GAP * 100}%`, barWidth: BAR_WIDTH,
      itemStyle: { color: VERSION_COLOURS[version], borderRadius: [5, 5, 0, 0] },
      data: values.map(value => Number(value.median.toFixed(metric === 'readInto' ? 3 : 1))),
    });
    if (metric !== 'readInto') series.push({
      id: `${id}-range`, name: version, type: 'custom', z: 3, tooltip: { show: false },
      data: values.map((value, category) => [category, value.min, value.max]),
      // Whiskers sit on the centre of this version's bar inside the group.
      renderItem: (_params: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[] }) => {
        const category = api.value(0);
        const low = api.coord([category, api.value(1)]);
        const high = api.coord([category, api.value(2)]);
        const offset = (index - 0.5) * BAR_WIDTH * (1 + BAR_GAP);
        const x = low[0]! + offset;
        const style = { stroke: ink, lineWidth: 1.25, opacity: 0.7 };
        return { type: 'group', children: [
          { type: 'line', shape: { x1: x, y1: low[1], x2: x, y2: high[1] }, style },
          { type: 'line', shape: { x1: x - 5, y1: high[1], x2: x + 5, y2: high[1] }, style },
          { type: 'line', shape: { x1: x - 5, y1: low[1], x2: x + 5, y2: low[1] }, style },
        ] };
      },
    });
  });
  return {
    legend: { data: versions, top: 0, right: 0 },
    grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'category', data: categories },
    yAxis: { type: 'value', name: unit, nameTextStyle: { align: 'left' } },
    series,
  };
}

/** One sentence comparing 0.2.0 with 0.1.0 at the chunk size where the change is largest. */
export function explorerNote(environment: Environment, adapter: Adapter, metric: Metric, text: Text, format: (value: number, digits?: number) => string): string {
  const current = rowsFor(environment, adapter, '0.2.0');
  const previous = rowsFor(environment, adapter, '0.1.0');
  if (current.length !== CHUNKS.length || previous.length !== CHUNKS.length) return '';
  if (metric === 'readInto') {
    const row = current[0]!;
    return text('chartNoteLatency', { chunk: chunkLabel(row.chunk), value: format(row.readInto.mean, 2), old: format(previous[0]!.readInto.mean, 2) });
  }
  const ratios = current.map((row, index) => ({ chunk: row.chunk, ratio: metricValue(row, metric).median / metricValue(previous[index]!, metric).median, row, old: previous[index]! }));
  const best = ratios.reduce((a, b) => (Math.abs(Math.log(b.ratio)) > Math.abs(Math.log(a.ratio)) ? b : a));
  // A "gain" counts only when the slowest new run beats the fastest old one.
  const clear = metricValue(best.row, metric).min > metricValue(best.old, metric).max;
  return text(clear ? 'chartNoteFaster' : 'chartNoteSlower', { chunk: chunkLabel(best.chunk), ratio: format(best.ratio, best.ratio < 10 ? 1 : 0), metricShort: text('metricShortThroughput') });
}

/** Horizontal bars of the shipped bytes per entry point. */
export function sizesOption(data: SiteData, text: Text): Option {
  const entries = data.sizes.map(size => size.entry);
  const series = (['raw', 'gzip', 'brotli'] as const).map((kind, index) => ({
    id: kind, name: text(`size${kind[0]!.toUpperCase()}${kind.slice(1)}`), type: 'bar', barMaxWidth: 14,
    itemStyle: { color: ['color-mix(in oklch, var(--muted-foreground) 45%, var(--muted))', 'var(--st-accent)', 'var(--st-accent-2)'][index], borderRadius: [0, 4, 4, 0] },
    label: { show: true, position: 'right', formatter: ({ value }: { value: number }) => `${value.toFixed(1)}` },
    data: data.sizes.map(size => Number((size[kind] / 1000).toFixed(1))),
  }));
  return {
    legend: { top: 0, right: 0 },
    grid: { left: 8, right: 40, top: 32, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (value: number) => `${value} kB` },
    xAxis: { type: 'value', name: text('sizeAxis') },
    yAxis: { type: 'category', data: entries, inverse: true },
    series,
  };
}

export const OPTION_KEYS: readonly [string, string][] = [
  ['append 4 KiB awaited', 'optAwaited'],
  ['append 4 KiB awaited, writeBuffer 1 MiB', 'optBuffered'],
  ['append 4 KiB awaited, io sync', 'optSync'],
  ['appendChunks 4 KiB, inFlight 1', 'optChunks1'],
  ['appendChunks 4 KiB, inFlight 16', 'optChunks16'],
  ['append 1 MiB awaited, copy', 'optCopy'],
  ['append 1 MiB awaited, transfer', 'optTransfer'],
];
const RUNTIME_COLOURS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

/** Append throughput per option, one series per runtime, on a log axis (78 to 11,000 MiB/s). */
export function optionsOption(data: SiteData, text: Text): Option {
  return {
    legend: { top: 0 },
    grid: { left: 8, right: 16, top: 40, bottom: 36, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (value: number | null) => (value == null ? '-' : `${Math.round(value)} MiB/s`) },
    xAxis: { type: 'log', name: text('optionsAxis'), nameLocation: 'middle', nameGap: 28, min: 50, max: 20000 },
    yAxis: { type: 'category', inverse: true, data: OPTION_KEYS.map(([, label]) => text(label)) },
    series: data.environments.map((environment, index) => ({
      id: environment.id, name: environment.runtime, type: 'bar', barMaxWidth: 10,
      itemStyle: { color: RUNTIME_COLOURS[index], borderRadius: [0, 3, 3, 0] },
      data: OPTION_KEYS.map(([key]) => environment.options[key]?.median ?? null),
    })),
  };
}

/** Accepted and rejected calls per version (stacked), with the sampled ArrayBuffer peak. */
export function overloadOption(data: SiteData, text: Text): Option {
  const versions = Object.keys(data.overload.versions).sort();
  const pick = (field: 'accepted' | 'queueFull' | 'arrayBuffers') => versions.map(version => data.overload.versions[version]![field]);
  return {
    legend: { top: 0 },
    grid: { left: 8, right: 8, top: 40, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: versions },
    yAxis: [{ type: 'value', name: 'calls' }, { type: 'value', name: 'MB', splitLine: { show: false } }],
    series: [
      { id: 'accepted', name: text('overloadAccepted'), type: 'bar', stack: 'calls', barMaxWidth: 56, itemStyle: { color: 'var(--st-accent)' }, data: pick('accepted') },
      { id: 'rejected', name: text('overloadRejected'), type: 'bar', stack: 'calls', barMaxWidth: 56, itemStyle: { color: 'var(--destructive)' }, data: pick('queueFull') },
      { id: 'peak', name: text('overloadPeak'), type: 'line', yAxisIndex: 1, symbolSize: 10, itemStyle: { color: 'var(--foreground)' }, data: pick('arrayBuffers').map(bytes => Math.round(bytes / 1e6)) },
    ],
  };
}

/** The visitor's live results next to the recorded report, throughput cases only. */
export function runOption(cases: readonly { label: string; yours: number; recorded: number | null }[], text: Text, engine: string): Option {
  return {
    legend: { top: 0 },
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (value: number | null) => (value == null ? '-' : `${Math.round(value)} MiB/s`) },
    xAxis: { type: 'log', name: 'MiB/s', min: 10 },
    yAxis: { type: 'category', inverse: true, data: cases.map(entry => entry.label) },
    series: [
      { id: 'yours', name: text('runYours'), type: 'bar', barMaxWidth: 12, itemStyle: { color: 'var(--st-accent)', borderRadius: [0, 3, 3, 0] }, data: cases.map(entry => Math.round(entry.yours)) },
      { id: 'recorded', name: text('runRecorded', { engine }), type: 'bar', barMaxWidth: 12, itemStyle: { color: 'color-mix(in oklch, var(--muted-foreground) 55%, var(--muted))', borderRadius: [0, 3, 3, 0] }, data: cases.map(entry => (entry.recorded == null ? null : Math.round(entry.recorded))) },
    ],
  };
}
