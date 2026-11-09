// Shared by the browser test suite (browser-test.mjs) and the OPFS benchmark
// (bench-browsers.mjs): a local static server over the repository and a
// Playwright browser in a persistent temporary profile.
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as playwright from 'playwright';

/**
 * Serves files below `root` on 127.0.0.1 at a free port; `/` is an empty
 * page. VERIFIED: (browser suite, three engines) OPFS and Web Locks are
 * available to workers of this origin. `transform(filename, bytes)`
 * may rewrite a file before it is sent; `headers` go on every response.
 * Resolves to the listening server.
 */
export async function serve(root, { transform = (_filename, bytes) => bytes, headers = {} } = {}) {
  const server = http.createServer(async (req, res) => {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>defuss-storage</title>'); return; }
      const filename = path.resolve(root, '.' + pathname);
      if (!filename.startsWith(root)) { res.writeHead(403); res.end(); return; }
      const bytes = await readFile(filename); res.setHeader('content-type', 'text/javascript');
      res.end(transform(filename, bytes));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

/**
 * Launches Playwright browser `name` in a fresh persistent profile, runs
 * `body(page, version)`, then closes the browser and deletes the profile.
 * Why persistent: VERIFIED: (WebKit 26.5) OPFS getDirectory() fails with
 * UnknownError in an ephemeral context, like private browsing, but works in a
 * persistent one. CHROMIUM_EXECUTABLE_PATH / CHROMIUM_ARGS (JSON array) select
 * another Chromium build.
 */
export async function withBrowser(name, body) {
  const type = playwright[name];
  if (!type?.launch) throw new Error(`unknown browser ${name}`);
  const chromium = name === 'chromium';
  const profile = await mkdtemp(path.join(tmpdir(), `defuss-storage-${name}-`));
  const context = await type.launchPersistentContext(profile, { headless: true,
    ...(chromium && process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
    ...(chromium && process.env.CHROMIUM_ARGS ? { args: JSON.parse(process.env.CHROMIUM_ARGS) } : {}),
  });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    return await body(page, context.browser()?.version() ?? 'unknown');
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
}
