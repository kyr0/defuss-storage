# Validation

## 0.3.0 (unreleased), 2026-11-09

Run on the same machine as 0.2.0 (macOS, Apple arm64). Only these checks ran
for the directory adapter; the Node.js 24 and 20 and Bun test runs of 0.2.0
were not repeated.

| Check | Environment | Result |
| --- | --- | --- |
| `make lint` | TypeScript 5.9.3, oxlint 1.89.0 | Passed, 0 warnings |
| Test suite (vitest 4.1.12) | Node.js 26.11.1 | 148 tests passed |
| `make coverage` | vitest 4.1.12 V8 provider, `dist/*.mjs` without the browser-only modules | 99.15% lines |
| Packed consumers | `bun pm pack` + `bun add`, Node.js 26.11.1 | ESM, CommonJS and declarations of all four entry points |
| Browser suite | Chromium 151.0.7922.34 (Playwright 1.62.1) | 108 passed |
| Browser suite | Firefox 153.0 (Playwright 1.62.1) | 108 passed |
| Browser suite | WebKit 26.5 (Playwright 1.62.1) | 108 passed |

The 108 browser tests per engine are the 72 of 0.2.0, the 33 contract cases
and DSON integration on `createDirectoryStorage` over an OPFS directory handle,
two-worker ownership through the directory adapter's Web Locks, and use on the
main thread. The first WebKit run failed the write-buffer case: WebKit's
writable stream writes the whole buffer behind a `Uint8Array` view, so the
adapter now passes exact-length ArrayBuffers. The folder picker dialog needs a
user gesture and is not automated; the site's end-to-end test stands in an OPFS
folder for it.

## 0.2.0, 2026-11-07

Every row below was executed on one machine: macOS (Darwin 25.6.0), Apple
arm64. Nothing else in the CI matrix was run for this release.

| Check | Environment | Result |
| --- | --- | --- |
| `make lint` | TypeScript 5.9.3, oxlint 1.89.0 | Passed, 0 warnings |
| Test suite (vitest 4.1.12) | Node.js 26.11.1 | 148 tests passed |
| Test suite (vitest 4.1.12) | Node.js 24.22.2 (mise) | 148 tests passed |
| Test suite (vitest 4.1.12) | Node.js 20.20.2 (mise) | 148 tests passed |
| Test suite (`bun test`) | Bun 1.4.3 | 148 tests passed |
| `make coverage` | vitest 4.1.12 V8 provider, Node.js 26.11.1, `dist/*.mjs` | 99.15% lines |
| Packed consumers | `bun pm pack` + `bun add` (bun 1.4.3); consumers run on Node.js 26.11.1, 24.22.2, 20.20.2 and Bun 1.4.3 | ESM, CommonJS, declarations, no platform import in the root graph, synchronous I/O in a worker thread |
| Browser suite | Chromium 151.0.7922.34 (Playwright 1.62.1) | 72 passed |
| Browser suite | Firefox 153.0 (Playwright 1.62.1) | 72 passed |
| Browser suite | WebKit 26.5 (Playwright 1.62.1) | 72 passed |
| Examples (TypeScript) | Bun 1.4.3; Node.js 26.11.1 and 24.22.2 type stripping | DSON seek/stream and SHA-256-verified ingestion passed |

The 148 tests are 33 shared contract cases and one DSON integration case for
each of the memory adapter and the native adapter with asynchronous and with
synchronous I/O (102), 45 handle, fault, admission, size-tracking, read-overlap,
append-batching, read-ahead, write-buffer, `appendChunks`, synchronous-I/O and
process tests, and one check that the suite loads `dist/` untransformed. That
check is left out of coverage runs, which let vitest transform `dist/` because
V8 coverage of untransformed modules is misattributed (86.09% reported against
98.67%, with asserted lines marked uncovered). The 72 browser tests per engine are the 33 contract
cases plus DSON integration for memory and for real OPFS, main-thread
rejection, two-worker ownership with a fresh-worker reopen, worker termination
followed by a fresh-worker reopen, and foreign directories.

