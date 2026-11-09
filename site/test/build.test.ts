// Build-time modules against real inputs: the strings table, the repository's
// benchmark reports and package build, and Shiki itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { siteData } from '../build/data.ts';
import { figures, fillSlots } from '../build/figures.ts';
import { fillSnippets, highlightLines } from '../build/highlight.ts';
import { localize, unusedKeys } from '../build/i18n.ts';
import { llmsText } from '../build/llms.ts';
import { renderVariant, rootUrls } from '../build/pages.ts';
import { proseFindings } from '../build/prose.ts';
import { strings as siteStrings } from '../src/strings.ts';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const strings = { 'a.title': { en: 'Hello <code>x</code>', de: 'Hallo <code>x</code>' }, 'a.label': { en: 'Close "it"', de: 'Schließen' } };

test('localize fills text placeholders with the locale and emits a template per locale', () => {
  const html = localize('<p><span class="t" data-t="a.title"></span></p>', strings, 'de');
  assert.equal(html, '<p><span class="t" data-i18n-target="a.title">Hallo <code>x</code></span>'
    + '<template data-i18n-for="a.title" data-i18n-locale="en">Hello <code>x</code></template>'
    + '<template data-i18n-for="a.title" data-i18n-locale="de">Hallo <code>x</code></template></p>');
});

test('localize gives a repeated key its own target, since defuss-i18n rejects duplicate targets', () => {
  const html = localize('<p data-t="a.title"></p><p data-t="a.title"></p>', strings, 'en');
  assert.deepEqual([...html.matchAll(/data-i18n-target="([^"]+)"/g)].map(match => match[1]), ['a.title', 'a.title~2']);
  assert.equal([...html.matchAll(/data-i18n-for="a\.title~2"/g)].length, 2);
});

test('rootUrls points relative asset URLs at the site root from each page folder', () => {
  const html = '<link rel="stylesheet" crossorigin href="./assets/a.css"><img src="./me.jpg"><a href="#why">x</a>';
  assert.equal(rootUrls(html, 'index.html'), '<link rel="stylesheet" href="./assets/a.css"><img src="./me.jpg"><a href="#why">x</a>');
  assert.equal(rootUrls(html, 'de/index.html'), '<link rel="stylesheet" href="../assets/a.css"><img src="../me.jpg"><a href="#why">x</a>');
  // GitHub Pages serves 404.html at any depth.
  assert.equal(rootUrls(html, '404.html'), '<link rel="stylesheet" href="/assets/a.css"><img src="/me.jpg"><a href="#why">x</a>');
});

test('localize rejects attributes defuss-i18n cannot translate, which would stop the page at runtime', () => {
  assert.throws(() => localize('<div data-ta="data-empty-text:a.label"></div>', strings, 'en'), /cannot translate "data-empty-text"/);
});

test('localize translates attributes with an escaped value per locale', () => {
  const html = localize('<button type="button" data-ta="aria-label:a.label">x</button>', strings, 'en');
  assert.equal(html, '<button type="button" aria-label="Close &quot;it&quot;" data-i18n-aria-label-en="Close &quot;it&quot;" data-i18n-aria-label-de="Schließen">x</button>');
});

test('localize rejects unknown keys, filled placeholders and doubly set attributes', () => {
  assert.throws(() => localize('<p data-t="nope"></p>', strings, 'en'), /no string for key "nope"/);
  assert.throws(() => localize('<p data-t="a.title">text</p>', strings, 'en'), /not replaced/);
  assert.throws(() => localize('<b aria-label="x" data-ta="aria-label:a.label"></b>', strings, 'en'), /sets aria-label and translates it/);
});

test('unusedKeys lists strings no placeholder used', () => {
  const used = new Set<string>();
  localize('<p data-t="a.title"></p>', strings, 'en', used);
  assert.deepEqual(unusedKeys(strings, used), ['a.label']);
});

test('figures come from the published reports and are formatted per language', () => {
  const data = siteData(repo);
  assert.deepEqual(data.environments.map(environment => environment.id), ['node', 'bun', 'chromium', 'firefox', 'webkit']);
  assert.ok(data.sizes.every(size => size.gzip < size.raw && size.brotli < size.gzip));
  const en = figures(data, 'en');
  const de = figures(data, 'de');
  assert.match(en.wbMin!, /^\d+(\.\d)?$/);
  assert.equal(de.wbMin, en.wbMin!.replace('.', ','));
  assert.match(en.opfsGzip!, /^\d+\.\d kB$/);
  assert.equal(fillSlots('{{cpu}} with {{cpus}}', en), `${data.cpu} with ${data.logicalCpus}`);
  assert.throws(() => fillSlots('{{nope}}', en), /unknown slot/);
});

test('highlightLines colours tokens and keeps the prompt off continuation lines', async () => {
  const html = await highlightLines({ lang: 'shellscript', code: 'bun add \\\n  defuss-storage\nls', prefix: '$' });
  const lines = html.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /^<pre data-prefix="\$"><code><span style="--shiki-light:#[0-9a-f]{6};--shiki-dark:#[0-9a-f]{6}">/i);
  assert.match(lines[1]!, /^<pre data-prefix=""><code>/);
  assert.match(lines[2]!, /^<pre data-prefix="\$">/);
});

