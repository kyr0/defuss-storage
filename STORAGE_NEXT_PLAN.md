# defuss-storage 0.2.0 implementation plan

Scope: byte I/O, bounded writes, streaming helpers, lifecycle and adapter
verification. Prepared 2026-11-07 against the included 0.1.0 source.

## Outcome

Keep the current adapter architecture and public read/write semantics. Make
resource admission explicit, support streaming ingestion without collecting the
input, and verify behavior under failures and on the intended runtimes. Preserve
zero runtime dependencies, ESM/CJS exports and platform-neutral declarations.

The release must not claim a process-wide memory ceiling or stronger persistence
and locking guarantees than its adapters actually provide.

## 1. Bound writes and the operation queue (first priority)

**Observed:** `src/file.ts` copies every accepted write/append input before
`run()` checks the closed state or queues it. There is no write-byte or pending
operation limit. A burst of calls against a slow backend can retain arbitrarily
many copies. Existing `maxReadBytes` does not address this.

Extend `AdapterOptions`, every adapter factory and `createStorageFile` with:

```ts
interface AdmissionOptions {
  maxWriteBytes?: number;          // default 64 MiB, per write/append
  maxPendingWriteBytes?: number;   // default 64 MiB, per open handle
  maxPendingOperations?: number;   // default 1,024, per open handle
}
```

Defaults are starting policies, not measured optima. Accept positive safe
integers; require `maxWriteBytes <= maxPendingWriteBytes`. Keep `maxReadBytes`
unchanged. Add `QUEUE_FULL` to `StorageErrorCode`; an individual oversized write
is a RangeError, consistent with the existing oversized-read contract.

Implementation order for write/append:

1. Validate input/range, writable state, closed state and cancellation.
2. Check the individual write limit and reserve one operation plus input bytes.
3. Copy input synchronously at call time, preserving existing snapshot semantics.
4. Enqueue the operation; retry partial backend I/O as today.
5. Release both reservations in all success/error/cancellation paths, including
   failures while copying. Bytes stay charged during active I/O.

Count all queued/active public file operations against the operation limit;
zero-length writes still consume an operation slot but no byte budget. Prevent
double-counting internal read/write retry loops. `close()` must always be
admissible, regardless of saturation, and drain already accepted operations.

Reject saturation immediately, before copying. Do not create an unbounded
secondary queue of callers waiting for capacity. Producers obtain backpressure
by awaiting operations or consuming the helper in step 2. Each handle has its
own budget: multiple handles, caller buffers, returned read arrays and the
memory adapter's retained file contents are outside that per-handle bound.

**Acceptance:** a deliberately stalled backend cannot make retained write copies
exceed the configured budget; overflow and closed-handle calls do not copy or
perform I/O; all counters return to zero after accepted work settles. Validate
the accounting directly with internal test instrumentation, not only RSS samples.
The existing call-time-copy and operation-order tests must remain valid.

Files: `src/types.ts`, `validate.ts`, `file.ts`, `errors.ts`, `memory.ts`,
`node.ts`, `opfs.ts`, `custom.ts`; extend the shared contract suite.

## 2. Add one backpressure-aware ingestion helper

Export this helper from the root package:

```ts
function appendChunks(
  file: StorageFile,
  source: AsyncIterable<Uint8Array>,
  options?: IOOptions,
): AsyncIterableIterator<AppendResult>;
```

Each consumer pull requests one input chunk, awaits its append, then yields that
append's actual offset and length. There is at most one outstanding input pull
and one append. No whole-stream concatenation, automatic flushing or ownership
transfer occurs. Empty chunks retain ordinary append semantics. Oversized chunks
are rejected; the producer controls chunk size.

On early return, append failure or cancellation, close the source iterator and
release references. Keep the caller's file open. Preserve the primary I/O error
if iterator cleanup also throws, retaining the cleanup failure as secondary
diagnostic information. Check cancellation before pulling and before appending.
An already-pending `next()` or native I/O is only cooperatively cancellable; do
not promise that an arbitrary stalled producer can be forcibly interrupted.

This is a sequence of ordinary appends, not an atomic batch. Other callers may
interleave writes, so returned offsets are not guaranteed contiguous. Do not
silently retry `QUEUE_FULL` or a partially failed append. A failed append can
have changed bytes even when it produced no receipt.

**Acceptance:** stalled appends prevent another source pull; early break invokes
iterator cleanup; abort/errors preserve already written bytes and close neither
the file nor unrelated resources; actual offsets are correct with interleaving.

Files: new `src/streams.ts`, export in `src/index.ts`, shared helper tests and one
runnable byte-stream copy/ingestion example.

## 3. Harden lifecycle and error paths

Add deterministic failure coverage and make targeted fixes where it exposes a
contract violation:

- Reads/writes returning short counts, invalid counts or zero write progress.
- Quota, permission and generic failures before and after partial mutation.
- Flush failures: reject explicitly; do not convert them into success or claim
  that cancellation/flush failure rolled back earlier bytes.
- Close with accepted work and saturated queues: reject new operations, drain
  accepted ones, call backend close once and reuse the same close promise.
- Close failure: do not report success or automatically retry an uncertain
  native resource. The current native/OPFS close paths release cooperative
  ownership in `finally`; change this so an uncertain close cannot admit a
  second owner while the first backend may remain active. Quarantine ownership
  for that realm/worker if closure cannot be established; document that recovery
  requires ending that owner context. Memory close remains infallible normally.
- Open failure after resource acquisition: attempt cleanup without masking the
  primary failure; apply the same uncertain-close ownership rule.
