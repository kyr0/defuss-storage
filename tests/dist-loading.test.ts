// Guards vitest.config.ts: the suite must run the shipped bytes, not a
// Vite-rewritten copy. Coverage runs transform dist/ on purpose and leave this
// file out (see vitest.config.ts); bun test always loads dist/ natively.
import { expect, test } from 'vitest';
import { MemoryStorage } from '../dist/index.mjs';

test('dist/ is loaded as shipped, untransformed', () => {
  // VERIFIED: (probe) under Vite's SSR transform this line reads `(0,__vite_ssr_import_0__.h)(options)`.
  expect(String(MemoryStorage)).toContain('this.limits = handleLimits(options);');
});
