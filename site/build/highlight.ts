// Build-time syntax highlighting for every code window on the page. Shiki runs
// once in the build and writes coloured spans into mockup-code lines, so the
// page ships no highlighter for static code (only the playground editor loads
// one, on demand).
import { createHighlighter, type Highlighter } from 'shiki';

/**
 * Light and dark token colours in one span each; styles.css picks the page
 * theme's (the hero window always takes the dark one). Why GitHub's
 * high-contrast pair over vitesse: VERIFIED: (probe over these snippets) its
 * weakest token reaches 5.0:1 on white and 9.2:1 on its dark ground, where
 * vitesse fell to 2.3:1 for comments and punctuation.
 */
export const CODE_THEMES = { light: 'github-light-high-contrast', dark: 'github-dark-high-contrast' } as const;
export const CODE_LANGUAGES = ['javascript', 'typescript', 'shellscript', 'json'] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export interface Snippet {
  readonly lang: CodeLanguage;
  readonly code: string;
  /** Prompt for every line (`$` for shell); omitted, the window numbers its lines. */
  readonly prefix?: string;
}

let highlighter: Promise<Highlighter> | undefined;
const shiki = (): Promise<Highlighter> =>
  (highlighter ??= createHighlighter({ themes: Object.values(CODE_THEMES), langs: [...CODE_LANGUAGES] }));

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The `<pre><code>` lines of one mockup-code window. Each token becomes a span
 * with its two colours as `--shiki-light` and `--shiki-dark`; a shell continuation line (after a trailing backslash) gets
 * an empty prompt, as the component documents.
 */
export async function highlightLines(snippet: Snippet): Promise<string> {
  const { tokens } = (await shiki()).codeToTokens(snippet.code.replace(/\n$/, ''), { lang: snippet.lang, themes: CODE_THEMES, defaultColor: false });
  let continued = false;
  return tokens.map(line => {
    const code = line.map(token => `<span style="${Object.entries(token.htmlStyle ?? {}).map(([name, value]) => `${name}:${value}`).join(';')}">${escapeHtml(token.content)}</span>`).join('');
    const text = line.map(token => token.content).join('');
    const prefix = snippet.prefix === undefined ? '' : ` data-prefix="${continued ? '' : snippet.prefix}"`;
    continued = snippet.prefix !== undefined && text.trimEnd().endsWith('\\');
    return `<pre${prefix}><code>${code}</code></pre>`;
  }).join('\n');
}

const SNIPPET_PLACEHOLDER = /(<div class="mockup-code[^"]*"[^>]*\sdata-snippet="([^"]+)"[^>]*>)(<\/div>)/g;

/** Fills every empty `<div class="mockup-code ..." data-snippet="id"></div>` from `snippets`; an unknown id throws. */
export async function fillSnippets(html: string, snippets: Readonly<Record<string, Snippet>>): Promise<string> {
  const jobs: Promise<string>[] = [];
  html.replace(SNIPPET_PLACEHOLDER, (_match, _open, id: string) => {
    const snippet = snippets[id];
    if (!snippet) throw new Error(`highlight: no snippet "${id}"`);
    jobs.push(highlightLines(snippet));
    return '';
  });
  const filled = await Promise.all(jobs);
  let index = 0;
  const out = html.replace(SNIPPET_PLACEHOLDER, (_match, open: string, _id: string, close: string) => `${open}${filled[index++]}${close}`);
  // A placeholder the pattern missed (class not first, content inside) would ship an empty window.
  const missed = /<div[^>]*\sdata-snippet="([^"]+)"[^>]*>\s*<\/div>/.exec(out);
  if (missed) throw new Error(`highlight: snippet placeholder "${missed[1]}" was not filled`);
  return out;
}
