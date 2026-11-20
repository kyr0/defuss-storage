// The numbers quoted in the copy ({{name}} slots), derived from the site data
// and formatted per language. Deriving them keeps the prose and the charts on
// the same report: a new benchmark run updates both.
import { BASE_VERSION, type SiteData } from './data.ts';
import type { Locale, Strings } from './i18n.ts';

const MB = 1e6;
const MiB = 1024 * 1024;

/** Every slot value for `locale`. */
export function figures(data: SiteData, locale: Locale): Record<string, string> {
  const tag = locale === 'de' ? 'de-DE' : 'en-US';
  const number = (value: number, digits = 0) => value.toLocaleString(tag, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  /** A throughput in MiB/s as GiB/s from 1 GiB/s up, else as MiB/s. */
  const rate = (mibps: number) => (mibps >= 1024 ? `${number(mibps / 1024, 2)} GiB/s` : `${number(mibps)} MiB/s`);
  const browsers = data.environments.filter(environment => ['chromium', 'firefox', 'webkit'].includes(environment.id));
  // Awaited 4 KiB appends per browser, with and without a 1 MiB write buffer.
  const buffer = Object.fromEntries(browsers.flatMap(environment => {
    const options = environment.options;
    const buffered = options['append 4 KiB awaited, writeBuffer 1 MiB'];
    const plain = options['append 4 KiB awaited'];
    if (!buffered || !plain) throw new Error(`figures: ${environment.id} lacks the write-buffer options`);
    const key = environment.id[0]!.toUpperCase() + environment.id.slice(1);
    return [[`wbOn${key}`, rate(buffered.median)], [`wbOff${key}`, rate(plain.median)]];
  }));
  const opfs = data.sizes.find(size => size.entry === 'defuss-storage/opfs');
  if (!opfs || browsers.length !== 3) throw new Error('figures: incomplete site data');
  const overload = (version: string) => {
    const entry = data.overload.versions[version];
    if (!entry) throw new Error(`figures: no overload figures for ${version}`);
    return entry;
  };
  // The hero chip: OPFS append throughput per block size in Chromium, medians of the measured release, in GiB/s.
  const chromium = data.environments.find(environment => environment.id === 'chromium');
  const opfsRow = (chunk: number) => {
    const row = chromium?.rows.find(entry => entry.version === data.benchVersion && entry.adapter === 'opfs' && entry.chunk === chunk);
    if (!row) throw new Error(`figures: no Chromium OPFS row for ${chunk} B`);
    return row;
  };
  const chip = (chunk: number) => `${number(opfsRow(chunk).append.median / 1024, 2)} GiB/s`;
  // Parallel throughput of whole 1 MiB-chunk scans and writes: one owner against 8 workers on one file,
  // the I/O alone (`read`) and with stand-in decoding or encoding work (`scan`, `write`).
  const parallel: Record<string, string> = {};
  for (const browser of data.parallel.browsers) {
    const key = browser.id[0]!.toUpperCase() + browser.id.slice(1);
    const cells = { [`parRead${key}1`]: browser.read['owning x1'], [`parRead${key}8`]: browser.read['shared x8'],
      [`parScan${key}1`]: browser.scan['owning x1'], [`parScan${key}8`]: browser.scan['shared x8'] };
    for (const [slot, value] of Object.entries(cells)) {
      if (value === undefined) throw new Error(`figures: ${browser.id} lacks ${slot}`);
      parallel[slot] = rate(value);
    }
  }
  const chromiumWrite = data.parallel.browsers.find(browser => browser.id === 'chromium')?.write;
  if (!chromiumWrite?.['shared file x8'] || !chromiumWrite['one file x1'] || !chromiumWrite['own files x8']) throw new Error('figures: incomplete parallel write figures');
  const MiB1 = 1048576;
  return {
    version: data.packageVersion,
    benchVersion: data.benchVersion,
    baseVersion: BASE_VERSION,
    chip4k: chip(4096),
    chip64k: chip(65536),
    chip1m: chip(1048576),
    // The hero's write, read and seek figures: OPFS in Chromium, 1 MiB blocks, medians of the measured release;
    // the seek is the mean random 4 KiB readInto on the same file.
    chipStream1m: `${number(opfsRow(MiB1).stream.median / 1024, 2)} GiB/s`,
    chipSeek: `${number(opfsRow(MiB1).readInto.mean, 1)} µs`,
    ...buffer,
    opfsGzip: `${number(opfs.gzip / 1000, 1)} kB`,
    cpu: data.cpu,
    cpus: number(data.logicalCpus),
    benchDate: new Date(data.generatedAt).toLocaleDateString(tag, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }),
    overloadCalls: number(data.overload.calls),
    overloadChunk: `${number(data.overload.chunkBytes / 1024)} KiB`,
    overloadAccepted: number(overload(data.benchVersion).accepted),
    overloadRejected: number(overload(data.benchVersion).queueFull),
    peakNew: `${number(overload(data.benchVersion).arrayBuffers / MB)} MB`,
    peakOld: `${number(overload(BASE_VERSION).arrayBuffers / MB)} MB`,
    ...parallel,
    parWriteChromium1: rate(chromiumWrite['one file x1']),
    parWriteChromium8: rate(chromiumWrite['shared file x8']),
    parOwnWriteChromium8: rate(chromiumWrite['own files x8']),
    parDataset: `${number(data.parallel.datasetBytes / MiB)} MiB`,
    parRuns: number(data.parallel.runs),
    largeMiB: `${number(data.large.bytes / MiB)} MiB`,
    heapMiB: `${number(data.large.heapLimitMiB)} MiB`,
    rssMB: `${number(data.large.maxRssBytes / MB)} MB`,
    // Bar widths of the large-file cards, as shares of the file size (CSS percentages, locale-neutral).
    heapShare: `${(data.large.heapLimitMiB * MiB / data.large.bytes * 100).toFixed(2)}%`,
    rssShare: `${(data.large.maxRssBytes / data.large.bytes * 100).toFixed(2)}%`,
  };
}

const SLOT = /\{\{(\w+)\}\}/g;

/** Fills `{{name}}` slots in `text`; an unknown slot throws, so a typo cannot ship. */
export function fillSlots(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(SLOT, (_slot, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`figures: unknown slot {{${name}}}`);
    return value;
  });
}

/** `strings` with every slot filled, each language with its own number format. */
export function withFigures(strings: Strings, data: SiteData): Strings {
  const en = figures(data, 'en');
  const de = figures(data, 'de');
  return Object.fromEntries(Object.entries(strings).map(([key, entry]) => [key, { en: fillSlots(entry.en, en), de: fillSlots(entry.de, de) }]));
}
