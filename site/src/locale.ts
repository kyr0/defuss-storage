// Language: one defuss-i18n controller for the page. Static text switches
// through the templates the build generated; scripts read `currentLocale()`
// and subscribe for their own runtime messages.
import { createDomI18n, createI18n, type I18n } from 'defuss-i18n/core';
import type { Locale } from '../build/i18n.ts';

export const LOCALES: readonly Locale[] = ['en', 'de'];
const KEY = 'st-locale';

let controller: I18n | undefined;

export const isLocale = (value: unknown): value is Locale => value === 'en' || value === 'de';

/** The language a visitor gets at `/`: an earlier explicit choice, else the browser's preference list. VERIFIED: (site e2e) de-DE gets /de/, en-US and fr-FR get /en/. */
export function preferredLocale(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLocale(saved)) return saved;
  } catch { /* storage blocked: fall through to the browser preference */ }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const language = tag.toLowerCase().split('-')[0];
    if (isLocale(language)) return language;
  }
  return 'en';
}

/** Remembers an explicit switch, so `/` opens in that language next time. */
export function rememberLocale(locale: Locale): void {
  try { localStorage.setItem(KEY, locale); } catch { /* private mode */ }
}

/** Binds every `[data-i18n-component]` once, in the language the page was rendered in. */
export function initLocale(initial: Locale): I18n {
  controller = createI18n({ locale: initial, fallback: ['en'] });
  const runtime = (globalThis as unknown as { df$: Parameters<typeof createDomI18n>[0] }).df$;
  createDomI18n(runtime).mount(document, controller);
  return controller;
}

export function currentLocale(): Locale {
  const locale = controller?.locale ?? document.documentElement.lang;
  return isLocale(locale) ? locale : 'en';
}

/** Switches every bound component synchronously and updates `<html lang>`. */
export function setLocale(locale: Locale): void {
  if (!controller) throw new Error('locale: initLocale() first');
  if (controller.locale !== locale) controller.setLocale(locale);
  document.documentElement.lang = locale;
}

/** Calls `listener` after each language switch. */
export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  if (!controller) throw new Error('locale: initLocale() first');
  return controller.subscribe(snapshot => listener(isLocale(snapshot.locale) ? snapshot.locale : 'en'));
}

/** Locale-aware number formatting for runtime text. */
export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString(currentLocale() === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** Bytes as text: `512 B`, `4.0 KiB`, `1.5 MiB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 1)} KiB`;
  return `${formatNumber(bytes / 1024 / 1024, 1)} MiB`;
}

/** Durations as text: `0.42 ms`, `12 ms`, `1.3 s`. */
export function formatMs(ms: number): string {
  if (ms < 1) return `${formatNumber(ms, 2)} ms`;
  if (ms < 1000) return `${formatNumber(ms, ms < 10 ? 1 : 0)} ms`;
  return `${formatNumber(ms / 1000, 1)} s`;
}
