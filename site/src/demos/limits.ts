// Backpressure demo: fire N appends without awaiting and watch admission.
// The defaults fit the limits, so the first run admits every call; a lowered
// limit refuses the rest at once with QUEUE_FULL, and appendChunks writes all N
// by waiting. VERIFIED: (site e2e, three engines) defaults admit 64 of 64, a
// limit of 16 operations admits 16 and refuses 48, appendChunks writes 64.
import { formatMs, formatNumber } from '../locale.ts';
import { backendBar } from './backend.ts';
import { demoWorker, DemoError } from './client.ts';
import { notify, showMemoryFallback } from './status.ts';

export function initLimits(root: HTMLElement): void {
  const cells = root.querySelector<HTMLElement>('[data-cells]')!;
  const input = (name: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
  const settings = () => ({
    backend: backend() ?? 'opfs',
    calls: Number(input('calls').value), ops: Number(input('ops').value),
    chunk: Number(input('chunk').value), bytes: Number(input('bytes').value),
  });
  const draw = (states: readonly string[] = []) => {
    const { calls } = settings();
    cells.replaceChildren(...Array.from({ length: calls }, (_, index) => {
      const cell = document.createElement('i');
      cell.className = 'st-cell';
      const state = states[index];
      if (state) {
        cell.dataset.state = state;
        cell.style.setProperty('--i', String(index));
      }
      return cell;
    }));
  };
  const showCode = (which: 'fire' | 'chunks') => {
    for (const code of root.querySelectorAll<HTMLElement>('[data-limits-code]')) code.hidden = code.dataset.limitsCode !== which;
  };
  // A chunk larger than the byte budget could never be admitted: raise the budget with it.
  const fitBudget = () => {
    const bytes = input('bytes') as HTMLSelectElement;
    if (Number(bytes.value) < Number(input('chunk').value)) bytes.value = input('chunk').value;
  };
  input('chunk').addEventListener('change', fitBudget);
  input('bytes').addEventListener('change', fitBudget);
  for (const name of ['calls', 'ops']) {
    const range = input(name);
    range.addEventListener('input', () => {
      root.querySelector(`[data-out="${name}"]`)!.textContent = range.value;
      draw();
    });
  }
  const run = async (task: () => Promise<void>) => {
    for (const button of root.querySelectorAll('button')) button.disabled = true;
    try { await task(); } catch (error) {
      notify('toastLimits', 'ownerError', { code: error instanceof DemoError ? error.code : String(error) }, 'error');
    } finally { for (const button of root.querySelectorAll('button')) button.disabled = false; }
  };
  root.querySelector('[data-action="fire"]')!.addEventListener('click', () => void run(async () => {
    showCode('fire');
    const result = await demoWorker().call('limits:fire', settings());
    if (result.backend !== backend()) showMemoryFallback();
    draw(result.states);
    const admitted = result.states.filter(state => state === 'ok').length;
    const all = admitted === result.states.length;
    notify('toastLimits', all ? 'admittedAll' : 'admitted', { admitted: formatNumber(admitted), rejected: formatNumber(result.states.length - admitted), ms: formatMs(result.ms) }, all ? 'ok' : undefined);
  }));
  root.querySelector('[data-action="chunks"]')!.addEventListener('click', () => void run(async () => {
    showCode('chunks');
    const result = await demoWorker().call('limits:chunks', settings());
    if (result.backend !== backend()) showMemoryFallback();
    draw(Array.from({ length: result.count }, () => 'ok'));
    notify('toastLimits', 'chunksDone', { count: formatNumber(result.count), ms: formatMs(result.ms) }, 'ok');
  }));
  // A new backend starts with empty cells; the next run fills them.
  const backend = backendBar(root, () => draw(), { folder: true });
  draw();
  root.dataset.ready = '';
}
