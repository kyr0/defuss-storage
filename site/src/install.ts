// Install commands: the toggle group picks the package manager (bun by
// default) and the choice is remembered; copy buttons copy the visible command
// and the agent prompt as plain text. VERIFIED: (site e2e) the toggle, the
// remembered choice and both clipboard copies.
import { currentLocale } from './locale.ts';
import { message } from './messages.ts';

const KEY = 'st-pm';

/** The command text of a mockup-code window: its lines without prompts. */
const commandText = (window: Element): string => [...window.querySelectorAll('pre code')].map(code => code.textContent ?? '').join('\n');

function copyButton(button: HTMLButtonElement, read: () => string): void {
  const label = button.querySelector('span')!;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(read());
      label.textContent = message(currentLocale(), 'copied');
      // Back to the label in the language shown then, from its defuss-i18n template.
      setTimeout(() => {
        const template = button.querySelector<HTMLTemplateElement>(`template[data-i18n-locale="${currentLocale()}"]`);
        if (template) label.innerHTML = template.innerHTML;
      }, 1500);
    } catch { /* clipboard blocked: the text stays selectable */ }
  });
}

export function initInstall(): void {
  const root = document.querySelector<HTMLElement>('[data-install]');
  if (!root) return;
  const group = root.querySelector<HTMLElement>('.toggle-group')!;
  const windows = [...root.querySelectorAll<HTMLElement>('[data-pm]')];
  const show = (pm: string) => { for (const window of windows) window.hidden = window.dataset.pm !== pm; };
  const select = (pm: string) => {
    for (const toggle of group.querySelectorAll<HTMLButtonElement>('.toggle')) toggle.setAttribute('aria-pressed', String(toggle.value === pm));
    show(pm);
  };
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* private mode */ }
  if (saved && windows.some(window => window.dataset.pm === saved)) select(saved);
  new MutationObserver(() => {
    const pm = group.querySelector<HTMLButtonElement>('.toggle[aria-pressed="true"]')?.value;
    if (!pm) return;
    show(pm);
    try { localStorage.setItem(KEY, pm); } catch { /* private mode */ }
  }).observe(group, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });

  copyButton(root.querySelector<HTMLButtonElement>('[data-copy-install]')!, () => commandText(windows.find(window => !window.hidden)!));
  const prompt = document.querySelector<HTMLButtonElement>('[data-copy-prompt]');
  if (prompt) copyButton(prompt, () => commandText(document.querySelector('[data-agent-prompt]')!).replace(/\n/g, ' '));
}