The packed-consumer check also starts a worker thread that imports the
installed package and runs the native adapter with `io: "sync"`: batched
appends, a buffer transferred from the main thread and handed over with
`transfer`, positional write, reads, a stream, truncate, flush, and a
write-buffered handle fed by `appendChunks`. The main thread then reads every
byte back through the async adapter, and its 5 ms timer must keep firing while
the worker spends 200 ms in blocking writes (at least a tenth of the expected
ticks). VERIFIED: (probe) the timer fired 38 to 40 times in 200 ms on Node.js
26 and 20 and Bun. The check fails when an offset is wrong or when it demands
more ticks than 200 ms allow (both tried).

Findings made while running this matrix:

- WebKit rejects `navigator.storage.getDirectory()` with `UnknownError` in an
  ephemeral context (Playwright's default) and works in a persistent profile,
  so the browser runner uses persistent profiles for every engine.
- Worker termination released the OPFS lock on the first reopen attempt in
  all three engines.
- Process kill: a child process killed with SIGKILL while holding a native
  handle left no ownership behind. Its flushed bytes, and one unflushed append
  already in the OS page cache, were readable by the test process. This shows
  process recovery, not power-loss durability.

### Benchmark

`benchmarks/0.2.0-darwin-arm64.json` holds the full report: Node.js 26.11.1,
5 repetitions, a 32 MiB deterministic dataset per run, chunk sizes of 4 KiB,
64 KiB and 1 MiB, versions interleaved with alternating order, each figure with
its median and its range over the repetitions. Timings are warm-cache and
report-only; they are not CI thresholds. Compare versions within one report:
absolute figures move between whole runs (see below).

Native files, 0.2.0 against 0.1.0, medians with ranges:

| Workload | 0.2.0 | 0.1.0 |
| --- | --- | --- |
| Append, 4 KiB chunks, awaited one by one | 316 MiB/s (311–322) | 182 MiB/s (164–187) |
| Append, 64 KiB chunks, awaited | 4,085 MiB/s (3,887–4,208) | 2,371 MiB/s (1,965–2,483) |
| Append, 1 MiB chunks, awaited | 10,187 MiB/s (10,033–10,389) | 9,055 MiB/s (8,864–9,648) |
| Append, 4 KiB chunks, 16 in flight | 2,444 MiB/s (1,573–2,733) | 188 MiB/s (116–189) |
| Append, 64 KiB chunks, 16 in flight | 8,791 MiB/s (8,139–9,052) | 2,295 MiB/s (2,272–2,412) |
| Append, 1 MiB chunks, 16 in flight | 9,286 MiB/s (4,448–10,689) | 7,511 MiB/s (7,238–7,630) |
| Stream with a per-byte checksum, 4 KiB chunks | 491 MiB/s (479–514) | 495 MiB/s (466–546) |
| Stream with a per-byte checksum, 64 KiB chunks | 4,426 MiB/s (4,235–4,452) | 3,177 MiB/s (3,090–3,353) |
| Stream with a per-byte checksum, 1 MiB chunks | 6,544 MiB/s (6,101–6,626) | 4,822 MiB/s (4,764–5,181) |
| Random 4 KiB `read`, p50 | 9.1 µs | 16.7 µs |
| Random 4 KiB `readInto`, p50 | 7.8 µs | 7.8 µs |
| 8 `readInto` in flight, read-only handle | 260k reads/s (239–268) | 124k reads/s (102–129) |

This build's opt-in features against its own defaults, native files, medians
with ranges:

| Workload | Default | With the option |
| --- | --- | --- |
| 4 KiB appends, awaited; `writeBuffer: 1 MiB` | 317 MiB/s (302–331) | 4,681 MiB/s (3,019–9,297) |
| 4 KiB appends, awaited; `io: "sync"` | 317 MiB/s (302–331) | 1,009 MiB/s (995–1,136) |
| `appendChunks`, 4 KiB chunks; `inFlight: 16` | 321 MiB/s (315–331) | 1,467 MiB/s (1,410–2,068) |
| 1 MiB appends, awaited; `transfer: true` | 7,805 MiB/s (4,850–9,673) | 7,090 MiB/s (5,052–11,418) |
| Random 4 KiB `readInto`, p50 / p99; `io: "sync"` | 8.3 / 15.1 µs | 1.1 / 2.8 µs |
| 64 KiB stream scan; `io: "sync"` | 5,943 MiB/s (3,854–6,068) | 12,007 MiB/s (10,411–12,561) |

This report comes from one `make bench` run after the synchronous-read fix
(load average 3.5 on 18 logical CPUs by `uptime` immediately before the run;
no other benchmark, test or build was running). An earlier batch of three
consecutive runs before that fix measured 211, 306 and 337 MiB/s for awaited
4 KiB appends in the options suite, so whole-run comparisons need the measured
range rather than one absolute figure.

- Appends with 16 in flight gain because appends queued behind a running write
  share one vectored write; 0.1.0 wrote them one by one, so 16 in flight were
  no faster than one.
- The checksum stream gains at 64 KiB and 1 MiB because the next chunk is read
  while the consumer works. At 4 KiB the checksum takes about a microsecond per
  chunk, below the 5 µs read-ahead threshold, so chunks are read at their pull
  and both versions match. A separate interleaved probe of the same build with
  read-ahead switched off measured 26.8 µs per 64 KiB chunk with read-ahead
  against 37.3 µs without. Plain streams, with no consumer work, have
  overlapping ranges for the two versions at every chunk size.
- VERIFIED: (same probe) read-ahead on every chunk made 4 KiB streams with the
  checksum consumer 27% slower (20.1 against 15.9 µs per chunk); the 5 µs
  threshold removed that regression (both versions match at 4 KiB above).
- Awaited appends and `read` gain because the handle tracks the file size
  instead of asking the file system before each call; every append range of the
  two versions is separate. VERIFIED: (probe) the size query is an `fstat`
  thread-pool round trip of 7.4 µs, as long as a 4 KiB pread.
- The read-only figure gains because such a handle lets reads overlap on
  libuv's thread pool; 0.1.0 ran them one by one.
- The write buffer gains because 256 appends share one backend write; the
  figure includes the final buffer write. Synchronous I/O gains because no call
  waits for the thread pool. `transfer` skips the call-time copy: a probe put
  that copy at 24 µs per MiB against under 1 µs for taking the buffer. The
  end-to-end 1 MiB ranges overlap in this report, with transfer's median lower;
  it does not establish an end-to-end transfer gain on this run.
- Random 4 KiB `readInto` p50 matched 0.1.0 in this report, and every Node.js
  memory-adapter range overlaps between versions. VERIFIED: (interleaved probe,
  2 × 31 runs of 32 MiB, before the final read fix) an awaited 4 KiB memory
  append costs 0.75 µs at p50 against 0.75 to 0.78 µs for 0.1.0. The synchronous
  fill change does not touch appends.
- A draft of this release reported native appends 5 to 16% slower than 0.1.0
  and named admission bookkeeping as the HYPOTHESIS. Per-operation probes
  falsified it: admission adds about 0.1 µs per operation, and the per-operation
  costs of the two builds overlapped across runs. The draft benchmark reported
  no ranges, so run-to-run noise looked like a regression.
- Producer overload (2,000 un-awaited 64 KiB appends): 0.2.0 admitted 1,024 and
  rejected 976 with `QUEUE_FULL`, with high-water marks of 1,024 operations and
  64 MiB, both exactly at the defaults; the sampled ArrayBuffer peak on the
  native handle was 64 MiB. 0.1.0 admitted all 2,000, with a sampled peak of
  125 MiB of retained copies.
- Slow producer through `appendChunks`: no append was pending at any source pull.
- Large file: 512 MiB written through `appendChunks` and verified by streaming
  SHA-256 in a child process with a 32 MiB V8 heap limit. Peak RSS was 73.4 MiB.
  The heap limit is enforced; RSS was measured, not enforced.

#### Bun

`benchmarks/0.2.0-darwin-arm64-bun.json` runs the same workloads on Bun 1.4.3
(`bun run bench:bun`), from the same `make bench` run as the Node.js report.
The two reports come from separate processes at different times, so compare
versions within the Bun report, not Bun with Node.js.

Native files on Bun, 0.2.0 against 0.1.0, medians with ranges:

| Workload | 0.2.0 | 0.1.0 |
| --- | --- | --- |
| Append, 4 KiB chunks, awaited one by one | 283 MiB/s (276–284) | 167 MiB/s (165–168) |
| Append, 64 KiB chunks, awaited | 3,188 MiB/s (3,059–3,359) | 2,072 MiB/s (1,996–2,167) |
| Append, 4 KiB chunks, 16 in flight | 2,216 MiB/s (1,885–2,295) | 169 MiB/s (169–170) |
| Append, 64 KiB chunks, 16 in flight | 6,778 MiB/s (6,000–7,188) | 1,985 MiB/s (1,941–2,056) |
| Stream with a per-byte checksum, 64 KiB chunks | 4,003 MiB/s (3,738–4,105) | 2,512 MiB/s (2,435–2,527) |
| Random 4 KiB `read`, p50 | 10.3 µs | 18.9 µs |
| 8 `readInto` in flight, read-only handle | 375k reads/s (359–388) | 98k reads/s (95–100) |

This build's options against its defaults on Bun:

| Workload | Default | With the option |
| --- | --- | --- |
| 4 KiB appends, awaited; `writeBuffer: 1 MiB` | 291 MiB/s (245–298) | 8,234 MiB/s (6,885–8,928) |
| 4 KiB appends, awaited; `io: "sync"` | 291 MiB/s (245–298) | 1,065 MiB/s (994–1,098) |
| `appendChunks`, 4 KiB chunks; `inFlight: 16` | 286 MiB/s (283–295) | 1,623 MiB/s (1,525–1,924) |
| 1 MiB appends, awaited; `transfer: true` | 6,966 MiB/s (6,442–9,553) | 10,317 MiB/s (9,429–11,154) |
| Random 4 KiB `readInto`, p50 / p99; `io: "sync"` | 10.3 / 17.3 µs | 0.9 / 1.8 µs |
| 64 KiB stream scan; `io: "sync"` | 4,125 MiB/s (3,848–4,432) | 14,062 MiB/s (10,976–15,339) |

- The 1 MiB append ranges of the two versions overlap.
- Admission and pull-driven ingestion behaved as on Node.js: 1,024 of 2,000
  un-awaited 64 KiB appends admitted, 976 rejected with `QUEUE_FULL`, a sampled
  ArrayBuffer peak of 64 MiB, and no append pending at any source pull.
- On the memory adapter, 8 reads in flight reached 3% more reads per second
  than 0.1.0 at both 4 KiB and 64 KiB, with overlapping ranges. The targeted
  21-round probe below isolates the improvement from the previous build.
- The 512 MiB file was written at 1,004 MiB/s and verified at 2,839 MiB/s with
  a peak RSS of 36.0 MiB. Bun has no V8 heap flag, so no heap limit applied:
  VERIFIED: (probe) `bun --max-old-space-size=32` ran a script holding 172 MiB
  of heap, where Node.js aborted.

#### Browsers (OPFS)

`benchmarks/0.2.0-darwin-arm64-browsers.json` (`bun run bench:browsers`) runs
the same workloads on OPFS in a dedicated worker of Chromium 151.0.7922.34,
Firefox 153.0 and WebKit 26.5 (Playwright 1.62.1), 0.2.0 against 0.1.0
interleaved, from the same `make bench` run as the Bun report. The pages are
cross-origin isolated; the workers' timers stepped by 5 µs (Chromium) and
20 µs (Firefox, WebKit), so per-call latencies below are means. The report
holds every range.

OPFS, medians as 0.2.0 / 0.1.0:

| Workload | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| Append, 4 KiB chunks, awaited | 643 / 590 MiB/s | 86 / 76 MiB/s | 914 / 916 MiB/s |
| Append, 64 KiB chunks, awaited | 3,985 / 3,778 MiB/s | 1,094 / 998 MiB/s | 5,298 / 5,178 MiB/s |
| Append, 1 MiB chunks, awaited | 6,160 / 6,043 MiB/s | 3,819 / 4,938 MiB/s | 8,333 / 8,511 MiB/s |
| Stream scan, 4 KiB chunks | 2,550 / 2,508 MiB/s | 199 / 170 MiB/s | 2,991 / 2,837 MiB/s |
| Stream scan, 64 KiB chunks | 9,467 / 8,951 MiB/s | 2,477 / 2,296 MiB/s | 10,526 / 10,811 MiB/s |
| Stream scan, 1 MiB chunks | 11,808 / 11,722 MiB/s | 8,889 / 5,263 MiB/s | 11,348 / 11,852 MiB/s |
| Random 4 KiB `readInto`, mean | 1.05 / 0.97 µs | 16.4 / 19.0 µs | 0.84 / 0.83 µs |
| 8 `readInto` in flight, read-only handle | 978k / 954k reads/s | 60k / 51k reads/s | 922k / 899k reads/s |

This build's options on OPFS, medians as default / with the option:

| Workload | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| 4 KiB appends, awaited; `writeBuffer: 1 MiB` | 653 / 8,522 MiB/s | 87 / 2,812 MiB/s | 977 / 8,511 MiB/s |
| `appendChunks`, 4 KiB chunks; `inFlight: 16` | 628 / 625 MiB/s | 79 / 78 MiB/s | 954 / 928 MiB/s |
| 1 MiB appends, awaited; `transfer: true` | 6,226 / 10,079 MiB/s | 4,984 / 7,512 MiB/s | 9,816 / 11,034 MiB/s |

- The write buffer gains most in Firefox, whose OPFS calls cost tens of
  microseconds each: an awaited 4 KiB append took about 46 µs and a 4 KiB
  `readInto` about 16 µs. In this run it made awaited 4 KiB appends 13× faster
  in Chromium, 32× in Firefox and 8.7× in WebKit.
- `transfer` beat the copy in every engine in this run (Chromium 1.62×,
  Firefox 1.51×, WebKit 1.12×). The separate Node.js transfer result above did
  not establish a gain, so the browser result does not generalize to native I/O.
- `inFlight` gains nothing on OPFS: its backend has no vectored write, so
  appends in flight are not batched.
- Firefox appends were faster with 0.2.0 in all three runs (4 KiB: 1.14× to
  1.21×; separate ranges in this report).
- Before the read-path fixes below, reads were slower with 0.2.0: in three
  earlier runs, plain 4 KiB OPFS stream scans were 12% to 22% slower in
  Chromium and 13% to 15% in WebKit, and 8 reads in flight on the memory
  adapter reached 7% to 13% fewer reads per second on Node.js (six runs) and
  18% to 24% fewer on Bun. After the final synchronous-fill fix, 4 KiB stream
  scans in this report were faster than 0.1.0 by 2% in Chromium, 5% in WebKit
  and 17% in Firefox. The three-build probes below separate the last fix from
  run-to-run movement.

#### Read path after profiling

Before the final fill-loop fix, interleaved per-operation probes (15
alternating runs, medians in ns per call, load average 3.6 to 4) compared the
build before and after the first four fixes with 0.1.0:

| Operation | Before the fix | After | 0.1.0 |
| --- | --- | --- | --- |
| Memory, Node.js: `readInto`, 4 KiB | 311 | 284 | 265 |
| Memory, Node.js: 8 `readInto` in flight | 336 | 292 | 282 |
| Memory, Node.js: `read`, 4 KiB | 633 | 610 | 601 |
| Memory, Node.js: stream, per 4 KiB chunk | 781 | 729 | 692 |
| Memory, Bun: `readInto`, 4 KiB | 325 | 287 | 269 |
| Memory, Bun: 8 `readInto` in flight | 343 | 305 | 280 |
| Memory, Bun: stream, per 4 KiB chunk | 540 | 510 | 478 |
| OPFS, Chromium: stream, per 4 KiB chunk | 1,888 | 1,626 | 1,549 |
| OPFS, Chromium: `readInto`, 4 KiB | 832 | 796 | 774 |
| OPFS, Firefox: `readInto`, 4 KiB | 20,960 | 19,765 | 19,165 |
| OPFS, Firefox: stream, per 4 KiB chunk | 25,190 | 25,151 | 23,662 |

VERIFIED: (variant probes) the four causes and their fixes:

- `stream()` timed its consumer on every chunk. Removing the two
  `performance.now()` calls saved about 300 ns per 4 KiB chunk in a Chromium
  worker and about 80 ns on the Node.js memory adapter; one call costs 25 to
  80 ns, so the calls alone do not explain the Chromium figure. The stream now
  times every 8th chunk.
- `readInto` ran its queued task as an async function, whose extra promise
  hops cost 21 to 26 ns on Node.js. It now chains
  `fill()` from a plain function, and so does `readExactly`: 1,439 against
  1,643 ns in Chromium (0.1.0: 1,461) and 1,245 against 1,320 ns in WebKit
  (0.1.0: 1,375).
- `read` awaited the async size query even when the size was tracked, about
  24 ns per call on Node.js.
- Admission created a release closure per operation; counting bytes instead
  saved 9 to 13 ns per read on Bun and 4 to 8 ns on Node.js.

WebKit's figures stayed within the probes' spread for every variant. A probe
of the benchmark's own stream workload (a freshly written 32 MiB file, 21
alternating runs) measured 732 ns per 4 KiB chunk against 879 ns before the
fix and 757 ns for 0.1.0 on Node.js, and 557 against 646 and 485 ns on Bun; a
second Bun run measured 500 ns against 570 ns for 0.1.0, so Bun's remaining
gap is within its run-to-run spread.

