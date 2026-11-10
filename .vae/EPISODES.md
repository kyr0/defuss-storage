# Episodes

<!-- Newest last. The gate appends FAIL|DONE|FINDING; past 100 entries it trims only its own oldest DONE|FAIL|learned
FINDING (git keeps them). Leads (LESSON, FINDING learn=none) stay until wrap settles them; doctor fails above 30.
Agents append `<UTC ISO> s=<session> LESSON <VAE-DIALECT>` only for a falsified HYPOTHESIS, a dead end, or a root cause.
Session start injects the 3 newest open entries: LESSON, FINDING learn=none, FAIL without a later DONE.
Wrap: EVERY lead becomes a test | .vae/VERIFY.py rule | one MEMORY line with BC, then delete; OR delete BC evidence. -->

2026-11-08T08:22:20Z s=3acf4600 FINDING src/errors.ts:StorageErrorCode learn=none: fixed structurally: the union is derived from CODE_LIST, so drift cannot be expressed; packed-consumer typecheck passes
2026-11-08T08:22:20Z s=3acf4600 FINDING scripts/bench.mjs:sequentialSuite learn=none: lines now start with ISO time + INFO; one script, no mechanical rule needed
2026-11-08T08:22:20Z s=3acf4600 FINDING ARCH.md:57 P07 learn=none: page corrected to the code's actual order
2026-11-08T08:22:20Z s=3acf4600 FINDING README.md:116 B05 learn=none: restored to the tested condition, untested part stated
2026-11-08T08:22:20Z s=3acf4600 FINDING README.md:110 B01 learn=none: claim narrowed to terminated workers
2026-11-08T08:22:20Z s=3acf4600 FINDING README.md:240 B02 learn=none: coverage of each path stated (native tested, OPFS code review)
2026-11-08T08:22:20Z s=3acf4600 FINDING VALIDATION.md:33 P09 learn=none: rewritten as current state
2026-11-08T08:22:20Z s=3acf4600 FINDING STORAGE_NEXT_PLAN.md:16,211 T02/T06 learn=none: rewritten without changing the plan's meaning; prose check passes
2026-11-08T08:22:20Z s=3acf4600 FINDING examples/dson-frames.mjs:1, scripts/bench.mjs:sequentialRun|large learn=none: comment-only additions; example and release rerun green
2026-11-08T08:22:20Z s=3acf4600 FINDING scripts/clean.mjs, package.json:scripts.build learn=none: replaced by `pkgroll --clean-dist`; dist/ SHA-256 of all 16 files identical before and after; script deleted
2026-11-08T08:55:35Z s=3acf4600 FINDING vitest.config.ts:coverage learn=none: coverage runs transform dist/ and exclude the guard file; documented in vitest.config.ts and VALIDATION.md
2026-11-08T08:55:35Z s=3acf4600 FINDING vitest.config.ts:coverageRun learn=none: prefix match; `vitest run --coverage.enabled=true` now reports 98.67%
2026-11-08T08:55:35Z s=3acf4600 FINDING vitest.config.ts:env DEFUSS_DIST_TRANSFORMED learn=none: replaced by excluding tests/dist-loading.test.ts in coverage runs; no env var remains
2026-11-08T08:55:35Z s=3acf4600 FINDING package.json:devDependencies.vitest learn=none: vitest 4.1.12 (engines ^20 || ^22 || >=24) pinned; Node 20.20.2 and 24.22.2 run 88/88; upgrade trigger: dropping Node 20
2026-11-08T08:55:35Z s=3acf4600 FINDING src/file.ts:7 learn=none: points to tests/contract.ts
2026-11-08T10:16:53Z s=3acf4600 FINDING src/file.ts:enqueue learn=none: folded into one then(onFulfilled, onRejected); per-operation probe: 0.83–0.91 µs vs 0.90–0.99 µs in 0.1.0
2026-11-08T10:16:53Z s=3acf4600 FINDING src/file.ts:enqueue comment learn=none: comment states only the measured per-operation parity
2026-11-08T10:16:53Z s=3acf4600 FINDING VALIDATION.md:benchmark P07/B01 learn=none: section rewritten with medians and ranges; the falsified hypothesis is recorded as such
2026-11-08T10:16:53Z s=3acf4600 FINDING scripts/bench.mjs:offsets learn=none: array built with push; lint clean
2026-11-08T11:06:48Z s=3acf4600 FINDING src/file.ts:stream (read-ahead) learn=none: read ahead only after the consumer spent >=5 µs on the previous chunk (READ_AHEAD_AFTER_MS); timing-dependent, so no deterministic test; bench row stream+checks
2026-11-08T11:26:51Z s=3acf4600 FINDING VALIDATION.md:Not established learn=none: line now says main thread on Node.js and Bun only, not in a worker thread
2026-11-08T11:26:51Z s=3acf4600 FINDING README.md:Performance (transfer) learn=none: README and VALIDATION state the gain is not established and cite only the probed copy cost (24 µs per MiB)
2026-11-08T17:01:05Z s=3acf4600 FINDING README.md:298 P (precision) learn=none: one-off wording; the load note now states the measured load
2026-11-08T17:01:05Z s=3acf4600 FINDING CHANGELOG.md:28 P (precision) learn=none: one-off wording; baseline named
2026-11-08T17:01:05Z s=3acf4600 FINDING VALIDATION.md:52 B (evidence) learn=none: replaced by the measured spread
2026-11-08T17:01:05Z s=3acf4600 FINDING VALIDATION.md:111 B (evidence) learn=none: claim narrowed to macOS arm64 in Not established
2026-11-08T17:01:05Z s=3acf4600 FINDING VALIDATION.md:117 B (evidence) learn=none: cause of the 0.1 us not established; listed under Not established, no test for a hypothesis
2026-11-08T17:02:00Z s=3acf4600 FINDING VALIDATION.md:15 B (evidence) learn=none: row now gives both observed runs; no source change
2026-11-08T17:52:31Z s=3acf4600 FINDING scripts/bench-browsers.mjs:page.evaluate learn=none: 30-minute page-side timer resolves with an error; report-only script, no test
2026-11-08T17:52:31Z s=3acf4600 FINDING scripts/package-test.mjs:writeWorkerConsumer (worker.mjs) learn=none: finally clears the interval; 120 s timeout on the worker consumer run
2026-11-08T17:52:31Z s=3acf4600 FINDING scripts/package-test.mjs:worker.mjs learn=none: worker.mjs removes its directory; leftovers deleted
2026-11-08T17:52:31Z s=3acf4600 FINDING scripts/bench.mjs:large (Bun) learn=none: comment and VALIDATION cite the discriminating probe
2026-11-08T17:52:31Z s=3acf4600 FINDING VALIDATION.md:Browsers (OPFS) B (evidence) learn=none: cause not established; recorded under Not established, README and CHANGELOG; no test for an unknown cause
2026-11-08T19:12:59Z s=3acf4600 FINDING src/file.ts:readInto|readExactly (async task) learn=none: tasks chain fill() from plain functions; timing is not a test subject (report-only)
2026-11-08T19:12:59Z s=3acf4600 FINDING src/file.ts:read (currentSize) learn=none: uses knownSize ?? await currentSize(), as size() does
2026-11-08T19:12:59Z s=3acf4600 FINDING src/file.ts:admit/release (closures) learn=none: admission tests still check counters return to zero
2026-11-08T19:12:59Z s=3acf4600 FINDING VALIDATION.md:Browsers (OPFS) L (logic) learn=none: claim removed; section records the removal probe and that per-call cost does not explain it
2026-11-08T19:12:59Z s=3acf4600 FINDING VALIDATION.md:Read path after profiling B (evidence) learn=none: figures replaced by the measured ones in VALIDATION and src comments
2026-11-08T19:12:59Z s=3acf4600 FINDING benchmarks/*.json learn=none: kept quieter pre-fix reports, labelled as pre-fix; re-run listed under Not established
2026-11-08T20:59:13Z s=3acf4600 FINDING benchmarks/*.json learn=none: docs quote the published third run and state cross-run spreads
2026-11-08T20:59:13Z s=3acf4600 FINDING VALIDATION.md:Benchmark B (evidence) learn=none: bullet and Not established item updated
2026-11-08T20:59:13Z s=3acf4600 FINDING VALIDATION.md:Bun memory stream learn=none: recorded as within Bun's run-to-run spread
2026-11-09T09:08:09Z s=3acf4600 FINDING CHANGELOG.md:transfer (stale performance claim) learn=none: the changelog now states the measured copy-cost saving and overlapping end-to-end ranges; no timing threshold was added
2026-11-09T13:01:38Z s=3acf4600 FINDING site/src/demos/storage.worker.ts:limitsFor learn=none: UI clamp; the e2e covers the default budget only
2026-11-09T13:01:38Z s=3acf4600 FINDING site/index.html:theme-color, site/src/install.ts:copyButton, site/src/messages.ts learn=none: cosmetic; no deterministic check worth adding
2026-11-09T14:05:47Z s=3acf4600 DONE fp=a44462f783fc cov=99.2% paths=.oxlintrc.json,Makefile,README.md,docs/404.html(+69)
2026-11-09T14:05:47Z s=3acf4600 FINDING site/vite.config.ts:base learn=test: e2e 'pages opened from disk' and unit test rootUrls
2026-11-09T14:05:47Z s=3acf4600 FINDING site/build/i18n.ts:localize learn=test: test/build.test.ts repeated-key test
2026-11-09T14:05:47Z s=3acf4600 FINDING site/src/router.ts:pinImageUrls learn=test: demo e2e fails on any console 404
2026-11-09T14:44:39Z s=3acf4600 FAIL tests.e2e.1
2026-11-09T15:10:09Z s=3acf4600 DONE fp=60138d82bd1a cov=99.2% paths=.oxlintrc.json,Makefile,README.md,docs/404.html(+72)
2026-11-09T15:10:09Z s=3acf4600 FINDING site/index.html:#toast-container learn=test: the axe e2e test fails on it
2026-11-09T15:10:09Z s=3acf4600 FINDING site/src/demos/status.ts:notify learn=test: demo e2e asserts the toast code spans
2026-11-09T15:10:09Z s=3acf4600 FINDING site/e2e/site.test.mjs:install commands learn=test: the assertion now checks computed colours, so a markup change that drops highlighting still fails it
2026-11-09T15:17:33Z s=3acf4600 DONE fp=2397b90737ba cov=99.2% paths=.oxlintrc.json,Makefile,README.md,docs/404.html(+72)
2026-11-09T15:17:33Z s=3acf4600 FINDING site/index.html:inline file script; site/src/router.ts:go learn=test: the from-disk e2e test switches language and follows a header link in three engines
2026-11-09T17:23:32Z s=3acf4600 FAIL tests.unit
2026-11-09T17:24:13Z s=3acf4600 FAIL tests.unit
2026-11-09T17:39:54Z s=3acf4600 DONE fp=518124022171 cov=99.2% paths=.oxlintrc.json,Makefile,README.md,docs/404.html(+74)
2026-11-09T17:39:54Z s=3acf4600 FINDING site/src/demos/persist.ts:submit learn=test: demo e2e asserts Append is disabled for an empty line in three engines
2026-11-09T17:39:54Z s=3acf4600 FINDING site/src/demos/seek.ts:jump learn=test: demo e2e asserts a seek adds no toast
2026-11-09T17:39:54Z s=3acf4600 FINDING site/src/router.ts:afterCommit learn=test: the WebKit demo test reaches the benchmark by client navigation from deep in the page
2026-11-09T17:39:54Z s=3acf4600 FINDING site/test/build.test.ts:renderVariant learn=test: the test checks localization, not copy
2026-11-09T18:11:07Z s=3acf4600 FAIL tests.e2e.1
2026-11-09T18:17:00Z s=3acf4600 DONE fp=bdf7966b8a4c cov=99.2% paths=.oxlintrc.json,ARCH.md,CHANGELOG.md,Makefile(+86)
2026-11-09T18:17:00Z s=3acf4600 FINDING src/directory.ts:exact learn=test: the shared write-buffer contract case runs on the directory adapter in WebKit
2026-11-09T18:17:00Z s=3acf4600 FINDING src/directory.ts:DirectoryHandle learn=test: site lint type-checks the worker passing a DOM handle
2026-11-09T18:17:00Z s=3acf4600 FINDING site/index.html:toggle data-t learn=none: visual; markup pattern documented by the fix
2026-11-09T19:22:02Z s=3acf4600 FAIL tests.unit,tests.e2e.1
2026-11-09T19:27:30Z s=3acf4600 FAIL tests.e2e.1
2026-11-09T19:33:50Z s=3acf4600 DONE fp=93efeb10aac6 cov=99.2% paths=.oxlintrc.json,ARCH.md,CHANGELOG.md,Makefile(+86)
2026-11-09T20:37:10Z s=3acf4600 FAIL tests.e2e.1
2026-11-09T20:42:30Z s=3acf4600 DONE fp=89325d87fdc2 cov=99.2% paths=.oxlintrc.json,ARCH.md,CHANGELOG.md,Makefile(+84)
2026-11-09T20:42:30Z s=3acf4600 FINDING site/e2e/site.test.mjs:routing test learn=test: the test now filters the 404 status line as the route test already did; site e2e 23/23 pass
2026-11-09T20:50:06Z s=3acf4600 FAIL prose
2026-11-09T20:55:29Z s=3acf4600 FAIL tests.e2e.1
2026-11-09T20:58:41Z s=3acf4600 DONE fp=9844a30af50c cov=99.2% paths=.oxlintrc.json,ARCH.md,CHANGELOG.md,Makefile(+84)
2026-11-09T20:58:41Z s=3acf4600 FINDING site/e2e/site.test.mjs:597 demos in firefox learn=none: one load-related timeout; no deterministic defect to encode; .vae/MEMORY.md already says other sessions load the machine
2026-11-10T02:04:22Z s=3acf4600 FAIL tests.e2e.1
2026-11-10T02:36:49Z s=3acf4600 DONE fp=201e77786816 cov=99.2% paths=docs/404.html,docs/assets/backend-But3-ao0.js,docs/assets/backend-ChSdQFFH.js,docs/assets/index-B6HYNZ1Y.css(+23)
2026-11-10T02:36:49Z s=3acf4600 FINDING site/src/styles.css:html font-size 125% learn=memory: .vae/MEMORY.md: breakpoints that must follow html font-size are container queries
2026-11-10T02:36:49Z s=3acf4600 FINDING site/index.html:hero snippet, explorer table learn=test: the e2e axe check covers it
2026-11-10T02:36:49Z s=3acf4600 FINDING site/src/styles.css:seek and playground demos learn=test: the e2e fit and persistence checks cover it
2026-11-10T02:55:10Z s=3acf4600 DONE fp=8e5c4a6ab9e3 cov=99.2% paths=.github/workflows/verify.yml
2026-11-10T02:55:10Z s=3acf4600 FINDING .github/workflows/verify.yml:node job learn=verifier: .vae/VERIFY.py rule ci.build-before-lint; it fails on the old step order and passes on the new
2026-11-10T10:59:23Z s=b982f14b DONE fp=2b60a51578b5 cov=99.2% paths=docs/404.html,docs/assets/backend-BpSSYiP1.js,docs/assets/backend-But3-ao0.js,docs/assets/index-B6HYNZ1Y.css(+24)
2026-11-10T10:59:23Z s=b982f14b FINDING site/src/styles.css:.st-fly-stage still composition learn=test: e2e 'flythrough words stand apart' fails on the old stylesheet and passes now, in Chromium (reduced motion) and Firefox
2026-11-10T10:59:23Z s=b982f14b FINDING site/src/styles.css:.diagram.st-layers node columns learn=test: e2e 'phones and tablets read at 75% type' requires every layer name to be at least 12rem wide at five widths in both languages
2026-11-10T10:59:23Z s=b982f14b FINDING site/src/styles.css:--st-fly-band learn=none: no behaviour differed (the invalid height computed to auto, the stage's height), so no test can tell the two apart
2026-11-10T10:59:23Z s=b982f14b FINDING site/e2e/site.test.mjs:apart learn=test: the test is the check; it passes in both engines
2026-11-10T10:59:23Z s=b982f14b FINDING site/src/styles.css:.st-diagram .diagram-canvas zoom learn=none: a rendered size inside a zoomed third-party canvas is visual; a test would pin the component's zoom floor
2026-11-10T10:59:23Z s=b982f14b FINDING site/src/chart-options.ts:ONE_ROW_LEGEND learn=none: overlap of SVG text drawn by ECharts is visual; a test on the option object would only pin configuration
2026-11-10T10:59:23Z s=b982f14b FINDING site/ARCH.md:92 P09, site/ARCH.md:185 P03 learn=verifier: the gate's prose step checks the page
2026-11-10T11:11:47Z s=b982f14b DONE fp=8ff9d962724a cov=99.2% paths=docs/404.html,docs/assets/backend-But3-ao0.js,docs/assets/backend-DmXCHghL.js,docs/assets/index-B6HYNZ1Y.css(+24)
2026-11-10T11:11:47Z s=b982f14b FINDING site/src/styles.css:html font-size learn=test: e2e 'phones and tablets read at three quarters of the desktop type size' asserts the root share at five widths; it fails on the old stylesheet
2026-11-10T11:11:47Z s=b982f14b FINDING site/src/styles.css:.diagram.st-layers node columns learn=test: the type-size e2e test requires every layer name to be at least 12rem wide at five widths in both languages
2026-11-10T11:11:47Z s=b982f14b FINDING site/src/styles.css:.tabs.st-tabs .st-tab padding learn=none: a probe from 320 to 1920px in both languages reports no clipped tab, button or badge; a test would pin label widths of one font
2026-11-10T11:11:47Z s=b982f14b FINDING site/src/styles.css:.st-tests, mk-cta threshold, footer columns learn=none: visual measure; the same probe shows the column counts at fifteen widths, and a test would pin copy lengths
2026-11-10T11:11:47Z s=b982f14b FINDING site/src/chart-options.ts:ONE_ROW_LEGEND, optionsOption xAxis learn=none: positions of SVG text drawn by ECharts are visual; a test on the option object would only pin configuration
2026-11-10T11:11:47Z s=b982f14b FINDING site/ARCH.md:80-96, 186-187 learn=verifier: the gate's prose step checks the page
