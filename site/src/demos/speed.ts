// The live benchmark (#run on the landing page): the same append, stream and readInto
// cases as the recorded browser report, run in this browser's OPFS, next to the
// recorded figures of the matching engine. VERIFIED: (site e2e, three engines)
// all six cases finish and render next to the recorded report.
import data from 'virtual:site-data';
import type { Environment } from '../../build/data.ts';
import { described, labelOf, marked, showChart, text } from '../charts.ts';
import { plainText, renderText } from '../inline-code.ts';
import { runOption } from '../chart-options.ts';
import { formatMs, formatNumber, onLocaleChange } from '../locale.ts';
import { demoWorker, DemoError } from './client.ts';
import type { BenchCase } from './protocol.ts';
import { showMemoryFallback, statusLine } from './status.ts';

const CASE_LABEL: Record<BenchCase['id'], string> = {
  append4k: 'caseAppend4k', append4kBuffered: 'caseAppend4kBuffered', append1mCopy: 'caseAppend1mCopy',
  append1mTransfer: 'caseAppend1mTransfer', stream64k: 'caseStream64k', readInto4k: 'caseReadInto4k',
};

/** The recorded engine closest to this browser, by user agent (only used to pick a comparison). */
export function engineFor(userAgent: string): Environment['id'] {
  if (/firefox\//i.test(userAgent)) return 'firefox';
  if (/(chrome|chromium|crios|edg)\//i.test(userAgent)) return 'chromium';
  if (/applewebkit\//i.test(userAgent)) return 'webkit';
  return 'chromium';
}

/** The recorded value of one case in `environment`. */
export function recorded(environment: Environment, id: BenchCase['id']): number | null {
  const option = (key: string) => environment.options[key]?.median ?? null;
  const row = environment.rows.find(entry => entry.version === '0.2.0' && entry.adapter === 'opfs' && entry.chunk === (id === 'stream64k' ? 65536 : 4096));
  switch (id) {
    case 'append4k': return option('append 4 KiB awaited');
    case 'append4kBuffered': return option('append 4 KiB awaited, writeBuffer 1 MiB');
    case 'append1mCopy': return option('append 1 MiB awaited, copy');
    case 'append1mTransfer': return option('append 1 MiB awaited, transfer');
    case 'stream64k': return row?.stream.median ?? null;
    case 'readInto4k': return row?.readInto.mean ?? null;
  }
}

export function initSpeed(root: HTMLElement): void {
  const button = root.querySelector<HTMLButtonElement>('[data-action="bench"]')!;
  const progress = root.querySelector<HTMLProgressElement>('[data-progress]')!;
  const chartElement = root.querySelector<HTMLElement>('[data-chart-id="run"]')!;
  const table = root.querySelector<HTMLTableElement>('.st-run-table')!;
  const engineNote = root.querySelector<HTMLElement>('[data-engine]')!;
  const status = statusLine(root.querySelector<HTMLElement>('[data-status]')!);
  const environment = data.environments.find(entry => entry.id === engineFor(navigator.userAgent))!;
  let last: BenchCase[] | undefined;

  // The recorded run's browser and machine; memory as the machine reports it (48 GiB shows as 48 GB, as the vendor labels it).
  const machine = () => `${environment.runtime}, ${data.cpu} ${formatNumber(data.memoryBytes / 2 ** 30)} GB`;
  const renderEngine = () => { engineNote.textContent = text('engineGuess', { engine: machine() }); };
  const render = async (still = false) => {
    renderEngine();
    if (!last) return;
    const rows = last.map(entry => ({ entry, label: marked(CASE_LABEL[entry.id]), recorded: recorded(environment, entry.id) }));
    table.tBodies[0]!.replaceChildren(...rows.map(({ entry, label, recorded: value }) => {
      const tr = document.createElement('tr');
      tr.className = 'table-row';
      const unit = entry.unit === 'µs' ? ' µs' : ' MiB/s';
      const digits = entry.unit === 'µs' ? 2 : 0;
      for (const [index, content] of [label, `${formatNumber(entry.value, digits)}${unit}`, value == null ? '-' : `${formatNumber(value, digits)}${unit}`].entries()) {
        const cell = document.createElement(index === 0 ? 'th' : 'td');
        cell.className = index === 0 ? 'table-head' : 'table-cell';
        if (index === 0) cell.setAttribute('scope', 'row');
        renderText(cell, content);
        tr.append(cell);
      }
      return tr;
    }));
    table.hidden = false;
    engineNote.hidden = false;
    chartElement.hidden = false;
    const throughput = rows.filter(row => row.entry.unit === 'MiB/s').map(row => ({ label: plainText(row.label), yours: row.entry.value, recorded: row.recorded }));
    await showChart(chartElement, described(runOption(throughput, text, environment.runtime), labelOf(chartElement)), still);
  };
  onLocaleChange(() => void render(true));
  renderEngine();

  button.addEventListener('click', async () => {
    button.disabled = true;
    progress.value = 0;
    const started = performance.now();
    try {
      const result = await demoWorker().call('bench:run', {}, (fraction, step) => {
        progress.value = Math.round(fraction * 100);
        status.set('benchRunning', { step: marked(CASE_LABEL[step as BenchCase['id']] ?? 'working') });
      });
      if (result.backend === 'memory') showMemoryFallback();
      last = result.cases;
      progress.value = 100;
      status.set('benchDone', () => ({ ms: formatMs(performance.now() - started) }), 'ok');
      await render();
    } catch (error) {
      status.set('ownerError', { code: error instanceof DemoError ? error.code : String(error) }, 'error');
    } finally {
      button.disabled = false;
    }
  });
  root.dataset.ready = '';
}