The residual gap led to one more discriminating probe: `fill()` was still an
async function even when the memory or OPFS backend completed synchronously.
VERIFIED: (21 alternating rounds, three separately loaded builds in one
process) removing that internal promise hop made reads faster than both the
previous build and 0.1.0. Medians in ns per call, with the previous build from
`release/defuss-storage-0.2.0.tgz`:

| Operation | Previous 0.2.0 build | Fixed | 0.1.0 |
| --- | --- | --- | --- |
| Memory, Node.js: `readInto`, 4 KiB | 247 | 201 | 231 |
| Memory, Node.js: 8 `readInto` in flight | 247 | 201 | 230 |
| Memory, Node.js: `readExactly`, 4 KiB | 483 | 442 | 488 |
| Memory, Node.js: stream, per 4 KiB chunk | 583 | 548 | 570 |
| Memory, Bun: `readInto`, 4 KiB | 275 | 234 | 248 |
| Memory, Bun: 8 `readInto` in flight | 277 | 241 | 237 |
| Memory, Bun: `readExactly`, 4 KiB | 492 | 438 | 482 |
| Memory, Bun: stream, per 4 KiB chunk | 506 | 426 | 482 |
| OPFS, Chromium: `readInto`, 4 KiB | 785 | 753 | 755 |
| OPFS, Chromium: stream, per 4 KiB chunk | 1,707 | 1,694 | 1,782 |
| OPFS, Firefox: `readInto`, 4 KiB | 18,880 | 16,190 | 18,630 |
| OPFS, Firefox: stream, per 4 KiB chunk | 23,301 | 18,984 | 22,666 |
| OPFS, WebKit: `readInto`, 4 KiB | 810 | 740 | 760 |
| OPFS, WebKit: stream, per 4 KiB chunk | 1,357 | 1,250 | 1,318 |

