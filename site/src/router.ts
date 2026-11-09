// Client-side routing with defuss-dom-router. Every route's HTML is prerendered
// (build/pages.ts), so the router's job is navigation inside one document:
// switching the visible view, the language and the document title without a
// reload, and keeping deep links (/de/#run) exact. VERIFIED: (site
// e2e) views switch in one document, Back returns, anchors and tab links land.
import { createRouter, type Router, type RouteRequest } from 'defuss-dom-router';
import type { Locale } from '../build/i18n.ts';
import { currentLocale, isLocale, preferredLocale, rememberLocale, setLocale } from './locale.ts';
import { meta, type View } from './messages.ts';

export interface Screen { readonly view: View; readonly locale: Locale }

const VIEW_EVENT = 'st:view';
let router: Router | undefined;

/** Which view and language a route request shows. Unknown languages and paths are the missing view. */
export function screenFor(request: RouteRequest): Screen | 'root' {
  if (request.routeId === 'root') return 'root';
  const lang = request.params.lang;
  // An unknown path keeps the language its prefix names, so /de/typo shows the German not-found page.
  const prefix = /^\/(en|de)(\/|$)/.exec(request.path)?.[1];
  if (!isLocale(lang)) return { view: 'missing', locale: isLocale(prefix) ? prefix : currentLocale() };
  if (request.routeId === 'home') return { view: 'home', locale: lang };
  return { view: 'missing', locale: lang };
}

/** The home path of `locale`, with the trailing slash the static files use. */
const homePath = (locale: Locale): string => `/${locale}/`;

/** Rewrites every language-prefixed link and command target to `locale`. */
function relink(locale: Locale): void {
  for (const element of document.querySelectorAll<HTMLElement>('a[data-router-link], [data-go]')) {
    const attribute = element.hasAttribute('data-go') ? 'data-go' : 'href';
    const value = element.getAttribute(attribute);
    if (value && /^\/(en|de)\//.test(value)) element.setAttribute(attribute, `/${locale}/${value.slice(4)}`);
  }
  const select = document.querySelector<HTMLSelectElement>('.st-lang');
  if (select) select.value = locale;
}

function show(screen: Screen): void {
  for (const element of document.querySelectorAll<HTMLElement>('[data-view]')) element.hidden = element.dataset.view !== screen.view;
  setLocale(screen.locale);
  relink(screen.locale);
  const { title, description } = meta[screen.view][screen.locale];
  document.title = title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', description);
  document.dispatchEvent(new CustomEvent<Screen>(VIEW_EVENT, { detail: screen }));
}

/** Calls `listener` with every screen the router shows, starting with the current one. */
export function onScreen(listener: (screen: Screen) => void): void {
  document.addEventListener(VIEW_EVENT, event => listener((event as CustomEvent<Screen>).detail));
}

/** Opens the tab whose panel holds the URL's anchor, so links like /en/#playground land on visible content. */
export function revealHash(): void {
  const id = decodeURIComponent(location.hash.slice(1));
  const target = id ? document.getElementById(id) : null;
  const panel = target?.closest<HTMLElement>('[role="tabpanel"]');
  if (!target || !panel?.hidden) return;
  document.querySelector<HTMLButtonElement>(`[role="tab"][aria-controls="${panel.id}"]`)?.click();
  requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
}

/**
 * Image URLs are relative (so the files also render from disk) and resolve
 * against the document URL, which the router changes; a lazy image would then
 * load from the wrong folder. Pinning them to the URL the page loaded with
 * keeps them right. VERIFIED: (site e2e) / redirected to /en/ requested
 * /en/aron-homberg.jpg before this.
 */
function pinImageUrls(): void {
  for (const image of document.querySelectorAll<HTMLImageElement>('img[src^="."]')) image.setAttribute('src', image.src);
}

export async function initRouter(): Promise<Router> {
  pinImageUrls();
  router = createRouter({
    mode: 'history',
    routes: [
      { id: 'root', path: '/' },
      { id: 'home', path: '/:lang' },
      { id: 'missing', path: '*' },
    ],
    prepare: ({ to }) => {
      const screen = screenFor(to);
      return { commit: () => { if (screen !== 'root') show(screen); } };
    },
    afterCommit: ({ to, from, cause }) => {
      const screen = screenFor(to);
      if (screen === 'root') {
        // `/` has no language of its own: go to the visitor's, keeping any anchor.
        void router!.navigate(`${homePath(preferredLocale())}${to.hash}`, { replace: true });
        return;
      }
      if (to.hash) { revealHash(); return; }
      // A new view by link: start at its top and give keyboard users the main landmark.
      if (from && cause === 'link' && screenFor(from) !== 'root' && (screenFor(from) as Screen).view !== screen.view) {
        // Instantly: the scroll-top button's stylesheet makes scrolling smooth, and WebKit abandons a smooth
        // scroll when the view swap changes the page height. VERIFIED: (site probe, WebKit) it stopped 1,868 px down.
        window.scrollTo({ top: 0, behavior: 'instant' });
        document.getElementById('main')?.focus({ preventScroll: true });
      }
    },
    onError: error => console.error(`${new Date().toISOString()} ERROR router ${error.code} ${error.message}`),
  });
  router.attachLinks(document);
  window.addEventListener('hashchange', revealHash);
  await router.start();
  return router;
}

/** Shows the current route in `locale` (the language switch), keeping view and anchor. */
export function switchLocale(locale: Locale): void {
  if (!router) return;
  rememberLocale(locale);
  const current = router.getSnapshot().current;
  const screen = current ? screenFor(current) : 'root';
  if (screen !== 'root' && screen.view === 'missing') { show({ view: 'missing', locale }); return; }
  void router.navigate(`${homePath(locale)}${location.hash}`, { replace: true });
}

/** Navigates to an app path such as `/de/#demo` (command palette). */
export function go(path: string): void {
  if (router) { void router.navigate(path); return; }
  // Opened from disk there is no router; the inline script in index.html maps the path to its file.
  const toFile = (globalThis as { stDiskUrl?: (path: string) => string }).stDiskUrl;
  if (toFile) location.assign(toFile(path));
}
