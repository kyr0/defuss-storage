// End-to-end suite for the built site (docs/), as a visitor gets it: every
// route in both languages and themes, client routing, anchors, the install
// toggle, charts, the command palette, prose and accessibility rules, and every
// live demo against real OPFS in Chromium, Firefox and WebKit.
// Run after `bun run build`; writes output/site-e2e.json and screenshots to output/site/.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as playwright from 'playwright';
import { withBrowser } from '../../scripts/browsers.mjs';
import { FORBIDDEN_CHARACTERS, FORBIDDEN_WORDS } from '../build/prose.ts';
import { servePages } from './serve.mjs';

const ROOT = fileURLToPath(new URL('../../docs', import.meta.url));
const OUTPUT = fileURLToPath(new URL('../../output', import.meta.url));
const AXE = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const results = [];
let server;
let base;

before(async () => {
  await readFile(path.join(ROOT, 'en/index.html')).catch(() => { throw new Error('docs/ has no build: run `bun run build` in site/ first'); });
  server = await servePages(ROOT);
  base = `http://127.0.0.1:${server.address().port}`;
  await mkdir(path.join(OUTPUT, 'site'), { recursive: true });
});
after(async () => {
  server?.close();
  await writeFile(path.join(OUTPUT, 'site-e2e.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
});

/** Opens `route` and waits until the scripts finished starting; collects page errors and console errors. */
async function open(context, route, { wait = true } = {}) {
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', error => page.errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') page.errors.push(`console: ${message.text()}`); });
  await page.goto(base + route);
  if (wait) await page.waitForSelector('html[data-ready]');
  return page;
}

/**
 * Runs in the page: every visible text node against WCAG 2.1 AA (4.5:1, large
 * text 3:1) and a 14px floor. The background is the solid layers behind the
 * text blended up to the first opaque one; a gradient on the way adds each of
 * its stops as a candidate, and the worst one counts. Colors go through a
 * canvas, so oklch(), lab() and color-mix() results compare as sRGB.
 */
function auditText() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const parse = value => { if (!value || value === 'transparent') return null; ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return a === 0 ? null : { r, g, b, a: a / 255 }; };
  const channel = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const luminance = c => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const blend = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const STOP = /(?:oklch|oklab|lab|lch|rgba?|hsla?|color)\([^()]*(?:\([^()]*\)[^()]*)*\)|#[0-9a-f]{3,8}\b/gi;
  const backgrounds = element => {
    const layers = [], stops = [];
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== 'none' && !style.backgroundImage.startsWith('url')) for (const stop of style.backgroundImage.match(STOP) ?? []) { const c = parse(stop); if (c) stops.push(c); }
      const color = parse(style.backgroundColor);
      if (color) { layers.push(color); if (color.a >= 1) break; }
    }
    const base = layers.at(-1)?.a >= 1 ? { r: 255, g: 255, b: 255, a: 1 } : parse(getComputedStyle(document.body).backgroundColor);
    const solid = layers.reverse().reduce((under, top) => blend(top, under), base);
    return [solid, ...stops.map(stop => blend(stop, solid))];
  };
  const failures = []; let texts = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode; const element = node.parentElement;
    if (!node.textContent.trim() || !element || element.closest('template, [hidden], script, style, svg, canvas, .sr-only')) continue;
    if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const box = element.getBoundingClientRect(); if (box.width < 1 || box.height < 1) continue;
    const style = getComputedStyle(element); texts++;
    const size = parseFloat(style.fontSize), weight = Number(style.fontWeight), text = node.textContent.trim().slice(0, 32);
    const where = `${element.tagName.toLowerCase()}.${[...element.classList].slice(0, 2).join('.')} "${text}"`;
    if (size < 14) failures.push(`${size}px ${where}`);
    // Gradient text has a transparent colour: large display type, outside this check.
    const color = parse(style.color); if (!color) continue;
    const worst = Math.min(...backgrounds(element).map(bg => ratio(blend(color, bg), bg)));
    const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    if (worst < need) failures.push(`${worst.toFixed(2)}:1 ${where}`);
  }
  return { texts, failures };
}

const record = (engine, name, detail = {}) => results.push({ engine, name, ok: true, ...detail });
const shot = (page, name) => page.screenshot({ path: path.join(OUTPUT, 'site', `${name}.png`) });
/** Waits until a toast's text matches `pattern` (demo results are toasts). */
const toast = (page, pattern, timeout = 30_000) => page.waitForFunction(source => [...document.querySelectorAll('.toast')].some(node => new RegExp(source).test(node.textContent)), pattern.source, { timeout });
/** The code spans of the newest toast whose text matches `pattern`: identifiers and error codes render as <code>. */
const toastCodes = (page, pattern) => page.evaluate(source => {
  const node = [...document.querySelectorAll('.toast')].reverse().find(toast => new RegExp(source).test(toast.textContent));
  return [...(node?.querySelectorAll('.toast-description code') ?? [])].map(code => code.textContent);
}, pattern.source);
const visibleView = page => page.locator('[data-view]:not([hidden])').getAttribute('data-view');

async function withContext(options, body) {
  const browser = await playwright.chromium.launch();
  try {
    const context = await browser.newContext(options);
    return await body(context);
  } finally { await browser.close(); }
}

