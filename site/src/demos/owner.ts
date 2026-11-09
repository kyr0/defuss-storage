// Ownership demo: two real workers race for one OPFS file. Opening takes a Web
// Lock, so the second opener gets BUSY until the first closes or is terminated.
// VERIFIED: (site e2e, three engines) BUSY, then ownership after terminate.
import { currentLocale, onLocaleChange } from '../locale.ts';
import { message, type MessageKey } from '../messages.ts';
import { DemoError, startWorker, type DemoWorker } from './client.ts';
import { backendBar } from './backend.ts';
import { showMemoryFallback } from './status.ts';
import { renderText } from '../inline-code.ts';

type State = 'idle' | 'owns' | 'busy' | 'closed' | 'gone' | 'error';
const STATE_MESSAGE: Record<State, MessageKey> = {
  idle: 'ownerIdle', owns: 'ownerOwns', busy: 'ownerBusy', closed: 'ownerClosed', gone: 'ownerGone', error: 'ownerError',
};

interface Slot { readonly name: 'A' | 'B'; readonly element: HTMLElement; worker?: DemoWorker; state: State; code?: string }

export function initOwner(root: HTMLElement): void {
  const stage = root.querySelector<HTMLElement>('.st-owner-stage')!;
  const log = root.querySelector<HTMLOListElement>('.st-owner-log')!;
  const entries: { slot: 'A' | 'B'; state: State; code?: string; time: string }[] = [];
  const slots: Slot[] = (['a', 'b'] as const).map(id => ({
    name: id.toUpperCase() as 'A' | 'B', element: root.querySelector<HTMLElement>(`[data-worker="${id}"]`)!, state: 'idle',
  }));

  const text = (state: State, code?: string) => message(currentLocale(), STATE_MESSAGE[state], { code: code ?? '' });
  const render = () => {
    for (const slot of slots) {
      const badge = slot.element.querySelector<HTMLElement>('.st-worker-state')!;
      badge.dataset.state = slot.state;
      renderText(badge, text(slot.state, slot.code));
    }
    stage.dataset.owner = slots.find(slot => slot.state === 'owns')?.name.toLowerCase() ?? '';
    log.replaceChildren(...entries.slice(-6).map(entry => {
      const item = document.createElement('li');
      item.dataset.state = entry.state;
      renderText(item, `${entry.time}  ${entry.slot}: ${text(entry.state, entry.code)}`);
      return item;
    }));
  };
  const record = (slot: Slot, state: State, code?: string) => {
    slot.state = state;
    slot.code = code;
    entries.push({ slot: slot.name, state, code, time: new Date().toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
    render();
  };
  onLocaleChange(render);

  for (const slot of slots) {
    const button = (action: string) => slot.element.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
    button('open').addEventListener('click', async () => {
      slot.worker ??= startWorker();
      try {
        const { backend } = await slot.worker.call('owner:open', {});
        if (backend === 'memory') showMemoryFallback();
        record(slot, 'owns');
      } catch (error) {
        const code = error instanceof DemoError ? error.code : 'ERROR';
        record(slot, code === 'BUSY' ? 'busy' : 'error', code);
      }
    });
    button('close').addEventListener('click', async () => {
      if (!slot.worker || slot.state !== 'owns') return;
      await slot.worker.call('owner:close', {});
      record(slot, 'closed');
    });
    button('terminate').addEventListener('click', () => {
      if (!slot.worker) return;
      slot.worker.terminate();
      slot.worker = undefined;
      record(slot, 'gone');
    });
  }
  render();
  // Only OPFS shares a file between workers: Memory and Filesystem show a note instead of the stage.
  backendBar(root, () => {}, { notes: ['memory', 'file'] });
  root.dataset.ready = '';
}
