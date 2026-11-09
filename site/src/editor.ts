// The playground's code editor: the defuss-shadcn code-example editor (its
// textarea over a Shiki paint layer, its CSS and its keyboard rules) without the
// preview stage. Why not the whole component: VERIFIED: (code-example skill) its
// preview runs the source as the srcdoc of an iframe, so a JavaScript module
// would be rendered as HTML text. Shiki loads on
// first use with one language and the two themes, on the JavaScript regex
// engine, so no WebAssembly is fetched.
import type { HighlighterCore } from 'shiki/core';

let highlighter: Promise<HighlighterCore> | undefined;
const shiki = (): Promise<HighlighterCore> => (highlighter ??= (async () => {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([import('shiki/core'), import('shiki/engine/javascript')]);
  return createHighlighterCore({
    themes: [import('@shikijs/themes/github-light-high-contrast'), import('@shikijs/themes/github-dark-high-contrast')],
    langs: [import('@shikijs/langs/javascript')],
    engine: createJavaScriptRegexEngine(),
  });
})());

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface Editor {
  readonly value: string;
  set(value: string): void;
  focus(): void;
}

/** Inserts text as typing would, so undo keeps working. */
function insertText(input: HTMLTextAreaElement, text: string): void {
  let done = false;
  try { done = document.execCommand('insertText', false, text); } catch { done = false; }
  if (!done) {
    input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

export function createEditor(root: HTMLElement, initial: string): Editor {
  const editor = root.querySelector<HTMLElement>('.code-example-editor')!;
  const paint = root.querySelector<HTMLElement>('.code-example-paint')!;
  const source = root.querySelector<HTMLTextAreaElement>('.code-example-src')!;
  let painted: string | undefined;
  let escaped = false;

  const syncScroll = () => { paint.scrollTop = source.scrollTop; paint.scrollLeft = source.scrollLeft; };
  const repaint = () => {
    const value = source.value;
    if (value === painted) return;
    void shiki().then(highlighter => {
      if (source.value !== value) return;
      const html = highlighter.codeToHtml(value, {
        lang: 'javascript', themes: { light: 'github-light-high-contrast', dark: 'github-dark-high-contrast' }, defaultColor: false, cssVariablePrefix: '--code-example-',
      });
      const inner = /<code[^>]*>([\s\S]*)<\/code>/.exec(html)?.[1] ?? escapeHtml(value);
      paint.innerHTML = `${inner}\n`;
      editor.setAttribute('data-painted', '');
      painted = value;
      syncScroll();
    }).catch(() => { editor.removeAttribute('data-painted'); });
  };

  source.addEventListener('input', repaint);
  source.addEventListener('scroll', syncScroll);
  source.addEventListener('keydown', event => {
    if (event.isComposing) return;
    // Tab indents; Escape then Tab leaves the editor (WCAG 2.1.2, no keyboard trap).
    if (event.key === 'Escape') { escaped = true; return; }
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (escaped) { escaped = false; return; }
      event.preventDefault();
      const value = source.value;
      const start = source.selectionStart;
      const end = source.selectionEnd;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      if (start === end && !event.shiftKey) { insertText(source, '  '); return; }
      const next = value.slice(lineStart, end).split('\n').map(line => (event.shiftKey ? line.replace(/^( {1,2}|\t)/, '') : `  ${line}`)).join('\n');
      source.setSelectionRange(lineStart, end);
      insertText(source, next);
      source.setSelectionRange(lineStart, lineStart + next.length);
      return;
    }
    escaped = false;
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const lineStart = source.value.lastIndexOf('\n', source.selectionStart - 1) + 1;
      const indent = /^[\t ]*/.exec(source.value.slice(lineStart, source.selectionStart))?.[0] ?? '';
      if (!indent) return;
      event.preventDefault();
      insertText(source, `\n${indent}`);
    }
  });

  source.value = initial;
  repaint();
  return {
    get value() { return source.value; },
    set(value) { source.value = value; repaint(); },
    focus() { source.focus(); },
  };
}
