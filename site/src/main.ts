// Entry point: design system first, then theme, language and routing, then the
// interactive parts, each started when it is first needed.
// defuss-shadcn per component, not the all-in-one bundle: the page uses about 35 of
// its 300 components. VERIFIED: (vite build) CSS 1,185 kB to 396 kB, entry JS
// 719 kB to 244 kB, before compression.
import 'defuss-shadcn/dist/components/core.css';
import 'defuss-shadcn/dist/theme/utils/shapes.css';
import 'defuss-shadcn/dist/components/site-header/site-header.css';
import 'defuss-shadcn/dist/components/navigation-menu/navigation-menu.css';
import 'defuss-shadcn/dist/components/button/button.css';
import 'defuss-shadcn/dist/components/badge/badge.css';
import 'defuss-shadcn/dist/components/toggle-group/toggle-group.css';
import 'defuss-shadcn/dist/components/toggle/toggle.css';
import 'defuss-shadcn/dist/components/swap/swap.css';
import 'defuss-shadcn/dist/components/kbd/kbd.css';
import 'defuss-shadcn/dist/components/sheet/sheet.css';
import 'defuss-shadcn/dist/components/hero/hero.css';
import 'defuss-shadcn/dist/components/parallax/parallax.css';
import 'defuss-shadcn/dist/components/heading-anchor/heading-anchor.css';
import 'defuss-shadcn/dist/components/mockup-code/mockup-code.css';
import 'defuss-shadcn/dist/components/tabs/tabs.css';
import 'defuss-shadcn/dist/components/alert/alert.css';
import 'defuss-shadcn/dist/components/input/input.css';
import 'defuss-shadcn/dist/components/select/select.css';
import 'defuss-shadcn/dist/components/slider/slider.css';
import 'defuss-shadcn/dist/components/card/card.css';
import 'defuss-shadcn/dist/components/progress/progress.css';
import 'defuss-shadcn/dist/components/table/table.css';
import 'defuss-shadcn/dist/components/diagram/diagram.css';
import 'defuss-shadcn/dist/components/feature-details/feature-details.css';
import 'defuss-shadcn/dist/components/section-header/section-header.css';
import 'defuss-shadcn/dist/components/cta/cta.css';
import 'defuss-shadcn/dist/components/site-footer/site-footer.css';
import 'defuss-shadcn/dist/components/separator/separator.css';
import 'defuss-shadcn/dist/components/fab/fab.css';
import 'defuss-shadcn/dist/components/command/command.css';
import 'defuss-shadcn/dist/components/chart/chart.css';
import 'defuss-shadcn/dist/components/empty-state/empty-state.css';
import 'defuss-shadcn/dist/components/motion/motion.css';
import 'defuss-shadcn/dist/components/text-rotate/text-rotate.css';
import 'defuss-shadcn/dist/components/code-example/code-example.css';
import 'defuss-shadcn/dist/components/radial-progress/radial-progress.css';
import 'defuss-shadcn/dist/components/toast/toast.css';
import 'defuss-shadcn/dist/components/virtual-list/virtual-list.css';
import '@fontsource-variable/space-grotesk/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles.css';
import 'defuss-shadcn/dist/components/core.js';
import 'defuss-shadcn/dist/components/toggle/toggle.js';
import 'defuss-shadcn/dist/components/toggle-group/toggle-group.js';
import 'defuss-shadcn/dist/components/sheet/sheet.js';
import 'defuss-shadcn/dist/components/tabs/tabs.js';
import 'defuss-shadcn/dist/components/slider/slider.js';
import 'defuss-shadcn/dist/components/diagram/diagram.js';
import 'defuss-shadcn/dist/components/command/command.js';
import 'defuss-shadcn/dist/components/chart/chart.js';
import 'defuss-shadcn/dist/components/toast/toast.js';
import 'defuss-shadcn/dist/components/virtual-list/virtual-list.js';
import { initCharts } from './charts.ts';
import { initInstall } from './install.ts';
import { currentLocale, initLocale, isLocale } from './locale.ts';
import { go, initRouter, revealHash, switchLocale } from './router.ts';
import { isDark, initTheme, setTheme } from './theme.ts';

/** Runs `start` once `element` is within `margin` of the viewport. */
function whenVisible(element: Element | null, start: () => void, margin = '300px 0px'): void {
  if (!element) return;
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    start();
  }, { rootMargin: margin });
  observer.observe(element);
}

/** Runs `start` the first time a hidden tab panel is shown. */
function whenShown(panel: HTMLElement | null, start: () => void): void {
  if (!panel) return;
  if (!panel.hidden) { start(); return; }
  const observer = new MutationObserver(() => { if (!panel.hidden) { observer.disconnect(); start(); } });
  observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
}

function initKeys(): void {
  // Show the platform's modifier: Command on Apple devices, Ctrl elsewhere.
  if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent))
    for (const key of document.querySelectorAll('[data-mod]')) key.textContent = '⌘';
}

function initCommands(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#cmd');
  if (!dialog) return;
  dialog.addEventListener('click', event => {
    const item = (event.target as Element).closest<HTMLElement>('.command-item');
    if (!item) return;
    dialog.close();
    if (item.dataset.go) go(item.dataset.go);
    else if (item.dataset.command === 'theme') setTheme(!isDark());
    else if (item.dataset.command === 'locale') switchLocale(currentLocale() === 'de' ? 'en' : 'de');
  });
}

function initLanguageSelect(): void {
  const select = document.querySelector<HTMLSelectElement>('.st-lang');
  select?.addEventListener('change', () => { if (isLocale(select.value) && select.value !== currentLocale()) switchLocale(select.value); });
}

function initDemos(): void {
  const demo = (name: string) => document.querySelector<HTMLElement>(`[data-demo="${name}"]`);
  whenVisible(demo('persist'), () => void import('./demos/persist.ts').then(module => module.initPersist(demo('persist')!)));
  whenShown(document.getElementById('panel-seek'), () => void import('./demos/seek.ts').then(module => module.initSeek(demo('seek')!)));
  whenShown(document.getElementById('panel-owner'), () => void import('./demos/owner.ts').then(module => module.initOwner(demo('owner')!)));
  whenShown(document.getElementById('panel-limits'), () => void import('./demos/limits.ts').then(module => module.initLimits(demo('limits')!)));
  whenShown(document.getElementById('panel-playground'), () => void import('./demos/playground.ts').then(module => module.initPlayground(demo('playground')!)));
  whenVisible(demo('speed'), () => void import('./demos/speed.ts').then(module => module.initSpeed(demo('speed')!)));
}

async function main(): Promise<void> {
  const lang = document.documentElement.lang;
  initLocale(isLocale(lang) ? lang : 'en');
  initTheme();
  initKeys();
  initCommands();
  initLanguageSelect();
  // The router accepts only http(s) URLs; a page opened from disk keeps its prerendered view.
  if (location.protocol !== 'file:') await initRouter();
  initInstall();
  initCharts();
  initDemos();
  const canvas = document.querySelector<HTMLCanvasElement>('.st-shader');
  whenVisible(canvas, () => void import('./shader.ts').then(module => module.startShader(canvas!)), '200px 0px');
  revealHash();
  document.documentElement.dataset.ready = '';
}

void main();
