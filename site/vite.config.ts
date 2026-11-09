import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { pages } from './build/pages.ts';

// The demos import the package as an app would ('defuss-storage', 'defuss-storage/opfs',
// 'defuss-storage/directory');
// the aliases resolve those names to this repository's build (`make build`), so the
// site always shows the code that gets published, not the sources.
// VERIFIED: (make e2e) the site build runs after `make build` produced dist/.
const dist = (file: string) => fileURLToPath(new URL(`../dist/${file}`, import.meta.url));

export default defineConfig({
  publicDir: 'public',
  // Relative asset URLs: build/pages.ts re-roots them for each page's folder, so
  // the built files also render when opened from disk. VERIFIED: an absolute
  // /assets/ path resolves to file:///assets/ there and the page loses its CSS.
  base: './',
  resolve: {
    alias: [
      { find: /^defuss-storage\/opfs$/, replacement: dist('opfs.mjs') },
      { find: /^defuss-storage\/directory$/, replacement: dist('directory.mjs') },
      { find: /^defuss-storage$/, replacement: dist('index.mjs') },
    ],
  },
  build: {
    // GitHub Pages serves the repository's docs/ folder at storage.defuss.org.
    outDir: '../docs',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
  worker: { format: 'es' },
  server: { fs: { allow: ['..'] } },
  plugins: [pages()],
});