describe('site in Chromium', () => {
  test('every route renders its view, language and title', async () => {
    await withContext({ locale: 'en-US' }, async context => {
      const cases = [
        ['/en/', 'home', 'en', /big files/], ['/de/', 'home', 'de', /Große Dateien/],
        ['/en/no-such-page', 'missing', 'en', /does not exist/], ['/de/tippfehler', 'missing', 'de', /gibt es nicht/], ['/fr/', 'missing', 'en', /does not exist/],
      ];
      const foreign = [];
      context.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) foreign.push(request.url()); });
      for (const [route, view, lang, h1] of cases) {
        const page = await open(context, route);
        await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(300);
        assert.equal(await visibleView(page), view, route);
        assert.equal(await page.getAttribute('html', 'lang'), lang, route);
        assert.match(await page.locator('[data-view]:not([hidden]) h1').first().innerText(), h1, route);
        assert.ok((await page.title()).length > 10, route);
        // A missing page is served with status 404, which the browser reports as a console error.
        const errors = view === 'missing' ? page.errors.filter(error => !/status of 404/.test(error)) : page.errors;
        assert.deepEqual(errors, [], route);
        await shot(page, `route${route.replace(/\W+/g, '-')}`);
        await page.close();
      }
      const llms = await context.request.get(`${base}/llms.txt`);
      assert.equal(llms.status(), 200, '/llms.txt');
      const agentText = await llms.text();
      assert.match(agentText, /^# defuss-storage\n\n> /, 'llms.txt opens with title and summary');
      assert.match(agentText, /\d GiB\/s with 4 KiB blocks/, 'llms.txt carries the measured figures');
      assert.doesNotMatch(agentText, /\{\{/, 'llms.txt has no unfilled slot');
      assert.deepEqual(foreign, [], 'requests outside the site origin');
      assert.deepEqual(await context.cookies(), []);
      record('chromium', 'routes', { routes: cases.length });
    });
  });

  test('pages opened from disk keep their styles, assets and view in three engines', async () => {
    // Chromium and WebKit refuse module scripts from file://, so charts give way
    // to a note; Firefox runs them, and then the page must start without errors.
    const root = `${pathToFileURL(ROOT).href}/`;
    const files = [['index.html', 'home', 'en'], ['en/index.html', 'home', 'en'], ['de/index.html', 'home', 'de']];
    const seen = {};
    for (const engine of ['chromium', 'firefox', 'webkit']) {
      const browser = await playwright[engine].launch();
      try {
        const page = await browser.newPage();
        const outside = [], failed = [], errors = [];
        page.on('request', request => { if (!request.url().startsWith(root) && !request.url().startsWith('data:')) outside.push(request.url()); });
        page.on('requestfailed', request => failed.push(request.url()));
        page.on('pageerror', error => errors.push(error.message));
        for (const [file, view, lang] of files) {
          await page.goto(root + file);
          await page.waitForTimeout(500);
          assert.equal(await visibleView(page), view, `${engine} ${file}`);
          assert.equal(await page.getAttribute('html', 'lang'), lang, `${engine} ${file}`);
          const state = await page.evaluate(() => ({
            styled: getComputedStyle(document.documentElement).getPropertyValue('--chart-1').trim() !== '',
            scripts: document.documentElement.hasAttribute('data-ready'),
            notes: [...document.querySelectorAll('.st-view:not([hidden]) .st-nojs')].filter(note => note.checkVisibility()).length,
            charts: [...document.querySelectorAll('.st-view:not([hidden]) .chart[data-chart-id]:not([hidden])')].filter(chart => chart.checkVisibility()).length,
          }));
          assert.ok(state.styled, `${engine} ${file}: stylesheet not applied`);
          if (state.scripts) assert.equal(state.notes, 0, `${engine} ${file}`);
          else assert.ok(state.notes > 0 && state.charts === 0, `${engine} ${file}: notes ${state.notes}, charts ${state.charts}`);
          seen[engine] = state.scripts ? 'scripts ran' : 'no scripts';
          if (file === 'index.html') await page.screenshot({ path: path.join(OUTPUT, 'site', `file-${engine}.png`) });
        }
        // Navigation from disk: the language select and the header links open the prerendered files.
        await page.goto(`${root}en/index.html#install`);
        await Promise.all([page.waitForURL(`${root}de/index.html#install`), page.selectOption('.st-lang', 'de')]);
        assert.equal(await page.getAttribute('html', 'lang'), 'de', `${engine}: language select`);
        await Promise.all([page.waitForURL(`${root}de/index.html#performance`), page.click('.nav-menu-link[data-nav="performance"]')]);
        assert.equal(await visibleView(page), 'home', `${engine}: header link`);
        await Promise.all([page.waitForURL(`${root}en/index.html#performance`), page.selectOption('.st-lang', 'en')]);
        assert.equal(await page.getAttribute('html', 'lang'), 'en', `${engine}: language select keeps the anchor`);
        assert.deepEqual(outside, [], `${engine}: requests outside docs/`);
        // Only the refused module scripts may fail; a missing stylesheet, image or font would show here.
        assert.deepEqual(failed.filter(url => !url.endsWith('.js')), [], `${engine}: failed requests`);
        assert.deepEqual(errors, [], `${engine}: page errors`);
      } finally { await browser.close(); }
    }
    record('all', 'opened from disk', seen);
  });

  test('/ opens in the browser\'s preferred language', async () => {
    for (const [locale, expected] of [['de-DE', '/de/'], ['en-US', '/en/'], ['fr-FR', '/en/']]) {
      await withContext({ locale }, async context => {
        const page = await open(context, '/#demo');
        await page.waitForURL(`${base}${expected}#demo`);
        assert.equal(await page.getAttribute('html', 'lang'), expected.slice(1, 3));
      });
    }
    record('chromium', 'preferred language');
  });

  test('the language switch keeps the view and anchor, rewrites links and is remembered', async () => {
    await withContext({ locale: 'en-US' }, async context => {
      const page = await open(context, '/en/#method');
      await page.evaluate(() => { window.__sameDocument = true; });
      await page.selectOption('.st-lang', 'de');
      await page.waitForURL(`${base}/de/#method`);
      assert.equal(await page.getAttribute('html', 'lang'), 'de');
      assert.match(await page.locator('#method-title').innerText(), /Benchmark-Methode/);
      assert.equal(await page.getAttribute('[data-nav="how"]', 'href'), '/de/#how');
      assert.match(await page.title(), /große Dateien/);
      assert.equal(await page.evaluate(() => window.__sameDocument), true, 'switch without reload');
      const fresh = await open(context, '/');
      await fresh.waitForURL(`${base}/de/`);
      assert.equal(await fresh.inputValue('.st-lang'), 'de', 'the language select shows the page language');
      assert.deepEqual([...page.errors, ...fresh.errors], []);
    });
    record('chromium', 'language switch');
  });

  test('theme follows the system, the toggle switches and remembers it', async () => {
    await withContext({ colorScheme: 'dark' }, async context => {
      const page = await open(context, '/en/');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true);
      await page.click('label.swap');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), false);
      const again = await open(context, '/en/');
      assert.equal(await again.evaluate(() => document.documentElement.classList.contains('dark')), false);
      await shot(page, 'theme-light-after-toggle');
    });
    await withContext({ colorScheme: 'light' }, async context => {
      const page = await open(context, '/de/');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), false);
    });
    record('chromium', 'theme');
  });

  test('client routing switches views in one document and Back returns', async () => {
    await withContext({}, async context => {
      const page = await open(context, '/en/no-such-page');
      await page.evaluate(() => { window.__sameDocument = true; });
      assert.equal(await visibleView(page), 'missing');
      // The not-found page's benchmarks link lands on the home view's section.
      await page.click('[data-view="missing"] a[href="/en/#performance"]');
      await page.waitForURL(`${base}/en/#performance`);
      assert.equal(await visibleView(page), 'home');
      await page.waitForFunction(() => document.getElementById('performance').getBoundingClientRect().top < innerHeight);
      await page.click('.mk-header-nav [data-nav="how"]');
      await page.waitForURL(`${base}/en/#how`);
      await page.waitForFunction(() => document.getElementById('how').getBoundingClientRect().top < innerHeight);
      await page.goBack();
      await page.goBack();
      await page.waitForURL(`${base}/en/no-such-page`);
      assert.equal(await visibleView(page), 'missing');
      assert.equal(await page.evaluate(() => window.__sameDocument), true);
      // The not-found document itself answers 404, which the console reports.
      assert.deepEqual(page.errors.filter(error => !/status of 404/.test(error)), []);
    });
    record('chromium', 'routing');
  });

  test('every section heading has a working anchor; deep links open the right tab', async () => {
    await withContext({}, async context => {
      let checked = 0;
      for (const route of ['/en/']) {
        const page = await open(context, route);
        // Promotional headings (consulting, the closing call to action) are not content and carry no anchor.
        assert.equal(await page.locator('[data-view]:not([hidden]) .mk-cta-title a.heading-anchor').count(), 0, `${route}: anchors on promotional headings`);
        // An anchor links to its heading, or to the section the heading names.
        const headings = await page.$$eval('[data-view]:not([hidden]) :is(h2, h3)[id]:not(.mk-cta-title)', nodes => nodes.map(node => {
          const anchor = node.querySelector('a.heading-anchor')?.getAttribute('href') ?? '';
          const target = anchor.startsWith('#') ? document.getElementById(anchor.slice(1)) : null;
          return { id: node.id, anchor, resolves: Boolean(target && (target === node || target.contains(node))), label: node.querySelector('a.heading-anchor')?.getAttribute('aria-label') };
        }));
        const sections = await page.$$eval('[data-view]:not([hidden]) section[aria-labelledby]', nodes => nodes.length);
        assert.ok(headings.length >= 15, `${route}: ${headings.length} anchored headings`);
        for (const heading of headings) {
          assert.ok(heading.resolves, `${route} #${heading.id} -> ${heading.anchor}`);
          assert.match(heading.label ?? '', /^Link to/, `${route} #${heading.id} label`);
          checked++;
        }
        assert.ok(sections > 0);
      }
      const page = await open(context, '/en/#playground');
      await page.waitForFunction(() => !document.getElementById('panel-playground').hidden);
      assert.equal(await page.getAttribute('#tab-playground', 'aria-selected'), 'true');
      await page.click('#how a.heading-anchor');
      await page.waitForURL(`${base}/en/#how`);
      record('chromium', 'anchors', { checked });
    });
  });

  test('install commands switch package manager, stay highlighted and remember the choice', async () => {
    await withContext({}, async context => {
      const page = await open(context, '/en/#install');
      const visible = () => page.locator('[data-pm]:not([hidden])').innerText();
      assert.match(await visible(), /bun add defuss-storage/);
      for (const [pm, command] of [['pnpm', 'pnpm add'], ['npm', 'npm install'], ['yarn', 'yarn add']]) {
        await page.click(`[data-install] .toggle[value="${pm}"]`);
        assert.match(await visible(), new RegExp(command));
        assert.equal(await page.locator('[data-pm]:not([hidden])').count(), 1);
      }
      // Shiki writes each token's light and dark colour as variables; the stylesheet picks one per theme.
      const { tokens, colours } = await page.$$eval('.mockup-code pre code span[style*="--shiki-light"]', spans => ({ tokens: spans.length, colours: new Set(spans.map(span => getComputedStyle(span).color)).size }));
      assert.ok(tokens > 100 && colours >= 4, `highlighted tokens: ${tokens}, distinct colours: ${colours}`);
      const again = await open(context, '/en/#install');
      assert.match(await again.locator('[data-pm]:not([hidden])').innerText(), /yarn add/);
    });
    record('chromium', 'install toggle');
  });

  test('charts render from the reports and follow the controls', async () => {
    await withContext({}, async context => {
      const page = await open(context, '/en/#performance');
      const explorer = page.locator('[data-explorer="home"]');
      await explorer.locator('[data-chart-id="explorer"] svg').waitFor();
      const before = await explorer.locator('[data-chart-note]').innerText();
      assert.match(before, /0\.2\.0 reaches/);
      // Three block sizes of the current release only.
      assert.equal(await explorer.locator('tbody tr').count(), 3);
      await explorer.locator('[data-control="env"] .toggle[value="node"]').click();
      await page.waitForFunction(() => !document.querySelector('[data-explorer="home"] [data-adapter-control]').hidden);
      await explorer.locator('[data-control="metric"] .toggle[value="pipelined"]').click();
      await page.waitForFunction(old => document.querySelector('[data-explorer="home"] [data-chart-note]').textContent !== old, before);
      assert.match(await explorer.locator('[data-chart-id="explorer"]').getAttribute('aria-label'), /Node\.js/);
      for (const id of ['options', 'overload']) {
        await page.locator(`[data-chart-id="${id}"]`).scrollIntoViewIfNeeded();
        await page.locator(`[data-chart-id="${id}"] svg`).waitFor();
      }
      const home = await open(context, '/de/#quality');
      await home.locator('[data-chart-id="sizes"] svg').waitFor();
      assert.match(await home.locator('[data-chart-id="sizes"]').innerText(), /gzip/);
      await shot(page, 'charts');
      assert.deepEqual([...page.errors, ...home.errors], []);
    });
    record('chromium', 'charts');
  });

  test('the command palette opens with the shortcut and navigates', async () => {
    await withContext({}, async context => {
      const page = await open(context, '/en/');
      await page.keyboard.press('Control+k');
      await page.waitForSelector('#cmd[open]');
      await page.click('#cmd .command-item[data-go$="#how"]');
      await page.waitForURL(`${base}/en/#how`);
      assert.equal(await page.locator('#cmd[open]').count(), 0);
    });
    record('chromium', 'command palette');
  });

  test('the copy contains no forbidden characters or words, in both languages', async () => {
    await withContext({}, async context => {
      const words = new RegExp(`(?<![\\p{L}-])(${FORBIDDEN_WORDS.join('|')})(?![\\p{L}-])`, 'iu');
      for (const route of ['/en/', '/de/', '/en/missing']) {
        const page = await open(context, route);
        const text = await page.evaluate(() => {
          const parts = [document.title, document.querySelector('meta[name="description"]')?.content ?? ''];
          // Prose only: code windows, the editor and key caps are code, not copy.
          for (const node of document.querySelectorAll('body *:not(script):not(style)')) {
            if (node.closest('.mockup-code, .st-editor, kbd, code, svg')) continue;
            for (const child of node.childNodes) if (child.nodeType === 3) parts.push(child.textContent);
            for (const name of ['aria-label', 'alt', 'title', 'placeholder', 'label']) if (node.hasAttribute(name)) parts.push(node.getAttribute(name));
          }
          for (const template of document.querySelectorAll('template')) parts.push(template.content.textContent ?? '');
          return parts.join(' ');
        });
        assert.doesNotMatch(text, FORBIDDEN_CHARACTERS, route);
        assert.doesNotMatch(text, words, route);
      }
    });
    record('chromium', 'prose');
  });

  test('on a phone: no sideways scroll, the menu sheet navigates, the scroll-top button returns', async () => {
    await withContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, async context => {
      for (const route of ['/en/', '/de/']) {
        const page = await open(context, route);
        const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
        assert.ok(overflow <= 0, `${route} scrolls sideways by ${overflow}px`);
        await page.close();
      }
      const page = await open(context, '/en/');
      await page.click('.st-menu');
      await page.waitForSelector('#st-sheet[open]');
      await page.click('#st-sheet a[href="/en/#performance"]');
      await page.waitForURL(`${base}/en/#performance`);
      await page.waitForFunction(() => document.getElementById('performance').getBoundingClientRect().top < innerHeight);
      await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
      await page.click('.fab-trigger');
      await page.waitForFunction(() => scrollY < 50);
      await shot(page, 'phone-scroll-top');
      assert.deepEqual(page.errors, []);
    });
    record('chromium', 'phone');
  });

  test('phones and tablets read at three quarters of the desktop type size; nothing scrolls sideways and the layer names keep their width', async () => {
    const seen = [];
    // The root as a share of the browser's default size: 15px of 16 up to 1024px wide, 20px of 16 above.
    for (const [width, height, share] of [[390, 844, 0.9375], [820, 1180, 0.9375], [1024, 768, 0.9375], [1025, 768, 1.25], [1440, 900, 1.25]]) {
      await withContext({ viewport: { width, height } }, async context => {
        for (const route of ['/en/', '/de/']) {
          const page = await open(context, route);
          const facts = await page.evaluate(() => {
            // `medium` is the browser's default size, whatever the root is set to.
            const probe = document.body.appendChild(document.createElement('span'));
            probe.style.fontSize = 'medium';
            const base = parseFloat(getComputedStyle(probe).fontSize);
            probe.remove();
            const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
            const names = [...document.querySelectorAll('.st-layers .diagram-node-name')].map(name => name.getBoundingClientRect().width / root);
            return { share: root / base, overflow: document.scrollingElement.scrollWidth - innerWidth, name: Math.min(...names) };
          });
          assert.equal(facts.share, share, `${width}px ${route}: root is ${facts.share * 100}% of the default size`);
          assert.ok(facts.overflow <= 0, `${width}px ${route} scrolls sideways by ${facts.overflow}px`);
          // The defect: beside its label and note the name column shrank to one letter per line.
          assert.ok(facts.name >= 12, `${width}px ${route}: a layer name is ${facts.name.toFixed(1)}rem wide`);
          await page.close();
        }
      });
      seen.push(width);
    }
    record('chromium', 'type scale per screen', { widths: seen });
  });

  test('without scroll timelines and under reduced motion the flythrough words stand apart', async () => {
    /** The words' boxes: none may cover another by more than a pixel (adjacent lines share an edge), and all lie inside the band. */
    const apart = page => page.evaluate(() => {
      const stage = document.querySelector('.st-fly-stage').getBoundingClientRect();
      const boxes = [...document.querySelectorAll('.st-fly-word')].map(word => word.getBoundingClientRect());
      const shared = (a, b) => Math.min(Math.min(a.right, b.right) - Math.max(a.left, b.left), Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const overlaps = boxes.some((a, i) => boxes.some((b, j) => j > i && shared(a, b) > 1));
      return { words: boxes.length, overlaps, inside: boxes.every(box => box.top >= stage.top && box.bottom <= stage.bottom) };
    });
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      await withContext({ viewport, reducedMotion: 'reduce' }, async context => {
        const page = await open(context, '/en/');
        assert.deepEqual(await apart(page), { words: 4, overlaps: false, inside: true }, `reduced motion at ${viewport.width}px`);
        await shot(page.locator('.st-fly-stage'), `flythrough-still-${viewport.width}`);
      });
    }
    record('chromium', 'flythrough still, reduced motion');
    // Firefox draws the same still composition for another reason: it has no scroll timelines.
    const browser = await playwright.firefox.launch();
    try {
      const page = await open(await browser.newContext({ viewport: { width: 390, height: 844 } }), '/en/');
      const timelines = await page.evaluate(() => CSS.supports('animation-timeline: view()'));
      if (!timelines) assert.deepEqual(await apart(page), { words: 4, overlaps: false, inside: true }, 'Firefox without scroll timelines');
      record('firefox', 'flythrough still', { timelines });
    } finally { await browser.close(); }
  });

  test('copy buttons put the command and the agent prompt on the clipboard', async () => {
    await withContext({ permissions: ['clipboard-read', 'clipboard-write'] }, async context => {
      const page = await open(context, '/en/#install');
      await page.click('[data-copy-install]');
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'bun add defuss-storage');
      await page.click('#use-tab-agent');
      await page.click('[data-copy-prompt]');
      assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^Add defuss-storage to this app .* createMemoryStorage\(\)\.$/);
    });
    record('chromium', 'copy');
  });

  test('palette commands switch theme and language', async () => {
    await withContext({ colorScheme: 'light' }, async context => {
      const page = await open(context, '/en/');
      await page.keyboard.press('Control+k');
      await page.click('#cmd .command-item[data-command="theme"]');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true);
      await page.keyboard.press('Control+k');
      await page.click('#cmd .command-item[data-command="locale"]');
      await page.waitForURL(`${base}/de/`);
      assert.match(await page.locator('#hero-title').innerText(), /Große Dateien/);
      await page.selectOption('.st-lang', 'en');
      await page.waitForURL(`${base}/en/`);
      assert.equal(await page.getAttribute('html', 'lang'), 'en');
    });
    record('chromium', 'palette commands');
  });

  test('every visible text meets WCAG AA contrast and a 14px floor, in both themes and every demo tab', async () => {
    const failures = [];
    let texts = 0;
    for (const colorScheme of ['light', 'dark']) {
      await withContext({ colorScheme, reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } }, async context => {
        for (const route of ['/en/', '/de/']) {
          const page = await open(context, route);
          const height = await page.evaluate(() => document.body.scrollHeight);
          for (let y = 0; y < height; y += 700) { await page.evaluate(top => scrollTo(0, top), y); await page.waitForTimeout(60); }
          await page.waitForTimeout(600);
          const tabs = [null, '#tab-seek', '#tab-owner', '#tab-limits', '#tab-playground'];
          for (const tab of tabs) {
            if (tab) { await page.click(tab); await page.waitForTimeout(400); }
            const report = await page.evaluate(auditText);
            texts += report.texts;
            failures.push(...report.failures.map(failure => `${colorScheme} ${route}${tab ?? ''}: ${failure}`));
          }
          // The notes that stand in for a backend: Filesystem over journal.log, Memory in the ownership demo.
          for (const [tab, demo, backend] of [['#tab-persist', 'persist', 'file'], ['#tab-owner', 'owner', 'memory']]) {
            await page.click(tab);
            await page.click(`[data-demo="${demo}"] .st-backend .toggle[value="${backend}"]`);
            await page.waitForTimeout(300);
            const report = await page.evaluate(auditText);
            texts += report.texts;
            failures.push(...report.failures.map(failure => `${colorScheme} ${route}${demo} ${backend} note: ${failure}`));
            await page.click(`[data-demo="${demo}"] .st-backend .toggle[value="opfs"]`);
          }
          await page.close();
        }
      });
    }
    assert.deepEqual([...new Set(failures)], []);
    record('chromium', 'contrast and size', { texts });
  });

  test('rotating headings fade through their lines in order, never showing one twice in a row', async () => {
    await withContext({ viewport: { width: 1440, height: 900 } }, async context => {
      const page = await open(context, '/en/');
      // One round in 1.5 s instead of 15 s; the keyframes are the same.
      await page.addStyleTag({ content: '.st-flip .text-rotate { --text-rotate-duration: 1.5s !important; }' });
      const order = await page.evaluate(async () => {
        const lines = [...document.querySelector('.st-flip .text-rotate > span').children];
        const seen = [];
        for (let t = 0; t < 1700; t += 25) {
          const shown = lines.map(line => Number(getComputedStyle(line).opacity));
          const top = shown.indexOf(Math.max(...shown));
          if (seen.at(-1) !== top) seen.push(top);
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        return { seen, count: lines.length };
      });
      for (let index = 1; index < order.seen.length; index++)
        assert.equal(order.seen[index], (order.seen[index - 1] + 1) % order.count, `line order ${order.seen.join(',')}`);
      assert.ok(order.seen.length >= order.count, `every line shown: ${order.seen.join(',')}`);
    });
    record('chromium', 'text rotate');
  });

  test('a language switch updates the charts in place instead of drawing them again', async () => {
    await withContext({ viewport: { width: 1440, height: 900 } }, async context => {
      const page = await open(context, '/en/');
      // Charts mount when they come near the viewport.
      for (const id of ['explorer', 'options', 'overload']) {
        await page.locator(`[data-view="home"] [data-chart-id="${id}"]`).scrollIntoViewIfNeeded();
        await page.locator(`[data-view="home"] [data-chart-id="${id}"] svg`).waitFor();
      }
      await page.waitForTimeout(1500);
      const frames = await page.evaluate(async () => {
        let frame = 0; let running = true;
        const tick = () => { frame++; if (running) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        const touched = new Map();
        const observer = new MutationObserver(list => { for (const record of list) {
          const chart = (record.target.nodeType === 1 ? record.target : record.target.parentElement)?.closest('[data-chart-id]');
          if (chart) (touched.get(chart.dataset.chartId) ?? touched.set(chart.dataset.chartId, new Set()).get(chart.dataset.chartId)).add(frame);
        } });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        const select = document.querySelector('.st-lang');
        select.value = 'de';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 2000));
        observer.disconnect(); running = false;
        return Object.fromEntries([...touched].map(([id, set]) => [id, set.size]));
      });
      // A remount replays the intro animation over dozens of frames; an update in place takes a few.
      for (const [id, count] of Object.entries(frames)) assert.ok(count <= 6, `${id} changed in ${count} frames`);
      assert.match(await page.locator('#perf-title').innerText(), /Gemessen/);
    });
    record('chromium', 'charts on language switch');
  });

  test('each demo fits one 1440x900 screen and its defaults run without an error', { timeout: 300_000 }, async () => {
    await withContext({ viewport: { width: 1440, height: 900 } }, async context => {
      const page = await open(context, '/en/#demo');
      const fits = async name => {
        const box = await page.evaluate(() => { const window = document.querySelector('.st-window'); scrollTo(0, window.getBoundingClientRect().top + scrollY - 96); return window.getBoundingClientRect().height; });
        assert.ok(box <= 900 - 96 - 16, `${name}: the demo window is ${Math.round(box)} px high`);
      };
      await page.waitForSelector('[data-demo="persist"][data-ready]');
      await page.fill('#persist-line', 'a line from the fit check');
      await page.press('#persist-line', 'Enter');
      await toast(page, /Appended/);
      await fits('persist');
      await page.click('#tab-seek');
      await page.waitForSelector('[data-demo="seek"][data-ready]');
      await page.click('[data-demo="seek"] [data-action="generate"]');
      await page.locator('.toast[data-variant="success"]', { hasText: 'Wrote 1,000,000 records' }).waitFor({ timeout: 180_000 });
      await fits('seek');
      await page.click('#tab-owner');
      await page.waitForSelector('[data-demo="owner"][data-ready]');
      await page.click('[data-worker="a"] [data-action="open"]');
      await page.waitForFunction(() => document.querySelector('[data-worker="a"] .st-worker-state').dataset.state === 'owns');
      await fits('ownership');
      await page.click('[data-worker="a"] [data-action="close"]');
      await page.click('#tab-limits');
      await page.waitForSelector('[data-demo="limits"][data-ready]');
      await page.click('[data-demo="limits"] [data-action="fire"]');
      await page.locator('.toast[data-variant="success"]', { hasText: 'All 64 calls admitted' }).waitFor();
      await fits('backpressure');
      await page.click('#tab-playground');
      await page.waitForSelector('[data-demo="playground"][data-ready]');
      await page.click('[data-demo="playground"] [data-action="run"]');
      await page.locator('.toast[data-variant="success"]', { hasText: 'Finished' }).waitFor({ timeout: 30_000 });
      assert.equal(await page.locator('.toast[data-variant="destructive"]').count(), 0, 'no error toast');
      await fits('playground');
      assert.deepEqual(page.errors, []);
    });
    record('chromium', 'demo fit and defaults');
  });

  test('axe finds no serious or critical WCAG 2.1 A/AA violations', async () => {
    const report = {};
    for (const colorScheme of ['light', 'dark']) {
      await withContext({ colorScheme, reducedMotion: 'reduce' }, async context => {
        for (const route of ['/en/', '/de/', '/en/missing']) {
          const page = await open(context, route);
          await page.addScriptTag({ content: AXE });
          const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }))
            .violations.filter(v => ['serious', 'critical'].includes(v.impact))
            .map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`));
          report[`${colorScheme} ${route}`] = violations;
        }
      });
    }
    const failing = Object.entries(report).filter(([, violations]) => violations.length);
    assert.deepEqual(failing, []);
    record('chromium', 'axe', { pages: Object.keys(report).length });
  });
});

/** The live demos, in a persistent profile so WebKit has OPFS (it lacks it in ephemeral contexts). */
for (const engine of ['chromium', 'firefox', 'webkit']) {
  describe(`demos in ${engine}`, () => {
    test('persistence, ownership, backpressure, playground and the live benchmark run on real OPFS', { timeout: 240_000 }, async () => {
      await withBrowser(engine, async (first, version) => {
        const context = first.context();
        await first.close();
        // The native folder dialog cannot be automated: an OPFS folder stands in for the visitor's pick.
        await context.addInitScript(() => {
          window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('e2e-picked', { create: true });
        });
        const page = await open(context, '/en/#demo');
        const persist = page.locator('[data-demo="persist"]');
        await page.waitForSelector('[data-demo="persist"][data-ready]');
        await persist.locator('[data-action="truncate"]').click();
        await toast(page, /Truncated/);
        // An empty line cannot be appended: Append stays disabled until there is text.
        assert.ok(await persist.locator('button[type="submit"]').isDisabled(), 'Append enabled for an empty line');
        await persist.locator('input').fill('hello from e2e');
        assert.ok(await persist.locator('button[type="submit"]').isEnabled());
        await persist.locator('input').press('Enter');
        await toast(page, /Appended 15 B at offset 0/);
        assert.ok(await persist.locator('.st-fresh').count() >= 15);
        assert.equal(await page.locator('.st-opfs-alert').isHidden(), true, 'OPFS available');
        // A plain load shows no toast; the demo's own reload button answers with one.
        await page.reload();
        await page.waitForSelector('html[data-ready]');
        await page.locator('#demo').scrollIntoViewIfNeeded();
        await page.waitForSelector('[data-demo="persist"][data-ready]');
        await page.waitForFunction(() => /15 B/.test(document.querySelector('[data-demo="persist"] [data-size-label]').textContent));
        assert.equal(await page.locator('.toast').count(), 0, 'no toast without an interaction');
        await Promise.all([page.waitForNavigation(), persist.locator('[data-action="reload"]').click()]);
        await page.waitForSelector('html[data-ready]');
        await page.locator('#demo').scrollIntoViewIfNeeded();
        await toast(page, /Found 15 B after the reload/);
        assert.match(await persist.locator('[data-hex]').innerText(), /hello from e2e/);
        await persist.locator('[data-action="read"]').click();
        await toast(page, /Read 15 B back/);
        await shot(page, `${engine}-persist`);
        // Backends: a chosen Memory backend keeps its own file and loses it on a reload; the choice survives the
        // reload; Filesystem shows a note, makes the controls inert and links to the Node.js setup.
        const pick = (demo, backend) => page.click(`[data-demo="${demo}"] .st-backend .toggle[value="${backend}"]`);
        await pick('persist', 'memory');
        await page.waitForFunction(() => document.querySelector('[data-demo="persist"] [data-hex]').dataset.empty === 'true');
        await persist.locator('input').fill('kept only in memory');
        await persist.locator('input').press('Enter');
        await toast(page, /Appended 20 B at offset 0/);
        assert.equal(await page.locator('.st-opfs-alert').isHidden(), true, 'a chosen memory backend is not a fallback');
        await Promise.all([page.waitForNavigation(), persist.locator('[data-action="reload"]').click()]);
        await page.waitForSelector('html[data-ready]');
        await page.locator('#demo').scrollIntoViewIfNeeded();
        await toast(page, /Empty after the reload/);
        assert.equal(await persist.locator('.st-backend .toggle[aria-pressed="true"]').getAttribute('value'), 'memory');
        await pick('persist', 'file');
        assert.ok(await persist.locator('[data-backend-note="file"]').isVisible());
        assert.ok(await persist.locator('.st-hex').isHidden());
        assert.equal(await persist.locator('.st-persist-form').evaluate(form => form.inert), true);
        await persist.locator('[data-backend-note="file"] a').click();
        await page.waitForFunction(() => !document.getElementById('use-node').hidden);
        // Where the browser can pick a folder, Filesystem runs the demo on it through createDirectoryStorage.
        await persist.locator('[data-pick-folder]').click();
        await toast(page, /write to e2e-picked\/defuss-storage-demo\//);
        assert.ok(await persist.locator('[data-backend-note="file"]').isHidden());
        await persist.locator('input').fill('in a folder');
        await persist.locator('input').press('Enter');
        await toast(page, /Appended 12 B at offset 0/);
        const landed = await page.evaluate(async () => {
          const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('e2e-picked');
          const folder = await (await root.getDirectoryHandle('defuss-storage-demo')).getDirectoryHandle('site-persist');
          return (await (await folder.getFileHandle('journal.log')).getFile()).text();
        });
        assert.equal(landed, 'in a folder\n', 'the bytes are in the picked folder');
        await pick('persist', 'opfs');
        await page.waitForFunction(() => /hello from e2e/.test(document.querySelector('[data-demo="persist"] [data-hex]').textContent));

        // Seek: the default writes 1,000,000 records, the list reads the visible ones from the file, a seek lands on its record.
        await page.click('#tab-seek');
        await page.waitForSelector('[data-demo="seek"][data-ready]');
        await page.click('[data-demo="seek"] [data-action="generate"]');
        await toast(page, /Wrote 1,000,000 records/, 180_000);
        await page.waitForFunction(() => (document.querySelector('#seek-list .st-seek-text')?.textContent ?? '').startsWith('0000000 2026-01-01T00:00:00'));
        // The seek field sits in a toolbar above the list.
        const [bar, list] = await Promise.all(['.st-seek-jump', '#seek-list'].map(selector => page.locator(selector).boundingBox()));
        assert.ok(bar.y + bar.height <= list.y + 1, `toolbar ${JSON.stringify(bar)} above list ${JSON.stringify(list)}`);
        // Scrolled to the right end, every record on screen shows in full.
        const clipped = await page.evaluate(() => {
          const list = document.getElementById('seek-list');
          list.scrollLeft = list.scrollWidth;
          const right = list.getBoundingClientRect().right;
          return [...list.querySelectorAll('.st-seek-text')].filter(text => text.getBoundingClientRect().right > right + 1).map(text => text.textContent);
        });
        assert.deepEqual(clipped, []);
        await page.fill('#seek-index', '123456');
        await page.press('#seek-index', 'Enter');
        await page.waitForFunction(() => (document.querySelector('#seek-list .st-seek-hit .st-seek-text')?.textContent ?? '').startsWith('0123456 2026-01-02T10:17:36'));
        // A seek answers in the list, not with a toast that would cover it.
        assert.equal(await page.locator('.toast', { hasText: /123,456/ }).count(), 0);
        await shot(page, `${engine}-seek`);
        // On Memory the list starts empty and fills from the memory file; every record ends with its six-digit hash.
        await pick('seek', 'memory');
        assert.equal(await page.locator('[data-demo="seek"] [data-stat="records"]').innerText(), '0');
        await page.selectOption('#seek-records', '100000');
        await page.click('[data-demo="seek"] [data-action="generate"]');
        await toast(page, /Wrote 100,000 records/, 60_000);
        await page.waitForFunction(() => /^0000000 2026-01-01T00:00:00\.000Z [a-z-]+ temp=[\d.]+ humidity=\d+% [0-9a-f]{6}$/.test(document.querySelector('#seek-list .st-seek-text')?.textContent ?? ''));
        await pick('seek', 'opfs');

        // Ownership: B gets BUSY while A owns the file; terminating A frees it.
        await page.click('#tab-owner');
        const owner = page.locator('[data-demo="owner"]');
        await page.waitForSelector('[data-demo="owner"][data-ready]');
        // Memory files belong to one worker: the ownership demo shows a note there instead of the stage.
        await pick('owner', 'memory');
        assert.ok(await owner.locator('[data-backend-note="memory"]').isVisible());
        assert.ok(await owner.locator('.st-owner-stage').isHidden());
        await pick('owner', 'opfs');
        const state = slot => owner.locator(`[data-worker="${slot}"] .st-worker-state`);
        await owner.locator('[data-worker="a"] [data-action="open"]').click();
        await page.waitForFunction(() => document.querySelector('[data-worker="a"] .st-worker-state').dataset.state === 'owns');
        await owner.locator('[data-worker="b"] [data-action="open"]').click();
        await page.waitForFunction(() => document.querySelector('[data-worker="b"] .st-worker-state').dataset.state === 'busy');
        await owner.locator('[data-worker="a"] [data-action="terminate"]').click();
        let owns = false;
        for (let attempt = 0; attempt < 20 && !owns; attempt++) {
          await owner.locator('[data-worker="b"] [data-action="open"]').click();
          await page.waitForTimeout(250);
          owns = (await state('b').getAttribute('data-state')) === 'owns';
        }
        assert.equal(owns, true, 'B owns the file after A was terminated');
        await owner.locator('[data-worker="b"] [data-action="close"]').click();
        await shot(page, `${engine}-ownership`);

        // Backpressure: the defaults admit all 64 calls; a limit of 16 operations admits 16.
        await page.click('#tab-limits');
        const limits = page.locator('[data-demo="limits"]');
        await page.waitForSelector('[data-demo="limits"][data-ready]');
        await limits.locator('[data-action="fire"]').click();
        await toast(page, /All 64 calls admitted/);
        assert.equal(await limits.locator('.st-cells .st-cell[data-state="ok"]').count(), 64);
        // A limit below the load refuses the rest at once.
        await limits.locator('[name="ops"]').fill('16');
        await limits.locator('[data-action="fire"]').click();
        await toast(page, /16 admitted, 48 refused/);
        assert.deepEqual(await toastCodes(page, /16 admitted/), ['QUEUE_FULL']);
        assert.equal(await limits.locator('.st-cells .st-cell[data-state="ok"]').count(), 16);
        assert.equal(await limits.locator('.st-cells .st-cell[data-state="full"]').count(), 48);
        await limits.locator('[data-action="chunks"]').click();
        await toast(page, /appendChunks wrote all 64/);
        // The same admission on Memory: 8 operations admitted, the rest refused.
        await pick('limits', 'memory');
        await limits.locator('[name="ops"]').fill('8');
        await limits.locator('[data-action="fire"]').click();
        await toast(page, /8 admitted, 56 refused/);
        assert.equal(await limits.locator('.st-cells .st-cell[data-state="full"]').count(), 56);
        await pick('limits', 'opfs');
        await shot(page, `${engine}-limits`);

        // Playground: the default script and the ownership example.
        await page.click('#tab-playground');
        const play = page.locator('[data-demo="playground"]');
        await page.waitForSelector('[data-demo="playground"][data-ready]');
        await play.locator('.code-example-editor[data-painted]').waitFor();
        await play.locator('[data-action="run"]').click();
        await toast(page, /Finished/);
        assert.match(await play.locator('[data-console]').innerText(), /appended 1000 chunks/);
        await play.locator('#play-preset').selectOption('owner');
        await play.locator('.code-example-src').press('Control+Enter');
        await page.waitForFunction(() => /second open/.test(document.querySelector('[data-console]').textContent));
        assert.match(await play.locator('[data-console]').innerText(), /second open: BUSY/);
        await shot(page, `${engine}-playground`);

        // The live benchmark, reached by the performance section's link.
        await page.click('#performance a[href="#run"]');
        await page.waitForURL(`${base}/en/#run`);
        const run = page.locator('[data-demo="speed"]');
        await page.waitForSelector('[data-demo="speed"][data-ready]');
        await run.locator('[data-action="bench"]').click();
        await page.waitForFunction(() => /Done in|Error/.test(document.querySelector('[data-demo="speed"] [data-status]').textContent), null, { timeout: 120_000 });
        assert.match(await run.locator('[data-status]').innerText(), /Done in/);
        assert.equal(await run.locator('tbody tr').count(), 6);
        // The comparison names the recorded browser and the machine it ran on.
        assert.match(await run.locator('[data-engine]').innerText(), /^Compared with: (Chromium|Firefox|WebKit) [\d.]+, .+ \d+ GB$/);
        await run.locator('[data-chart-id="run"] svg').waitFor();
        const figures = await run.locator('tbody').innerText();
        await shot(page, `${engine}-benchmark`);
        assert.deepEqual(page.errors, []);
        record(engine, 'demos', { version, figures: figures.split('\n') });
      });
    });
  });
}

describe('demos without OPFS', () => {
  test('an ephemeral WebKit context falls back to memory and says so', async () => {
    const browser = await playwright.webkit.launch();
    try {
      const page = await open(await browser.newContext(), '/en/#demo');
      await page.waitForSelector('.st-opfs-alert:not([hidden])');
      assert.match(await page.locator('.st-opfs-alert').innerText(), /memory/);
      await page.locator('[data-demo="persist"] input').fill('kept in memory');
      await page.locator('[data-demo="persist"] input').press('Enter');
      await toast(page, /Appended/);
      record('webkit', 'memory fallback');
    } finally { await browser.close(); }
  });
});
