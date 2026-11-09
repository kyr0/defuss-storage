import { configDefaults, defineConfig } from 'vitest/config';

// VERIFIED: (probe, vitest 4.1.12) Vite's SSR transform rewrites dist/ by default
// (`handleLimits(x)` becomes `(0,__vite_ssr_import_0__.h)(x)`). Externalizing dist/
// makes Node load the shipped bytes untransformed, so `vitest run` tests exactly
// what gets packed.
// VERIFIED: (probe) V8 coverage of externalized modules is misattributed: vitest
// remaps it through a transform that never ran (86.09% reported, with lines the
// suite asserts on marked uncovered). Coverage runs therefore let vitest transform
// dist/ (98.67%); the transform changes only how imported bindings are accessed.
// Any coverage flag counts (`--coverage`, `--coverage.enabled=true`, ...).
const coverageRun = process.argv.some(arg => arg.startsWith('--coverage'));

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // dist-loading.test.ts guards the externalization below, which coverage runs drop on purpose.
    exclude: coverageRun ? [...configDefaults.exclude, 'tests/dist-loading.test.ts'] : configDefaults.exclude,
    server: { deps: { external: coverageRun ? [] : [/\/dist\//] } },
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      // The built ESM modules the tests import. The CommonJS twins are the same
      // source compiled twice. opfs.mjs, directory.mjs and their shared Web Locks
      // chunk need a browser; the browser suite (`bun run test:browsers`) covers
      // them behaviorally in Chromium, Firefox and WebKit.
      include: ['dist/*.mjs'],
      exclude: ['dist/opfs.mjs', 'dist/directory.mjs', 'dist/locks-*.mjs'],
    },
  },
});