The read loop now returns a number until a backend returns a promise, then
finishes in an async continuation. A backend can mix synchronous and
asynchronous partial reads; a regression test drives that sequence and checks
every offset, window and returned byte. Public operation ordering and promises
are unchanged. The benchmark's freshly written 32 MiB stream workload improved
from 1,211 to 1,133 ns per 4 KiB chunk on Node.js and 1,125 to 1,059 ns on Bun
(21 alternating rounds). Firefox's larger gain also appeared in the full
report: its 4 KiB `readInto` mean dropped from 19.4 µs in the previous published
report to 16.4 µs here. Chromium and WebKit's smaller targeted improvements stay
within their measured spreads; no wider claim is made.

### Not established for 0.2.0

- Windows, Linux and the GitHub Actions jobs in `.github/workflows/verify.yml`
  were not executed. The 5 µs read-ahead threshold, the batching gains, the
  synchronous-I/O figures and the `transfer` gain were measured on macOS arm64
  only; whether other platforms cross over at the same consumer time is open.
- Synchronous I/O in a worker thread ran in the packed-consumer check only (one
  worker, its own files); several workers sharing a root stay outside the
  ownership contract. The symlink test and the bun-based package test on
  Windows are untested.
- An OPFS close failure could not be induced in a real browser; the OPFS
  quarantine path is covered by code review only (see `ARCH.md`). A failing
  cleanup after a failed native open was not induced either.
