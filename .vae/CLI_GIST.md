# CLI gist

<!-- Commands future agents need that the Makefile verbs do not cover (setup, env, data, deploy):
- VERIFIED[purpose] `cmd`: only after an observed success
- UNKNOWN[purpose] BC gap
Budget 2 KiB (`vae.py doctor --repo .`); entries are injected at session start. -->
- VERIFIED[node matrix] `mise exec node@24 -- node node_modules/vitest/vitest.mjs run` (also node@20; same with `node scripts/package-test.mjs`)
- VERIFIED[bun matrix] `bun test tests/` and `bun scripts/package-test.mjs`
- VERIFIED[browser matrix] `bunx playwright install chromium firefox webkit` then `bun run test:browsers`
