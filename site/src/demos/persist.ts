// Persistence demo: append lines to journal.log, watch the bytes land in a hex
// view, reload the page and find them again on OPFS, or find the file empty on
// Memory. VERIFIED: (site e2e, three engines) the appended line is still there
// after a reload on OPFS, and a line appended on Memory is gone after one.
import { hexRows } from '../hex.ts';
import { formatBytes, formatMs, formatNumber } from '../locale.ts';
import { backendBar } from './backend.ts';
import { demoWorker, DemoError } from './client.ts';
import type { FileView } from './protocol.ts';
import { notify, showMemoryFallback } from './status.ts';

const RELOAD_MARK = 'st-persist-reload';
/** True once after the demo's own reload button: the toast after a reload answers that click. */
function takeReloadMark(): boolean {
  try {
    const marked = sessionStorage.getItem(RELOAD_MARK) === '1';
    sessionStorage.removeItem(RELOAD_MARK);
    return marked;
  } catch { return false; }
}

export function initPersist(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>('.st-persist-form')!;
  const input = form.querySelector<HTMLInputElement>('input')!;
  const hex = root.querySelector<HTMLElement>('[data-hex]')!;
  const sizeLabel = root.querySelector<HTMLElement>('[data-size-label]')!;
  const worker = demoWorker();

  const backend = backendBar(root, () => void run(load), { folder: true });
  const on = () => ({ backend: backend() ?? 'opfs' });
  const render = (view: FileView, freshFrom?: number) => {
    if (view.backend !== on().backend) showMemoryFallback();
    sizeLabel.textContent = formatBytes(view.size);
    sizeLabel.dataset.bytes = String(view.size);
    hex.replaceChildren(...hexRows(view.tail, view.tailOffset, freshFrom).map(row => {
      const line = document.createElement('div');
      line.className = 'st-hex-row';
      const offset = document.createElement('span');
      offset.className = 'st-hex-offset';
      offset.textContent = row.offset;
      const bytes = document.createElement('span');
      bytes.className = 'st-hex-bytes';
      for (const cell of row.bytes) {
        const byte = document.createElement('span');
        byte.textContent = cell.hex;
        if (cell.fresh) byte.className = 'st-fresh';
        bytes.append(byte);
      }
      const ascii = document.createElement('span');
      ascii.className = 'st-hex-ascii';
      ascii.textContent = row.ascii;
      line.append(offset, bytes, ascii);
      return line;
    }));
    if (!view.size) hex.textContent = '';
    hex.dataset.empty = String(view.size === 0);
  };
  const fail = (error: unknown) => notify('toastPersist', 'ownerError', { code: error instanceof DemoError ? error.code : String(error) }, 'error');
  // Append stays disabled while the line is empty: an empty append would still write its newline.
  const append = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const syncAppend = () => { append.disabled = !input.value.trim(); };
  input.addEventListener('input', syncAppend);
  const busy = (on: boolean) => {
    for (const button of root.querySelectorAll('button')) button.disabled = on;
    if (!on) syncAppend();
  };
  const run = async (task: () => Promise<void>) => {
    busy(true);
    try { await task(); } catch (error) { fail(error); } finally { busy(false); }
  };

  const load = async () => { if (backend()) render(await worker.call('persist:state', on())); };
  void run(async () => {
    await load();
    // No toast on load; only after a reload the visitor asked for with the demo's button.
    if (!takeReloadMark() || !backend()) return;
    const size = Number(sizeLabel.dataset.bytes ?? 0);
    if (size) notify('toastPersist', 'persistFound', { bytes: formatBytes(size) }, 'ok');
    else if (backend() === 'memory') notify('toastPersist', 'persistLost');
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    void run(async () => {
      const result = await worker.call('persist:append', { ...on(), text });
      render(result, result.offset);
      input.value = '';
      notify('toastPersist', 'appended', { bytes: formatBytes(result.byteLength), offset: formatNumber(result.offset), ms: formatMs(result.ms) }, 'ok');
    });
  });
  root.querySelector('[data-action="read"]')?.addEventListener('click', () => void run(async () => {
    const result = await worker.call('persist:read', on());
    render(result);
    notify('toastPersist', 'readBack', { bytes: formatBytes(Math.min(result.size, 64 * 1024)), ms: formatMs(result.ms) }, 'ok');
  }));
  root.querySelector('[data-action="truncate"]')?.addEventListener('click', () => void run(async () => {
    render(await worker.call('persist:truncate', on()));
    notify('toastPersist', 'cleared');
  }));
  root.querySelector('[data-action="reload"]')?.addEventListener('click', () => {
    try { sessionStorage.setItem(RELOAD_MARK, '1'); } catch { /* storage blocked: reload without the toast */ }
    location.reload();
  });
  // Listeners are attached: the e2e suite and the page may use the demo now.
  root.dataset.ready = '';
}
