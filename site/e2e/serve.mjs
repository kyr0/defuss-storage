// A static server that answers like GitHub Pages: a directory serves its
// index.html, a path without a trailing slash that names a directory redirects
// to the slash form, and anything missing gets /404.html with status 404.
// Used by the e2e suite and by `node e2e/serve.mjs [port]` for a local look.
// VERIFIED: (site e2e) every route, a deep link and an unknown path load through it.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain',
};

/** Serves `root` on 127.0.0.1; resolves to the listening server. */
export async function servePages(root, port = 0) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let file = path.join(root, decodeURIComponent(url.pathname));
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
      let info = await stat(file).catch(() => null);
      if (info?.isDirectory()) {
        if (!url.pathname.endsWith('/')) { res.writeHead(301, { location: `${url.pathname}/${url.search}` }).end(); return; }
        file = path.join(file, 'index.html');
        info = await stat(file).catch(() => null);
      }
      if (!info) {
        res.writeHead(404, { 'content-type': TYPES['.html'] }).end(await readFile(path.join(root, '404.html')));
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../docs', import.meta.url));
  const server = await servePages(root, Number(process.argv[2] ?? 4173));
  process.stdout.write(`${new Date().toISOString()} INFO serving root=${root} url=http://127.0.0.1:${server.address().port}/\n`);
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
