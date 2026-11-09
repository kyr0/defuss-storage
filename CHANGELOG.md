# Changelog

## 0.2.0 (2026-11-07)

**Compatibility:** writes are now admitted per handle. Code that issues many
writes or appends without awaiting them can get `QUEUE_FULL` (default budget
64 MiB of pending input and 1,024 operations per handle). Await operations,
chunk the data, use `appendChunks`, or raise the limits. A single input above
`maxWriteBytes` (default 64 MiB) now throws `RangeError`.

- Add admission options `maxWriteBytes`, `maxPendingWriteBytes` and
  `maxPendingOperations` to every adapter and `createStorageFile`, and the
  `QUEUE_FULL` error code. Saturated calls reject before copying or I/O;
  `close()` is always admitted.
- Add `appendChunks(file, source, options?)`, pull-driven ingestion of an
  `AsyncIterable<Uint8Array>` that yields each append's receipt.
- Add the `writeBuffer` open option: appends up to that many bytes resolve
  once copied into a per-handle buffer, written by one backend call when full
  and before any other operation needs the bytes. Awaited native 4 KiB appends
  ran 15× faster than without it. Off by default: buffered bytes are invisible
  to other processes and lost on a crash until written.
- Add `io: "sync"` to `createFileStorage`: synchronous calls on the file
  descriptor instead of thread-pool round trips, for worker threads and CLIs.
  Awaited 4 KiB appends ran 3.0×, random 4 KiB `readInto` 7.7× and 64 KiB
  stream scans 2.0× faster than with async I/O.
- Add `transfer: true` to `write` and `append` (`WriteOptions`): the handle takes
  the input's whole buffer instead of copying it, and the caller's view is
  detached. This skips a measured 24 µs copy per MiB; the end-to-end native
  transfer ranges overlapped the copy ranges in the benchmark.
- Add `inFlight` to `appendChunks` (`AppendChunksOptions`): up to that many
  appends outstanding, receipts still in source order; 4 KiB chunks ingested
  4.7× faster with 16 than with 1.
- Benchmark: `make bench` also runs on Bun and on OPFS in Chromium, Firefox
  and WebKit (Playwright), with the same workloads (`scripts/bench-core.mjs`).
- Performance: reads on fast backends (memory, OPFS) shed the per-call cost this
  release had added: `readInto` and `readExactly` queue a plain function, `read`
  uses the tracked size, admission counts bytes instead of creating a closure
  per call, and `stream()` times its consumer on every 8th chunk. Synchronous
  backends also complete the internal read loop without crossing an extra async
  promise. Interleaved three-build probes measured 4 KiB OPFS stream chunks at
  1,694 ns in Chromium and 18,984 ns in Firefox, against 1,707 and 23,301 ns
  before this final fix and 1,782 and 22,666 ns for 0.1.0.
- Test: the packed-consumer check runs synchronous I/O in a worker thread and
  checks that the main thread keeps running.
- Performance: a handle tracks the file size instead of querying the backend
  before each append and read; awaited native 4 KiB appends ran 1.7× and
  random 4 KiB `read` calls 1.8× faster than 0.1.0. Read-only native handles
  run reads concurrently within a `maxReadBytes` budget; 8 in flight reached
  2.0× the 0.1.0 throughput.
- Performance: native appends that queue behind a running write share one
  vectored write; with 16 in flight, 4 KiB appends ran 10.9× and 64 KiB appends
  4.1× faster than 0.1.0. Custom backends opt in with an optional
  `StorageFileBackend.writev`.
- Performance: `stream()` reads the next chunk while a consumer that spends
  5 µs or more per chunk works (timed on the first and every 8th chunk); with
  a per-byte checksum consumer, 64 KiB chunks streamed 1.6× and 1 MiB chunks
  1.4× faster than 0.1.0.
- Change: a paused stream may hold one chunk read ahead. A chunk read ahead
  is read again if a mutation was queued after it, so stream results are
  unchanged.
- Change: when a batched native write fails, every append it carried rejects,
  since any of their bytes may have landed.
- Change: `size()` and custom backends: the backend size is queried once per
  handle and again only after a failed mutation or a short read, so size
  changes by writers outside the ownership contract are not observed sooner.
- Change: a failed native or OPFS close no longer releases ownership; the name
  stays owned until the owner realm or worker ends (quarantine). Cleanup after a
  failed open follows the same rule.
- Fix: `readInto` rejects `IO_ERROR` when its borrowed target is detached or
  resized while queued or between partial reads, instead of returning 0 or
  reading past the admitted window.
- Fix: a StorageError with a known code thrown by the other module build keeps
  its code instead of becoming `IO_ERROR`.
- Fix: OPFS `open`/`remove` of a directory under a valid name rejects
  `UNSUPPORTED` (was `IO_ERROR`), matching the native adapter.
- Fix: `createFileStorage(path)` on an existing regular file rejects
  `UNSUPPORTED` with the default `create:true` (was `ALREADY_EXISTS`).
- Fix: `read()` rejects `IO_ERROR` when a custom backend reports an invalid
  size, instead of returning an empty array that looks like EOF.
- Fix: a cleanup failure while an `open` is failing no longer replaces the
  original error with an un-normalized one.
- Tests: TypeScript test suite on vitest 4.1.12 (Node.js 20 to 26), also run
  by `bun test`; fault matrix, admission accounting against a stalled backend,
  cross-process persistence and process kill, worker termination, browser
  suite on Chromium, Firefox and WebKit, root-entry import graph check.
- Examples are TypeScript (`examples/*.ts`), run with bun or Node.js 24+.
- Tooling: `make` verbs (`lint`, `test`, `coverage`, `e2e`, `verify`,
  `release`, `bench`), oxlint 1.89.0, bun 1.4.3 as package manager (`bun.lock`
  replaces `package-lock.json`, `bun pm pack` builds the tarball), a
  report-only benchmark against 0.1.0 and a CI matrix for Linux, macOS,
  Windows, Node 20 and 24, Bun and three browser engines.

## 0.1.0 (2026-11-07)

- Introduce zero-runtime-dependency memory, native-file and OPFS byte adapters.
- Add explicit-offset reads, readInto/readExactly, queued appends, overwrite,
  truncation, flush and idempotent close.
- Add bounded pull streams, cooperative cancellation and normalized errors.
- Define ownership scopes and explicitly exclude transaction/snapshot promises.
- Verify DSON 1.3.0 framed records through real published encode/decode APIs.
- Ship shared contract tests, packed-consumer checks and dedicated-worker OPFS
  tests, plus a runnable integration example and local benchmark script.