- No crash-recovery or power-failure durability claim, transactional rollback,
  atomic replacement, snapshots, persistent indexes or cross-process native
  locking.
- No registry publication or remote repository mutation was performed.

## 0.1.0, 2026-11-07

### Executed checks

| Check | Environment | Result |
| --- | --- | --- |
| Strict TypeScript | TypeScript 5.9.3, ES2022 target | Passed |
| Build | pkgroll 2.29.0, clean ESM/CJS/declaration output | Passed |
| Native/memory contracts and fault tests | Node.js 24.22.1, Linux x64 | 56 tests passed |
| Browser memory/OPFS contracts and worker ownership | Chromium 153.0.8010.0, Linux headless, dedicated workers | 50 tests passed |
| DSON frame integration | Published defuss-dson 1.3.0 | Passed in Node and Chromium |
| Packed consumers | Fresh install of npm tarball | ESM and CommonJS passed |
| Public declarations | Fresh TypeScript consumer, no DOM/Node ambient types | All entry points passed |
| Runtime dependencies | Packed package metadata | Zero |
| Example | Node.js | Seek and 7-byte chunk decode passed |

The 56 Node tests comprise 23 shared contracts for each of two adapters, two DSON
integration cases, and eight additional fault/ownership/bounds cases. Browser
tests reuse those 23 contracts for memory and real OPFS, add two DSON integration
cases, and check main-thread rejection and cross-worker ownership/persistence.
No fake OPFS implementation is used.

