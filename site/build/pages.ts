// Vite plugin: one page source, four static entry points.
//
// Every route gets its own HTML file with the route's language and view already
// rendered, so a deep link such as /de/ reads correctly before any
// script runs and GitHub Pages serves it with status 200. The client router
// then takes over navigation inside the one document. Why not a single
// index.html plus a 404.html fallback: crawlers and link previews would get the
// English home view with status 404 for every German URL.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { messages, meta, type View } from '../src/messages.ts';
import { snippets } from '../src/snippets.ts';
import { strings } from '../src/strings.ts';
import { siteData, type SiteData } from './data.ts';
import { figures, fillSlots, withFigures } from './figures.ts';
import { fillSnippets } from './highlight.ts';
import { LOCALES, localize, unusedKeys, type Locale, type Strings } from './i18n.ts';
import { llmsText } from './llms.ts';
import { proseFindings } from './prose.ts';

export const ORIGIN = 'https://storage.defuss.org';
const REPO = fileURLToPath(new URL('../..', import.meta.url));

export interface Variant {
  readonly file: string;
  readonly locale: Locale;
  readonly view: View;
}

/** The static entry points. `/` shows English until the client picks the visitor's language. */
export const VARIANTS: readonly Variant[] = [
  { file: 'index.html', locale: 'en', view: 'home' },
  ...LOCALES.map(locale => ({ file: `${locale}/index.html`, locale, view: 'home' as const })),
  { file: '404.html', locale: 'en', view: 'missing' },
];

export const routePath = (locale: Locale): string => `/${locale}/`;

const escapeAttribute = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function head(variant: Variant): string {
  const { title, description } = meta[variant.view][variant.locale];
  const tags = [`<title>${title}</title>`, `<meta name="description" content="${escapeAttribute(description)}">`,
    `<meta property="og:title" content="${escapeAttribute(title)}">`, `<meta property="og:description" content="${escapeAttribute(description)}">`,
    `<meta property="og:type" content="website">`, `<meta property="og:locale" content="${variant.locale === 'de' ? 'de_DE' : 'en_US'}">`];
  if (variant.view !== 'missing') {
    tags.push(`<link rel="canonical" href="${ORIGIN}${routePath(variant.locale)}">`);
    for (const locale of LOCALES) tags.push(`<link rel="alternate" hreflang="${locale}" href="${ORIGIN}${routePath(locale)}">`);
    tags.push(`<link rel="alternate" hreflang="x-default" href="${ORIGIN}${routePath('en')}">`);
  } else tags.push('<meta name="robots" content="noindex">');
  return tags.join('\n  ');
}

let cached: { data: SiteData; table: Strings } | undefined;
/** The site data and the strings with their figures filled, computed once per process. */
function content(): { data: SiteData; table: Strings } {
  if (!cached) {
    const data = siteData(REPO);
    cached = { data, table: withFigures(strings, data) };
  }
  return cached;
}

/**
 * Points the build's relative asset URLs (`./assets/...`, `./favicon.svg`) at the
 * site root from the variant's folder. 404.html gets root-absolute URLs: GitHub
 * Pages serves it at any depth, so no relative prefix fits every request.
 */
export function rootUrls(html: string, file: string): string {
  const depth = file.split('/').length - 1;
  const prefix = file === '404.html' ? '/' : depth ? '../'.repeat(depth) : './';
  // No `crossorigin` on the stylesheet: from file:// it turns the load into a
  // CORS request, which Chromium refuses for origin null.
  return html.replace(/(\s(?:src|href)=")\.\//g, `$1${prefix}`).replace(/(<link rel="stylesheet") crossorigin/g, '$1');
}

/** Renders the processed page source as one variant. Pure apart from its inputs. */
export function renderVariant(source: string, variant: Variant, used?: Set<string>): string {
  const { data, table } = content();
  // Slots written directly in the markup are locale-neutral integers with units.
  let html = localize(fillSlots(source, figures(data, 'en')), table, variant.locale, used);
  html = html.replace(/<html lang="[^"]*"/, `<html lang="${variant.locale}"`);
  html = html.replace('<!--site:head-->', head(variant));
  html = html.replaceAll('{lang}', variant.locale);
  // The language select shows the page's language before any script runs.
  html = html.replace(`<option value="${variant.locale}" lang="${variant.locale}">`, `<option value="${variant.locale}" lang="${variant.locale}" selected>`);
  // Show the variant's view: every view is authored `hidden`.
  html = html.replace(new RegExp(`(<[a-z]+[^>]*\\sdata-view="${variant.view}"[^>]*?)\\shidden`), '$1');
  html = rootUrls(html, variant.file);
  if (/\{lang\}|<!--site:/.test(html)) throw new Error(`pages: unreplaced placeholder in ${variant.file}`);
  return html;
}

/** Fails the build on copy that breaks the prose rules or on strings no page uses. */
function checkStrings(used: ReadonlySet<string>): void {
  const findings = Object.entries(content().table).flatMap(([key, entry]) => LOCALES.flatMap(locale =>
    proseFindings(entry[locale].replace(/<[^>]+>/g, ' '), `${key} (${locale})`)));
  for (const [view, byLocale] of Object.entries(meta))
    for (const locale of LOCALES) findings.push(...proseFindings(`${byLocale[locale].title} ${byLocale[locale].description}`, `meta.${view} (${locale})`));
  for (const locale of LOCALES)
    for (const [key, text] of Object.entries(messages[locale])) findings.push(...proseFindings(text, `message ${key} (${locale})`));
  const unused = unusedKeys(strings, used);
  if (unused.length) findings.push(`strings never used: ${unused.join(', ')}`);
  if (findings.length) throw new Error(`pages: copy check failed\n${findings.join('\n')}`);
}

const DATA_ID = 'virtual:site-data';

export function pages(): Plugin {
  let source: string | undefined;
  return {
    name: 'defuss-storage-site:pages',
    enforce: 'post',
    resolveId: id => (id === DATA_ID ? `\0${DATA_ID}` : undefined),
    load: id => (id === `\0${DATA_ID}` ? `export default ${JSON.stringify(content().data)};` : undefined),
    transformIndexHtml: {
      order: 'post',
      async handler(html, context) {
        source = await fillSnippets(html, snippets);
        if (context.server) {
          // Dev server: render the variant the URL asks for.
          const url = context.originalUrl ?? '/';
          const locale: Locale = url.startsWith('/de') ? 'de' : 'en';
          const view: View = /^\/((en|de)\/?)?(#|\?|$)/.test(url) ? 'home' : 'missing';
          return renderVariant(source, { file: 'index.html', locale, view });
        }
        return renderVariant(source, VARIANTS[0]!);
      },
    },
    generateBundle() {
      if (!source) throw new Error('pages: index.html was not processed');
      const used = new Set<string>();
      for (const variant of VARIANTS.slice(1))
        this.emitFile({ type: 'asset', fileName: variant.file, source: renderVariant(source, variant, used) });
      checkStrings(used);
      // A sitemap for the indexable routes.
      const urls = VARIANTS.filter(v => v.file.endsWith('/index.html')).map(v => `  <url><loc>${ORIGIN}${routePath(v.locale)}</loc></url>`);
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n` });
      const template = readFileSync(fileURLToPath(new URL('../llms.txt', import.meta.url)), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'llms.txt', source: llmsText(template, snippets, figures(content().data, 'en')) });
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n` });
    },
  };
}

export const repoPath = (...parts: string[]): string => path.join(REPO, ...parts);
