// Light and dark theme. The inline script in index.html applies the saved
// choice (or the system preference) before first paint, so the page never
// flashes the wrong theme while modules load; this module keeps the toggle, the
// system preference and other listeners in sync afterwards. VERIFIED: (site e2e)
// the system preference applies and a toggle is remembered across loads.

const KEY = 'st-theme';
const media = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<(dark: boolean) => void>();

export const isDark = (): boolean => document.documentElement.classList.contains('dark');

function saved(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

function apply(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  const toggle = document.querySelector<HTMLInputElement>('#theme-toggle');
  if (toggle) toggle.checked = dark;
  for (const listener of listeners) listener(dark);
}

/** Sets the theme on the visitor's request and remembers it. */
export function setTheme(dark: boolean): void {
  try { localStorage.setItem(KEY, dark ? 'dark' : 'light'); } catch { /* private mode: the choice lasts for this page */ }
  apply(dark);
}

/** Calls `listener` after every theme change (charts and the shader recolour themselves). */
export function onThemeChange(listener: (dark: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initTheme(): void {
  const toggle = document.querySelector<HTMLInputElement>('#theme-toggle');
  if (toggle) {
    toggle.checked = isDark();
    toggle.addEventListener('change', () => setTheme(toggle.checked));
  }
  // Without a saved choice the page follows the system setting live.
  media.addEventListener('change', event => { if (!saved()) apply(event.matches); });
}