The real-browser suite found that DOMException exposes a numeric legacy `code`;
error normalization now uses its name, with a Node regression case. All final
tests include this correction.

The default Playwright browser download was unavailable in this environment.
Testing used the Chromium binary from @sparticuz/chromium 153.0.0, controlled by
Playwright 1.62.1. GPU execution was disabled; web security was not disabled.
The public test script supports an externally installed browser through
CHROMIUM_EXECUTABLE_PATH and CHROMIUM_ARGS. The normal developer setup remains
`npx playwright install chromium`.

### Recorded measurements

`output/bench.json` contains one local 16 MiB append/flush/scan run and 1,000 byte
lookups through each memory/native adapter. It includes CPU/runtime and explicit
limitations. These are warm-cache smoke measurements, not a competitive
benchmark, peak-memory measurement or proof of durable database correctness.

`output/browser-results.json`, `output/package-results.json`, and
`output/verify.log` retain the executed verification results. The synthetic 8 GiB
source test verifies only three 4 KiB reads occur before early cancellation; it
does not allocate or persist an 8 GiB file.

### Not claimed by this release

- No crash-recovery or power-failure durability claim, transactional rollback,
  atomic replacement, database snapshots, or persistent key indexes.
- No native cross-process or cross-worker-thread locking; native ownership is
  coordinated inside one JavaScript realm.
- No executed Safari/WebKit, Firefox, Bun, Windows or macOS runtime matrix. The
  CI definition targets Node 20 and 24 on Ubuntu; only Node 24 was run here.
- No npm publication or remote repository mutation was performed.
