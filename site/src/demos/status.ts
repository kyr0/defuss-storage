// A status line that re-renders in the new language after a switch: it stores
// the message key and values, not the rendered sentence.
// VERIFIED: (site e2e, three engines) the benchmark progress and the OPFS notice
// render through it; demo results go to notify() below.
import { currentLocale, onLocaleChange } from '../locale.ts';
import { message, type MessageKey } from '../messages.ts';
import { plainText, renderText } from '../inline-code.ts';

export type Values = Readonly<Record<string, string | number>>;
export type ValueFactory = () => Values;

export interface StatusLine {
  /** Shows `key`; `values` may be a function so numbers are formatted in the language shown. */
  set(key: MessageKey, values?: Values | ValueFactory, tone?: 'error' | 'ok'): void;
  clear(): void;
}

export function statusLine(element: HTMLElement): StatusLine {
  let last: { key: MessageKey; values: Values | ValueFactory; tone?: 'error' | 'ok' } | undefined;
  const render = () => {
    if (!last) { element.textContent = ''; delete element.dataset.tone; return; }
    const values = typeof last.values === 'function' ? last.values() : last.values;
    renderText(element, message(currentLocale(), last.key, values));
    if (last.tone) element.dataset.tone = last.tone;
    else delete element.dataset.tone;
  };
  onLocaleChange(render);
  return {
    set(key, values = {}, tone) { last = { key, values, tone }; render(); },
    clear() { last = undefined; render(); },
  };
}

/** Shows the page-wide notice that the demos run on memory because this context has no OPFS. */
export function showMemoryFallback(): void {
  const alert = document.querySelector<HTMLElement>('.st-opfs-alert');
  const text = alert?.querySelector<HTMLElement>('.st-opfs-text');
  if (!alert || !text || !alert.hidden) return;
  alert.hidden = false;
  statusLine(text).set('opfsMissing');
}

type Toaster = { configure(options: { stack: 'pile'; position: 'top-right' }): unknown; show(options: { title: string; description: string; variant: 'success' | 'info' | 'destructive'; duration: number }): HTMLElement };
let toaster: Toaster | undefined;

/**
 * Shows a demo result as a defuss-shadcn toast. Toasts pile up top-right
 * below the floating header (the newest in front, hover fans them out); the
 * bottom-right corner belongs to the scroll-top button. Why toasts instead of a line under the controls: a result is
 * an event, and the demo keeps its height while results come and go. The
 * text is formatted in the language shown when it appears; it is gone before
 * a later switch matters. VERIFIED: (site e2e) persistence, backpressure and
 * playground results appear as toasts in three engines.
 */
export function notify(title: MessageKey, key: MessageKey, values: Values = {}, tone?: 'error' | 'ok'): void {
  if (!toaster) {
    toaster = (globalThis as unknown as { df$: { shadcn: { toast: Toaster } } }).df$.shadcn.toast;
    toaster.configure({ stack: 'pile', position: 'top-right' });
    // The region's label follows the language like every other attribute.
    const region = document.getElementById('toast-container');
    const label = () => region?.setAttribute('aria-label', region.getAttribute(`data-i18n-aria-label-${currentLocale()}`) ?? '');
    onLocaleChange(label);
  }
  const locale = currentLocale();
  const description = message(locale, key, values);
  const toast = toaster.show({
    title: message(locale, title), description: plainText(description),
    variant: tone === 'error' ? 'destructive' : tone === 'ok' ? 'success' : 'info', duration: tone === 'error' ? 8000 : 5000,
  });
  // The toaster writes the description as plain text; set its codes in the code font.
  const text = toast.querySelector('.toast-description');
  if (text) renderText(text, description);
}
