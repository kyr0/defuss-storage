// The storage backend bar over each demo: Memory, OPFS or Filesystem. Demos
// run on Memory and OPFS. Filesystem shows a note, since a web page cannot open
// native files the way Node.js and Bun do; in browsers with a folder picker
// (Chromium), the note offers to pick a folder, and the demo then runs on it
// through createDirectoryStorage. The ownership demo also shows a note on
// Memory. Why the same demo on every backend instead of an OPFS-only page: one
// handle API over all of them is the package's point, and switching shows where
// they differ, such as what a reload leaves of a memory file. The choice is
// kept per demo for the session, so a reload returns to it.
// VERIFIED: (site e2e, three engines) the persistence demo runs on Memory, OPFS
// and a picked folder, and shows the Filesystem note with its controls inert.
import { canPickFolder, onFolderPicked, pickFolder, pickedFolder } from './folder.ts';
import type { Backend } from './protocol.ts';
import { notify } from './status.ts';

export type Choice = 'memory' | 'opfs' | 'file';
const CHOICES: readonly string[] = ['memory', 'opfs', 'file'];

export interface BackendBarOptions {
  /** Choices that show a note instead of the demo. Default: Filesystem. */
  readonly notes?: readonly Choice[];
  /** Whether the demo runs on a picked folder (Filesystem in browsers with a folder picker). */
  readonly folder?: boolean;
}

/**
 * Wires the bar in `root` and returns the current backend, or undefined while
 * a note shows. `change` runs after a switch to a backend the demo runs on, and
 * after a folder pick while Filesystem is chosen. The bar's toggles are buttons
 * inside `root`, so a demo that disables its buttons while busy also holds the
 * bar still until the run ends.
 */
export function backendBar(root: HTMLElement, change: (backend: Backend) => void, options: BackendBarOptions = {}): () => Backend | undefined {
  const notes = options.notes ?? ['file'];
  const folder = Boolean(options.folder) && canPickFolder();
  const group = root.querySelector<HTMLElement>('.st-backend')!;
  const key = `st-backend-${root.dataset.demo ?? ''}`;
  let choice: Choice = 'opfs';
  try {
    const saved = sessionStorage.getItem(key);
    if (saved && CHOICES.includes(saved)) choice = saved as Choice;
  } catch { /* storage blocked: start on OPFS */ }
  const current = (): Backend | undefined => {
    if (choice === 'file' && folder && pickedFolder()) return 'directory';
    return notes.includes(choice) ? undefined : (choice as Backend);
  };
  const apply = () => {
    for (const toggle of group.querySelectorAll<HTMLButtonElement>('.toggle')) toggle.setAttribute('aria-pressed', String(toggle.value === choice));
    const note = current() ? undefined : choice;
    for (const element of root.querySelectorAll<HTMLElement>('[data-backend-note]')) element.hidden = element.dataset.backendNote !== note;
    for (const element of root.querySelectorAll<HTMLElement>('[data-backend-view]')) element.hidden = note !== undefined;
    for (const element of root.querySelectorAll<HTMLElement>('[data-backend-controls]')) element.inert = note !== undefined;
    // The folder offer only where the browser has a picker and the demo can use it.
    for (const element of root.querySelectorAll<HTMLElement>('[data-folder-offer]')) element.hidden = !folder;
  };
  apply();
  new MutationObserver(() => {
    const pressed = group.querySelector<HTMLButtonElement>('.toggle[aria-pressed="true"]')?.value;
    // A second click on the pressed toggle releases it; keep the current choice pressed.
    if (!pressed) { apply(); return; }
    if (pressed === choice || !CHOICES.includes(pressed)) return;
    choice = pressed as Choice;
    try { sessionStorage.setItem(key, choice); } catch { /* the choice then lasts until the reload */ }
    apply();
    const backend = current();
    if (backend) change(backend);
  }).observe(group, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
  if (folder) {
    root.querySelector('[data-pick-folder]')?.addEventListener('click', () => {
      void pickFolder().then(picked => {
        if (picked) notify('toastFolder', 'folderPicked', { name: pickedFolder() ?? '' }, 'ok');
      }, (error: unknown) => notify('toastFolder', 'ownerError', { code: String((error as { name?: string }).name ?? error) }, 'error'));
    });
    // A pick in any demo serves every demo that runs on folders.
    onFolderPicked(() => { apply(); if (choice === 'file') change('directory'); });
  }
  return current;
}
