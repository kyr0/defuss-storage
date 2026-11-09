# Episodes

<!-- Newest last. The gate appends FAIL|DONE|FINDING; past 100 entries it trims only its own oldest DONE|FAIL|learned
FINDING (git keeps them). Leads (LESSON, FINDING learn=none) stay until wrap settles them; doctor fails above 30.
Agents append `<UTC ISO> s=<session> LESSON <VAE-DIALECT>` only for a falsified HYPOTHESIS, a dead end, or a root cause.
Session start injects the 3 newest open entries: LESSON, FINDING learn=none, FAIL without a later DONE.
Wrap: EVERY lead becomes a test | .vae/VERIFY.py rule | one MEMORY line with BC, then delete; OR delete BC evidence. -->

2026-11-08T08:11:58Z s=3acf4600 FAIL prose,toolchain
2026-11-08T08:22:20Z s=3acf4600 DONE fp=72a91e25f04a cov=98.9% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+28)
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
2026-11-08T08:53:41Z s=3acf4600 FAIL env.example
2026-11-08T08:55:35Z s=3acf4600 DONE fp=98c5cb249d38 cov=98.7% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+34)
2026-11-08T08:55:35Z s=3acf4600 FINDING vitest.config.ts:server.deps.external learn=test: tests/dist-loading.test.ts fails if dist/ is no longer loaded natively
2026-11-08T08:55:35Z s=3acf4600 FINDING vitest.config.ts:coverage learn=none: coverage runs transform dist/ and exclude the guard file; documented in vitest.config.ts and VALIDATION.md
2026-11-08T08:55:35Z s=3acf4600 FINDING vitest.config.ts:coverageRun learn=none: prefix match; `vitest run --coverage.enabled=true` now reports 98.67%
2026-11-08T08:55:35Z s=3acf4600 FINDING vitest.config.ts:env DEFUSS_DIST_TRANSFORMED learn=none: replaced by excluding tests/dist-loading.test.ts in coverage runs; no env var remains
2026-11-08T08:55:35Z s=3acf4600 FINDING package.json:devDependencies.vitest learn=none: vitest 4.1.12 (engines ^20 || ^22 || >=24) pinned; Node 20.20.2 and 24.22.2 run 88/88; upgrade trigger: dropping Node 20
2026-11-08T08:55:35Z s=3acf4600 FINDING src/file.ts:7 learn=none: points to tests/contract.ts
2026-11-08T10:16:53Z s=3acf4600 DONE fp=e757a1054b24 cov=98.8% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+34)
2026-11-08T10:16:53Z s=3acf4600 FINDING src/file.ts:currentSize learn=test: handle.test.ts 'queries the backend size once' (failed before: one query per call) and 'failed mutation or short read' re-query test
2026-11-08T10:16:53Z s=3acf4600 FINDING src/file.ts:enqueue (overlap) learn=test: byte budget equal to maxReadBytes; native.test.ts 'stay within maxReadBytes together and start in call order' (failed before)
2026-11-08T10:16:53Z s=3acf4600 FINDING src/file.ts:enqueue learn=none: folded into one then(onFulfilled, onRejected); per-operation probe: 0.83–0.91 µs vs 0.90–0.99 µs in 0.1.0
2026-11-08T10:16:53Z s=3acf4600 FINDING src/file.ts:enqueue comment learn=none: comment states only the measured per-operation parity
2026-11-08T10:16:53Z s=3acf4600 FINDING VALIDATION.md:benchmark P07/B01 learn=none: section rewritten with medians and ranges; the falsified hypothesis is recorded as such
2026-11-08T10:16:53Z s=3acf4600 FINDING scripts/bench.mjs:offsets learn=none: array built with push; lint clean
2026-11-08T11:06:48Z s=3acf4600 DONE fp=7fad0c8c5e34 cov=99.0% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+34)
2026-11-08T11:06:48Z s=3acf4600 FINDING src/file.ts:stream (read-ahead) learn=none: read ahead only after the consumer spent >=5 µs on the previous chunk (READ_AHEAD_AFTER_MS); timing-dependent, so no deterministic test; bench row stream+checks
2026-11-08T11:06:48Z s=3acf4600 FINDING tests/handle.test.ts:'cancellation removes an append from its batch' learn=test: signal now fires after the call and before the batch starts; coverage run shows the branch covered (file module 99.18% lines, only the allocation-failure path u
2026-11-08T11:06:48Z s=3acf4600 FINDING ARCH.md:137 B01 learn=verifier: sentence moved to VALIDATION.md 'Not established for 0.2.0'; vae prose reports 0 findings on all four pages
2026-11-08T11:06:48Z s=3acf4600 FINDING VALIDATION.md:Benchmark learn=memory: per-operation probe (7 x 100k appends) found no regression: 0.96 vs 1.24 µs median; load recorded in VALIDATION; .vae/MEMORY.md line: check uptime before benchm
2026-11-08T11:26:51Z s=3acf4600 DONE fp=b7a3816c2014 cov=99.1% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+34)
2026-11-08T11:26:51Z s=3acf4600 FINDING src/file.ts:append (write-buffer condition) learn=test: condition requires this.capacity && ...; the existing batching test passes again
2026-11-08T11:26:51Z s=3acf4600 FINDING tests/handle.test.ts:write buffer learn=test: added 'a cancelled queued append keeps earlier buffered bytes at their offsets'; removing operations === 0 from the direct path makes it fail (mutation check); 
2026-11-08T11:26:51Z s=3acf4600 FINDING VALIDATION.md:Not established learn=none: line now says main thread on Node.js and Bun only, not in a worker thread
2026-11-08T11:26:51Z s=3acf4600 FINDING VALIDATION.md:benchmark (library overhead) learn=memory: VALIDATION records the interleaved figures; .vae/MEMORY.md line: compare timings only interleaved within one run
2026-11-08T11:26:51Z s=3acf4600 FINDING README.md:Performance (transfer) learn=none: README and VALIDATION state the gain is not established and cite only the probed copy cost (24 µs per MiB)
2026-11-08T17:01:05Z s=3acf4600 DONE fp=ab64a1026acf cov=99.1% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+34)
2026-11-08T17:01:05Z s=3acf4600 FINDING README.md:298 P (precision) learn=none: one-off wording; the load note now states the measured load
2026-11-08T17:01:05Z s=3acf4600 FINDING CHANGELOG.md:28 P (precision) learn=none: one-off wording; baseline named
2026-11-08T17:01:05Z s=3acf4600 FINDING VALIDATION.md:52 B (evidence) learn=none: replaced by the measured spread
2026-11-08T17:01:05Z s=3acf4600 FINDING VALIDATION.md:111 B (evidence) learn=none: claim narrowed to macOS arm64 in Not established
2026-11-08T17:01:05Z s=3acf4600 FINDING VALIDATION.md:117 B (evidence) learn=none: cause of the 0.1 us not established; listed under Not established, no test for a hypothesis
2026-11-08T17:02:00Z s=3acf4600 DONE fp=ed0b0b293288 cov=99.1% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+34)
2026-11-08T17:02:00Z s=3acf4600 FINDING VALIDATION.md:15 B (evidence) learn=none: row now gives both observed runs; no source change
2026-11-08T17:52:31Z s=3acf4600 DONE fp=ca1e09861c99 cov=99.1% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+40)
2026-11-08T17:52:31Z s=3acf4600 FINDING scripts/bench-browsers.mjs:page.evaluate learn=none: 30-minute page-side timer resolves with an error; report-only script, no test
2026-11-08T17:52:31Z s=3acf4600 FINDING scripts/package-test.mjs:writeWorkerConsumer (worker.mjs) learn=none: finally clears the interval; 120 s timeout on the worker consumer run
2026-11-08T17:52:31Z s=3acf4600 FINDING scripts/package-test.mjs:worker.mjs learn=none: worker.mjs removes its directory; leftovers deleted
2026-11-08T17:52:31Z s=3acf4600 FINDING scripts/bench.mjs:large (Bun) learn=none: comment and VALIDATION cite the discriminating probe
2026-11-08T17:52:31Z s=3acf4600 FINDING VALIDATION.md:Browsers (OPFS) B (evidence) learn=none: cause not established; recorded under Not established, README and CHANGELOG; no test for an unknown cause
2026-11-08T17:52:31Z s=3acf4600 FINDING VALIDATION.md:Not established P (precision) learn=test: scripts/package-test.mjs worker consumer; mutation checks (wrong offset, impossible tick count) fail it
2026-11-08T19:12:59Z s=3acf4600 DONE fp=8dfd0b078a30 cov=99.1% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+40)
2026-11-08T19:12:59Z s=3acf4600 FINDING src/file.ts:stream (read-ahead timing) learn=test: timed every 8th chunk (READ_AHEAD_SAMPLE_EVERY); read-ahead tests fail when the first chunk is not timed (mutation run)
2026-11-08T19:12:59Z s=3acf4600 FINDING src/file.ts:readInto|readExactly (async task) learn=none: tasks chain fill() from plain functions; timing is not a test subject (report-only)
2026-11-08T19:12:59Z s=3acf4600 FINDING src/file.ts:read (currentSize) learn=none: uses knownSize ?? await currentSize(), as size() does
2026-11-08T19:12:59Z s=3acf4600 FINDING src/file.ts:admit/release (closures) learn=none: admission tests still check counters return to zero
2026-11-08T19:12:59Z s=3acf4600 FINDING tests/contract.ts:write buffer case learn=test: case now reads buffered appends through readInto and readExactly; both mutations fail 3 tests
2026-11-08T19:12:59Z s=3acf4600 FINDING VALIDATION.md:Browsers (OPFS) L (logic) learn=none: claim removed; section records the removal probe and that per-call cost does not explain it
2026-11-08T19:12:59Z s=3acf4600 FINDING VALIDATION.md:Read path after profiling B (evidence) learn=none: figures replaced by the measured ones in VALIDATION and src comments
2026-11-08T19:12:59Z s=3acf4600 FINDING benchmarks/*.json learn=none: kept quieter pre-fix reports, labelled as pre-fix; re-run listed under Not established
2026-11-08T20:59:13Z s=3acf4600 DONE fp=ad51a06f5b7e cov=99.1% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+40)
2026-11-08T20:59:13Z s=3acf4600 FINDING benchmarks/*.json learn=none: docs quote the published third run and state cross-run spreads
2026-11-08T20:59:13Z s=3acf4600 FINDING VALIDATION.md:Benchmark B (evidence) learn=none: bullet and Not established item updated
2026-11-08T20:59:13Z s=3acf4600 FINDING VALIDATION.md:Bun memory stream learn=none: recorded as within Bun's run-to-run spread
2026-11-09T09:08:09Z s=3acf4600 DONE fp=ce2ca308f2e3 cov=99.2% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+40)
2026-11-09T09:08:09Z s=3acf4600 FINDING src/file.ts:fill|readExactly (internal async promise) learn=test: the mixed sync/async partial-read regression test checks offsets, windows and returned bytes through the new continuation; timings stay report-only
2026-11-09T09:08:09Z s=3acf4600 FINDING CHANGELOG.md:transfer (stale performance claim) learn=none: the changelog now states the measured copy-cost saving and overlapping end-to-end ranges; no timing threshold was added