- Known StorageError codes crossing ESM/CJS boundaries: preserve recognized
  codes using a whitelist rather than relying solely on `instanceof`; retain
  causes. Unknown backend codes remain `IO_ERROR`.
- Borrowed `readInto` views: capture the original window and revalidate it at
  execution/partial-I/O boundaries. Detached or resized buffers must not cause
  silent zero-byte success or exceed the admitted read length. The caller is
  still responsible for keeping a borrowed target stable until completion.

The byte-operation queue normally remains usable after ordinary I/O errors.
Handle-close uncertainty is a different lifecycle state. Keep this distinction
explicit in documentation and tests.

**Acceptance:** no admission leaks, misleading success, accidental second owner
or unbounded retry loop across the fault matrix. Verify both the primary error
and cleanup effects. Add tests for close-failure quarantine before changing the
adapter cleanup paths.

Files: `src/file.ts`, `errors.ts`, `node.ts`, `opfs.ts`; fault fixtures built via
the existing `createStorageFile` backend interface.

## 4. Verify adapters and supported runtimes

Retain the same contract tests for memory, native files and real OPFS. Extend
them for the new admission limits and helper. Keep native ownership scoped to
one JS realm and browser ownership scoped to cooperating origin contexts.

Target execution matrix:

| Target | Checks |
| --- | --- |
| Node 24, Linux/macOS/Windows | Memory/native contracts, partial-I/O faults, close/reopen, installed-package imports |
| Node 20 | Existing compatibility target; retain support only after the relevant suite passes |
| Bun, macOS | Native/memory and package smoke tests; record exact executed version |
| Chromium dedicated worker | Memory/real OPFS contracts, competing-worker ownership and worker termination |
| Firefox/WebKit dedicated workers | Run required-API checks and the same applicable tests; distinguish unsupported APIs from implementation failures |

Use a new native process and a new browser worker for persistence/reopen tests.
A process kill tests process recovery behavior, not hardware power-loss
durability. Do not introduce cross-process native writes into the supported
model without an actual locking implementation.

The baseline records 56 Node and 50 Chromium tests on Linux. Those results do
not establish the expanded matrix. Report only environments actually executed;
update CI and support documentation accordingly.

Files: `tests/contract.mjs`, adapter/fault tests, browser runner and
`.github/workflows/verify.yml`.

## 5. Measure boundedness and I/O overhead

Expand the current 16 MiB, single-run smoke benchmark with deterministic datasets,
multiple repetitions, several chunk sizes and a slow-producer/slow-consumer
workload. Measure:

- Sequential append throughput and flush latency separately.
- Random-range read latency, including p50/p95/p99.
- Stream throughput and time to first chunk.
- Pending-write byte/operation high-water marks under producer overload.
- Peak RSS, heap and external buffers where available, with measurement limits.

Run a native file larger than an imposed process memory limit, using bounded
chunks and without retaining results. Validate byte content with a streaming
reference digest. Test queue accounting deterministically even when an exact
heap measurement is unavailable. The memory adapter necessarily retains its
file data; do not use it for a larger-than-RAM claim.

Compare against storage 0.1.0 to quantify overhead. Label page-cache effects;
avoid database comparisons or arbitrary CI timing thresholds. Keep correctness
and allocation/admission invariants as CI gates, with timings as reports.

Files: `scripts/bench.mjs`, benchmark fixtures and versioned JSON results.

## 6. Package and release 0.2.0

1. Run typecheck/build and all original plus new contract/fault/helper tests.
2. Install fresh tarballs in clean ESM/CJS consumers; test all three entry points
   and declarations without Node/DOM ambient types.
3. Verify zero runtime dependencies and that the root entry imports no native
   filesystem APIs.
4. Document admission defaults, `QUEUE_FULL`, helper lifecycle, close-failure
   quarantine, cancellation limits and per-handle rather than global bounds.
5. Call out the compatibility change: previously unbounded write calls may now
   be rejected unless callers await operations, chunk data or configure limits.
6. Include source, lockfile, builds, examples and exact validation evidence in a
   uniquely named complete-codebase ZIP. Publication is a separate step.

## Implementation order and scope boundary

Implement steps **1 to 6 in that order**, with tests added alongside each change.
Step 1 is the main functional gap and the first commit-sized work item; split
accounting/types and adapter wiring only if each intermediate state remains
coherent. Step 3's fault tests may be written earlier to constrain the changes.

Keep DSON integration as an example/test. Record encoding, keys, persistent
indexes, tombstones, commit protocols, log repair and compaction are outside
this storage-only release. Do not add DataView or search dependencies.

Capability extensions such as native cross-process locks, durable directory
metadata operations and atomic replacement remain separate follow-up work,
driven by a concrete consumer contract. Keep their current unsupported status
explicit until implemented and verified; do not promise cross-platform parity
by emulation with weaker semantics.

## Evidence and plan status

This is a planning deliverable. No 0.2.0 implementation, new runtime test or new
benchmark was performed here. The included baseline is unchanged and retains
its original evidence. Before packaging this plan, all 50 files listed by the
baseline SHA256SUMS are verified against their original digests. The new ZIP is
also checked for archive integrity and per-file digests.

Primary code reviewed: `src/file.ts`, `types.ts`, `errors.ts`, `custom.ts`, the
native/OPFS adapter cleanup paths, package metadata and the CI workflow.
Original storage archive SHA-256:
`9be2915510f49c51629c307c37445214966fead64fbe0232cdc5b5b51c36b10c`.
