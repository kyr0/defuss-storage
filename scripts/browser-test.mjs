// Browser suite: serves the repository on 127.0.0.1, opens a page in each
// requested Playwright browser and drives fresh dedicated workers
// (tests/browser-worker.ts) against real OPFS. TypeScript test modules are served
// type-stripped by the project's TypeScript (transpileModule keeps every import
// and statement, and does not bundle); dist/ is served exactly as built. No OPFS fake exists, so this is
// the only proof of the OPFS adapter.
//
// Usage: node scripts/browser-test.mjs [chromium] [firefox] [webkit]   (default: chromium)
// Each browser first reports which required worker APIs it exposes. Missing APIs
// are recorded as "unsupported" and only the memory contracts run there; any
// failing case is an implementation failure and fails the script.
// Each browser runs in a persistent temporary profile (see withBrowser in
// browsers.mjs). Results: output/browser-results-<browser>.json
// (+ output/browser-results.json for chromium).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { serve, withBrowser } from './browsers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const browsers = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium'];
const server = await serve(root, {
  transform: (filename, bytes) => filename.endsWith('.ts') ? ts.transpileModule(bytes.toString('utf8'), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
  }).outputText : bytes,
});

/** Runs in the page: capability probe, contract suite, then the multi-worker lifecycle scenarios. */
async function pageSuite() {
  const { createOPFSStorage } = await import('/dist/opfs.mjs');
  const { createDirectoryStorage } = await import('/dist/directory.mjs');
  let sequence = 0;
  const spawn = () => new Worker('/tests/browser-worker.ts', { type: 'module' });
  const call = (worker, task, args = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { cleanup(); reject(new Error(`worker timeout: ${task}`)); }, 90000);
    const cleanup = () => { clearTimeout(timer); worker.removeEventListener('message', listener); worker.removeEventListener('error', failed); };
    const failed = error => { cleanup(); reject(new Error(`${task}: ${error.message}`)); };
    const listener = ({ data }) => { if (data.id !== id) return; cleanup(); if (data.error) reject(new Error(data.error.message)); else resolve(data.result); };
    worker.addEventListener('message', listener); worker.addEventListener('error', failed); worker.postMessage({ id, task, ...args });
  });
  const namespace = `test-${Date.now()}`;
  const workers = [];
  const fresh = () => { const w = spawn(); workers.push(w); return w; };
  try {
    const a = fresh();
    const capabilities = await call(a, 'capabilities');
    const opfs = capabilities.getDirectory && capabilities.syncAccessHandle && capabilities.webLocks;
    const directory = capabilities.getDirectory && capabilities.createWritable && capabilities.webLocks;
    const result = await call(a, 'suite', { namespace, adapters: ['memory', ...(opfs ? ['opfs'] : []), ...(directory ? ['directory'] : [])] });
    result.capabilities = capabilities;
    result.unsupported = [...(opfs ? [] : ['OPFS adapter: required worker APIs missing']), ...(directory ? [] : ['directory adapter: createWritable or Web Locks missing'])];
    if (directory) {
      const scenarios = [
        ['directory: two workers enforce ownership through Web Locks', async () => {
          const b = fresh(); await call(a, 'hold', { namespace: `${namespace}-own`, kind: 'directory' });
          await call(b, 'busy', { namespace: `${namespace}-own`, kind: 'directory' }); await call(a, 'release');
        }],
        ['directory: runs on the main thread, where OPFS sync handles do not exist', async () => {
          const origin = await navigator.storage.getDirectory();
          const folder = await (await origin.getDirectoryHandle('defuss-storage', { create: true })).getDirectoryHandle(`${namespace}-main`, { create: true });
          const store = await createDirectoryStorage(folder);
          const file = await store.open('main.bin', { create: true });
          const receipt = await file.append(new Uint8Array([7, 8, 9]));
          const bytes = [...await file.readExactly(0, 3)];
          await file.close();
          if (receipt.offset !== 0 || bytes.join() !== '7,8,9') throw new Error(`main thread: ${JSON.stringify({ receipt, bytes })}`);
        }],
      ];
      for (const [name, run] of scenarios) {
        try { await run(); result.passed.push(name); }
        catch (error) { result.failed.push({ name, message: String(error?.stack ?? error) }); }
      }
    }
    if (opfs) {
      let rejected = false; try { await createOPFSStorage(); } catch (e) { rejected = e.code === 'UNSUPPORTED'; }
      (rejected ? result.passed : result.failed).push(rejected ? 'OPFS: rejects main-thread initialization' : { name: 'OPFS: rejects main-thread initialization', message: 'accepted' });
      const scenarios = [
        ['OPFS: two workers enforce ownership; a fresh worker reads flushed bytes', async () => {
          const b = fresh(); await call(a, 'hold', { namespace }); await call(b, 'busy', { namespace }); await call(a, 'release');
          await call(fresh(), 'reopen', { namespace });
        }],
        ['OPFS: terminating an owner worker releases its lock; flushed bytes persist', async () => {
          const owner = fresh(); await call(owner, 'hold', { namespace: `${namespace}-kill` }); owner.terminate();
          const reopened = await call(fresh(), 'reopen', { namespace: `${namespace}-kill`, retry: true });
          return `after ${reopened.attempts} open attempt(s)`;
        }],
        ['OPFS: directories under valid names are UNSUPPORTED and unlisted', () => call(a, 'foreign-dir', { namespace: `${namespace}-dir` })],
      ];
      for (const [name, run] of scenarios) {
        try { const note = await run(); result.passed.push(typeof note === 'string' ? `${name} (${note})` : name); }
        catch (error) { result.failed.push({ name, message: String(error?.stack ?? error) }); }
      }
    }
    return result;
  } finally {
    for (const w of workers) w.terminate();
    try {
      const base = await (await navigator.storage.getDirectory()).getDirectoryHandle('defuss-storage');
      for await (const [name] of base.entries()) if (name.startsWith(namespace)) await base.removeEntry(name, { recursive: true });
    } catch { /* no OPFS or nothing created */ }
  }
}

let failures = 0;
try {
  await mkdir(path.join(root, 'output'), { recursive: true });
  for (const name of browsers) await withBrowser(name, async (page, version) => {
    page.setDefaultTimeout(180000);
    const pageErrors = []; page.on('pageerror', error => pageErrors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(pageSuite);
    for (const message of pageErrors) result.failed.push({ name: 'page error', message });
    const report = { runtime: name, version, count: result.passed.length, ...result };
    const json = JSON.stringify(report, null, 2) + '\n';
    await writeFile(path.join(root, `output/browser-results-${name}.json`), json);
    if (name === 'chromium') await writeFile(path.join(root, 'output/browser-results.json'), json);
    const unsupported = result.unsupported.length ? `; unsupported: ${result.unsupported.join(', ')}` : '';
    console.log(`${name} ${report.version}: ${result.passed.length} passed, ${result.failed.length} failed${unsupported}`);
    for (const failure of result.failed) console.error(`  FAIL ${failure.name}\n    ${failure.message.split('\n').slice(0, 4).join('\n    ')}`);
    failures += result.failed.length;
  });
} finally { await new Promise(resolve => server.close(resolve)); }
if (failures) process.exit(1);
