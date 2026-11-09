// Seek demo: write up to a million variable-length records, keep each append's
// receipt as the index, then read any record with one readExactly at its
// offset. A defuss-shadcn virtual list shows the file: it renders only the rows
// on screen, and each of those is read from OPFS when it scrolls into view, so a
// million records cost the page as much as twenty. VERIFIED: (site e2e, three
// engines) the default run writes 1,000,000 records, the list shows records read
// from the file, and a seek lands on the requested record.
import { currentLocale, formatBytes, formatMs, formatNumber, onLocaleChange } from '../locale.ts';
import { message } from '../messages.ts';
import { backendBar } from './backend.ts';
import { demoWorker, DemoError } from './client.ts';
import type { SeekRow } from './protocol.ts';
import { notify, showMemoryFallback } from './status.ts';

interface VirtualList {
  setData(list: HTMLElement, count: number, renderRow?: (row: HTMLElement, index: number) => void): void;
}
interface VirtualListApi { setState(list: HTMLElement, name: 'default', config?: { index?: number }): unknown }

const shadcn = () => (globalThis as unknown as { df$: { shadcn: { virtualList: VirtualList; virtualListApi: VirtualListApi } } }).df$.shadcn;
const formatMicros = (micros: number): string => `${formatNumber(micros, micros < 10 ? 1 : 0)} µs`;
/** Rows kept in memory; older ones are read again when they come back into view. */
const CACHE_LIMIT = 4000;

export function initSeek(root: HTMLElement): void {
  const worker = demoWorker();
  const list = root.querySelector<HTMLElement>('.virtual-list')!;
  const records = root.querySelector<HTMLSelectElement>('[name="records"]')!;
  const generate = root.querySelector<HTMLButtonElement>('[data-action="generate"]')!;
  const progress = root.querySelector<HTMLProgressElement>('[data-progress]')!;
  const jump = root.querySelector<HTMLFormElement>('.st-seek-jump')!;
  const jumpInput = jump.querySelector<HTMLInputElement>('input')!;
  const stat = (name: string) => root.querySelector<HTMLElement>(`[data-stat="${name}"]`)!;
  const cache = new Map<number, SeekRow>();
  const wanted = new Set<number>();
  // Rows that just arrived from the file flash once, like fresh bytes in the hex view.
  let fresh = new Set<number>();
  let count = 0;
  let highlighted = -1;
  let fetching = false;
  let last: { records: number; bytes: number; writeMs: number; seekMicros: number } | undefined;

  const fail = (error: unknown) => notify('toastSeek', 'ownerError', { code: error instanceof DemoError ? error.code : String(error) }, 'error');
  const cell = (className: string, text: string) => { const span = document.createElement('span'); span.className = className; span.textContent = text; return span; };

  const renderRow = (row: HTMLElement, index: number) => {
    const entry = cache.get(index);
    row.classList.toggle('st-seek-hit', index === highlighted);
    row.classList.toggle('st-seek-fresh', fresh.has(index));
    // The byte offset leads each row, like the offset column of a hex view.
    if (!entry) { row.replaceChildren(cell('st-seek-offset', ''), cell('st-seek-text st-seek-pending', `#${String(index).padStart(7, '0')}`)); wanted.add(index); queueMicrotask(fetchWanted); return; }
    row.replaceChildren(cell('st-seek-offset', `@ ${formatNumber(entry.offset)}`), cell('st-seek-text', entry.text));
  };
  /** Reads the rows that scrolled into view, one readExactly each, in one worker round trip. */
  const fetchWanted = async () => {
    if (fetching || !wanted.size) return;
    fetching = true;
    const indices = [...wanted];
    wanted.clear();
    const from = Math.min(...indices);
    try {
      const { rows } = await worker.call('seek:rows', { from, count: Math.max(...indices) - from + 1 });
      if (cache.size > CACHE_LIMIT) cache.clear();
      for (const row of rows) cache.set(row.index, row);
      fresh = new Set(rows.map(row => row.index));
      shadcn().virtualList.setData(list, count, renderRow);
    } catch (error) { fail(error); } finally {
      fetching = false;
      if (wanted.size) void fetchWanted();
    }
  };
  const renderStats = () => {
    if (!last) return;
    stat('records').textContent = formatNumber(last.records);
    stat('size').textContent = formatBytes(last.bytes);
    // Records, not bytes, per second: each record is its own awaited append, which is the point.
    stat('write').textContent = `${formatNumber(last.records / (last.writeMs / 1000))}/s`;
    stat('seek').textContent = formatMicros(last.seekMicros);
  };
  // The empty-state text is the list's data attribute, which defuss-i18n does not translate: set it here.
  const emptyText = () => { list.dataset.emptyText = message(currentLocale(), 'seekEmpty'); };
  emptyText();
  onLocaleChange(() => { emptyText(); renderStats(); if (count) shadcn().virtualList.setData(list, count, renderRow); });

  // A new backend starts an empty list: the records of the last run belong to the other one.
  const reset = () => {
    count = 0; last = undefined; highlighted = -1; cache.clear();
    for (const name of ['records', 'size', 'write', 'seek']) stat(name).textContent = { records: '0', size: formatBytes(0), write: '0/s', seek: formatMicros(0) }[name]!;
    shadcn().virtualList.setData(list, 0, renderRow);
  };
  const backend = backendBar(root, reset, { folder: true });
  const busy = (on: boolean) => { for (const control of root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select')) control.disabled = on; };
  generate.addEventListener('click', async () => {
    busy(true);
    progress.hidden = false;
    progress.value = 0;
    try {
      const result = await worker.call('seek:generate', { backend: backend() ?? 'opfs', records: Number(records.value) }, value => { progress.value = value; });
      if (result.backend !== backend()) showMemoryFallback();
      last = result;
      count = result.records;
      cache.clear();
      highlighted = -1;
      jumpInput.max = String(count - 1);
      renderStats();
      shadcn().virtualList.setData(list, count, renderRow);
      notify('toastSeek', 'seekWritten', { records: formatNumber(result.records), bytes: formatBytes(result.bytes), ms: formatMs(result.writeMs), micros: formatMicros(result.seekMicros) }, 'ok');
    } catch (error) { fail(error); } finally { progress.hidden = true; busy(false); }
  });

  jump.addEventListener('submit', async event => {
    event.preventDefault();
    if (!count) { notify('toastSeek', 'seekFirst'); return; }
    const index = Number(jumpInput.value);
    if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
      notify('toastSeek', 'seekRange', { max: formatNumber(count - 1) });
      return;
    }
    try {
      const row = await worker.call('seek:jump', { index });
      cache.set(row.index, row);
      highlighted = index;
      shadcn().virtualList.setData(list, count, renderRow);
      shadcn().virtualListApi.setState(list, 'default', { index });
      // No toast: the highlighted row is the result, and a toast would cover the list.
    } catch (error) { fail(error); }
  });
  shadcn().virtualList.setData(list, 0, renderRow);
  root.dataset.ready = '';
}