test('fillSnippets fills placeholders and fails on unknown or missed ones', async () => {
  const snippets = { s: { lang: 'javascript' as const, code: 'const a = 1;' } };
  assert.match(await fillSnippets('<div class="mockup-code x" data-snippet="s"></div>', snippets), /<pre><code><span/);
  await assert.rejects(fillSnippets('<div class="mockup-code" data-snippet="t"></div>', snippets), /no snippet "t"/);
  await assert.rejects(fillSnippets('<div id="w" data-snippet="s" class="mockup-code"></div>', snippets), /was not filled/);
});

test('renderVariant sets language, head and visible view', () => {
  const source = '<html lang="en"><head><!--site:head--></head><body><a href="/{lang}/#demo">x</a><div data-view="home" hidden></div><div data-view="missing" hidden></div><p data-t="hero.try"></p></body></html>';
  const html = renderVariant(source, { file: 'de/index.html', locale: 'de', view: 'home' });
  assert.match(html, /<html lang="de">/);
  assert.match(html, /<title>defuss-storage: große Dateien/);
  assert.match(html, /hreflang="en" href="https:\/\/storage\.defuss\.org\/en\/"/);
  assert.match(html, /<a href="\/de\/#demo">/);
  assert.match(html, /<div data-view="home"><\/div><div data-view="missing" hidden><\/div>/);
  // The visible text is the German string from the table, whatever the copy says.
  assert.ok(html.includes(`data-i18n-target="hero.try">${siteStrings['hero.try']!.de}<`), 'German text of hero.try');
});

test('proseFindings flags typographic dashes and promotional words', () => {
  assert.deepEqual(proseFindings('A plain sentence, with commas: fine.', 'x'), []);
  assert.equal(proseFindings('fast — really', 'x').length, 1);
  assert.match(proseFindings('a seamless API', 'x')[0]!, /word "seamless"/);
  assert.deepEqual(proseFindings('robustness is not flagged as a word', 'x'), []);
});

test('llmsText fills snippets and slots and rejects unknown ids and forbidden copy', () => {
  const snippets = { hello: { lang: 'javascript' as const, code: 'console.log(1);\n' } };
  assert.equal(llmsText('# x\n{{snippet:hello}}\n{{n}} MiB/s', snippets, { n: '643' }), '# x\nconsole.log(1);\n643 MiB/s');
  assert.throws(() => llmsText('{{snippet:nope}}', snippets, {}), /no snippet "nope"/);
  assert.throws(() => llmsText('{{missing}}', snippets, {}), /unknown slot/);
  assert.throws(() => llmsText('fast \u2014 really', snippets, {}), /copy check failed/);
});
