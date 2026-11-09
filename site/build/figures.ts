// The numbers quoted in the copy ({{name}} slots), derived from the site data
// and formatted per language. Deriving them keeps the prose and the charts on
// the same report: a new benchmark run updates both.
import type { SiteData } from './data.ts';
import type { Locale, Strings } from './i18n.ts';

const MB = 1e6;
const MiB = 1024 * 1024;

/** Every slot value for `locale`. */
export function figures(data: SiteData, locale: Locale): Record<string, string> {
  const tag = locale === 'de' ? 'de-DE' : 'en-US';
  const number = (value: number, digits = 0) => value.toLocaleString(tag, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const factor = (value: number) => number(value, value < 10 ? 1 : 0);
  const browsers = data.environments.filter(environment => ['chromium', 'firefox', 'webkit'].includes(environment.id));
  const gains = browsers.map(environment => {
    const options = environment.options;
    const buffered = options['append 4 KiB awaited, writeBuffer 1 MiB'];
    const plain = options['append 4 KiB awaited'];
    if (!buffered || !plain) throw new Error(`figures: ${environment.id} lacks the write-buffer options`);
    return buffered.median / plain.median;
  });
  const opfs = data.sizes.find(size => size.entry === 'defuss-storage/opfs');
  if (!opfs || gains.length !== 3) throw new Error('figures: incomplete site data');
  const overload = (version: string) => {
    const entry = data.overload.versions[version];
    if (!entry) throw new Error(`figures: no overload figures for ${version}`);
    return entry;
  };
  // The hero chip: OPFS append throughput per block size in Chromium, 0.2.0 medians, in GiB/s.
  const chromium = data.environments.find(environment => environment.id === 'chromium');
  const opfsRow = (chunk: number) => {
    const row = chromium?.rows.find(entry => entry.version === '0.2.0' && entry.adapter === 'opfs' && entry.chunk === chunk);
    if (!row) throw new Error(`figures: no Chromium OPFS row for ${chunk} B`);
    return row;
  };
  const chip = (chunk: number) => `${number(opfsRow(chunk).append.median / 1024, 2)} GiB/s`;
  const MiB1 = 1048576;
  return {
    version: data.packageVersion,
    chip4k: chip(4096),
    chip64k: chip(65536),
    chip1m: chip(1048576),
    // The hero's write, read and seek figures: OPFS in Chromium, 1 MiB blocks, 0.2.0 medians;
    // the seek is the mean random 4 KiB readInto on the same file.
    chipStream1m: `${number(opfsRow(MiB1).stream.median / 1024, 2)} GiB/s`,
    chipSeek: `${number(opfsRow(MiB1).readInto.mean, 1)} µs`,
    wbMin: factor(Math.min(...gains)),
    wbMax: factor(Math.max(...gains)),
    opfsGzip: `${number(opfs.gzip / 1000, 1)} kB`,
    cpu: data.cpu,
    cpus: number(data.logicalCpus),
    benchDate: new Date(data.generatedAt).toLocaleDateString(tag, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }),
    overloadCalls: number(data.overload.calls),
    overloadChunk: `${number(data.overload.chunkBytes / 1024)} KiB`,
    overloadAccepted: number(overload('0.2.0').accepted),
    overloadRejected: number(overload('0.2.0').queueFull),
    peakNew: `${number(overload('0.2.0').arrayBuffers / MB)} MB`,
    peakOld: `${number(overload('0.1.0').arrayBuffers / MB)} MB`,
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
