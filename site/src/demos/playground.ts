// Playground: edit a script, run it in a fresh worker, read its console.
// VERIFIED: (site e2e, three engines) the appendChunks and BUSY examples run.
import { createEditor } from '../editor.ts';
import { formatMs } from '../locale.ts';
import { presets } from '../snippets.ts';
import { notify } from './status.ts';

/** Long enough for the examples (well under a second in the e2e runs), short enough to stop a runaway loop. */
const TIMEOUT_MS = 20_000;
type Preset = keyof typeof presets;

export function initPlayground(root: HTMLElement): void {
  const select = root.querySelector<HTMLSelectElement>('#play-preset')!;
  const output = root.querySelector<HTMLElement>('[data-console]')!;
  const runButton = root.querySelector<HTMLButtonElement>('[data-action="run"]')!;
  const editor = createEditor(root.querySelector<HTMLElement>('[data-editor]')!, presets.chunks);
  let worker: Worker | undefined;

  const line = (text: string, tone = 'default') => {
    const pre = document.createElement('pre');
    pre.dataset.prefix = '>';
    if (tone !== 'default') pre.dataset.tone = tone;
    const code = document.createElement('code');
    code.textContent = text;
    pre.append(code);
    output.append(pre);
    output.scrollTop = output.scrollHeight;
  };
  const finish = () => { worker?.terminate(); worker = undefined; runButton.disabled = false; };

  const run = () => {
    if (worker) return;
    output.replaceChildren();
    runButton.disabled = true;
    worker = new Worker(new URL('./playground.worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { finish(); notify('toastPlayground', 'playgroundTimeout', { ms: formatMs(TIMEOUT_MS) }, 'error'); }, TIMEOUT_MS);
    worker.onmessage = ({ data }: MessageEvent<{ type: 'line' | 'done' | 'error'; text?: string; tone?: string; message?: string; ms?: number }>) => {
      if (data.type === 'line') { line(data.text ?? '', data.tone); return; }
      clearTimeout(timer);
      finish();
      if (data.type === 'done') notify('toastPlayground', 'playgroundDone', { ms: formatMs(data.ms ?? 0) }, 'ok');
      else { line(data.message ?? '', 'destructive'); notify('toastPlayground', 'playgroundError', { message: data.message ?? '' }, 'error'); }
    };
    worker.onerror = event => {
      clearTimeout(timer);
      finish();
      notify('toastPlayground', 'playgroundError', { message: event.message || 'worker failed' }, 'error');
    };
    worker.postMessage({ source: editor.value });
  };

  runButton.addEventListener('click', run);
  root.querySelector('[data-action="reset"]')!.addEventListener('click', () => editor.set(presets[select.value as Preset]));
  select.addEventListener('change', () => editor.set(presets[select.value as Preset]));
  root.querySelector('.code-example-src')!.addEventListener('keydown', event => {
    const key = event as KeyboardEvent;
    if (key.key === 'Enter' && (key.ctrlKey || key.metaKey)) { key.preventDefault(); run(); }
  });
  root.querySelector('[data-copy-editor]')!.addEventListener('click', () => void navigator.clipboard?.writeText(editor.value));
  // Listeners are attached: the e2e suite and the page may use the demo now.
  root.dataset.ready = '';
}
