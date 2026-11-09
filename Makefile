# Project interface: the same verbs for humans, agents and CI; `make` lists them.
# package.json scripts stay the primitives (`bun run <script>`, also used by
# prepublishOnly and Windows contributors); these targets only add ordering, so
# `build` runs once per make invocation.

# Optional local settings (see .env.example), exported to every recipe. Make parses
# the file, so `#` starts a comment and `$` must be written `$$`.
-include .env
ENV_KEYS := $(shell sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' .env 2>/dev/null)
ifneq ($(ENV_KEYS),)
export $(ENV_KEYS)
endif

# bun's installer default, so `make setup` can use bun right after installing it.
export PATH := $(PATH):$(HOME)/.bun/bin

.PHONY: help setup build site lint test coverage e2e verify release bench metrics start stop restart status log
.DEFAULT_GOAL := help

help: ## list the verbs with their usage (default goal)
	@awk -F':.*## ' '/^[a-zA-Z0-9_ -]+:.*## /{printf "  %-12s %s\n", $$1, $$2}' $(firstword $(MAKEFILE_LIST))

setup: ## install bun if missing, the locked dependencies, and Playwright's Chromium, Firefox and WebKit builds
	@command -v bun >/dev/null 2>&1 || curl -fsSL https://bun.sh/install | bash
	bun install --frozen-lockfile
	cd site && bun install --frozen-lockfile
	bunx playwright install chromium firefox webkit

build: ## clean ESM + CommonJS + declaration build into dist/
	bun run build

# GitHub Pages serves docs/ at storage.defuss.org; the site's demos import dist/.
site: build ## build the website (site/) into docs/: every route in English and German
	cd site && bun run build

# The tests and examples typecheck against the declarations in dist/, so lint builds first.
lint: build ## strict TypeScript check of src, tests, examples and site/, and oxlint; warnings fail
	bun run lint
	cd site && bun run lint

# The tests import dist/ (loaded natively, see vitest.config.ts), so they always
# exercise the bytes that get packed.
test: build ## vitest on Node.js: contract, fault, admission, process and DSON tests against dist/; site build modules
	bun run test
	cd site && bun run test

coverage: build ## vitest with V8 coverage of dist/*.mjs; the All files row ends with % lines
	bun run coverage

# OPFS runs only in a browser worker, so the browser suite is part of e2e, not of `test`.
e2e: site ## packed tarball in clean ESM/CJS/TS and worker-thread consumers + real OPFS in Chromium, Firefox, WebKit + the website in three browsers → output/
	bun run test:package
	bun run test:browsers
	cd site && bun run test:e2e

verify: lint test coverage e2e ## what CI runs: every gate verb, cheapest first

release: ## run verify, then package tarball + complete-codebase ZIP with SHA256SUMS in release/ (no publication)
	node scripts/release.mjs

# Report-only: run on a quiet machine (`uptime`) and compare figures within one report.
bench: build ## report-only benchmark vs 0.1.0: Node.js, Bun, and OPFS in Chromium, Firefox, WebKit → benchmarks/<version>-<os>-<arch>[-bun|-browsers].json
	bun run bench
	bun run bench:bun
	bun run bench:browsers

# A library has no service process and no runtime metrics to report.
metrics start stop restart status log: ; @echo "∅ $@: no service (library)"
