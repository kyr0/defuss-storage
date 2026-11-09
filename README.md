# defuss-storage

Isomorphic byte storage (backing stroage) for `defuss-db`, `defuss-graph` and `defuss-vfs`.
Memory, native files and browser OPFS share the same tested interface. No runtime
dependencies. Optional Node.js and browser entry points keep platform APIs out of
the root import. ESM, CommonJS and TypeScript declarations are included.

This is the byte-I/O layer. It neither interprets `defuss-dson` nor implements a database.
The DSON 1.3.0 integration example and tests exercise binary frame append, direct
seek through recorded offsets, and incremental sequence decoding.

## Setup

From this source distribution:

```sh
make setup     # bun install --frozen-lockfile + Playwright Chromium, Firefox and WebKit
make verify    # lint, test, coverage, e2e
bun run example   # TypeScript examples, run by bun
```

`make verify` runs `lint` (strict TypeScript for sources, tests and examples,
and oxlint), `test` (vitest on Node.js), `coverage` (vitest with V8 coverage of
the built ESM modules) and `e2e` (packed tarball in clean consumers, then real
OPFS in Chromium, Firefox and WebKit). It fails rather than skips if a browser
cannot start. Run `make` to list the verbs. The project uses bun as its package
manager (`bun.lock`); Node.js remains the primary runtime under test, and
`bun run test:bun` runs the same TypeScript test files under `bun test`. `bun run
verify` is the Make-free variant used by `prepublishOnly`; it runs the Chromium
suite only. `make release` writes the package tarball (`bun pm pack`) and a
complete-codebase ZIP with `SHA256SUMS` into `release/` without publishing
anything. Consumers can install a built tarball with any package manager, for
example `bun add /path/to/defuss-storage-0.2.0.tgz` or `npm install` with the
same path.

## Memory storage

```js
import { createMemoryStorage } from 'defuss-storage';

const storage = createMemoryStorage();
const file = await storage.open('events.dsq', { create: true });
try {
  const { offset } = await file.append(new Uint8Array([1, 2, 3]));
  console.log(await file.readExactly(offset, 3));
  for await (const chunk of file.stream({ chunkSize: 65536 })) {
    console.log(chunk.byteLength);
  }
  await file.flush();
} finally {
  await file.close();
}
```

Each memory adapter owns an independent namespace. Closing a file retains its
bytes in that adapter. `remove()` deletes them. The default per-file capacity
limit is 256 MiB, configurable through `maxFileBytes`; this is not a total-adapter
heap limit. Geometric buffer growth may temporarily allocate both old and new
buffers. Reads return independent copies.

## Native files

```js
import { createFileStorage } from 'defuss-storage/node';

const storage = await createFileStorage('./data');
const file = await storage.open('events.dsq', { create: true });
try {
  await file.append(new Uint8Array([1, 2, 3]));
  await file.flush();
} finally {
  await file.close();
}
```

Creates the directory by default; pass `{ create: false }` to require it to
exist. Names are flat, portable lowercase filenames: 1–128 ASCII letters,
digits, dots, hyphens or underscores, beginning with a letter or digit. Trailing
dots and Windows device names are rejected. Paths, traversal, symlinks and
directories are not accepted as file entries: opening or removing one rejects
`UNSUPPORTED`, and `list()` skips it. A root that exists but is not a directory
also rejects `UNSUPPORTED`. The root directory must be trusted: these checks
are not a sandbox against another process renaming or replacing its contents.

A read-only native handle runs reads concurrently on libuv's thread pool: they
start in call order while their lengths together fit `maxReadBytes`, so the
handle's allocation bound is the same as one read at a time. Read-write
handles, the memory and OPFS adapters and `createStorageFile` handles run every
operation one after another.

Native appends that queue up while another operation runs are written by one
vectored write (`writev`) when their turn comes. A lone append starts at once,
so batching adds no wait. Any other operation between appends ends the batch,
so call order holds. Each append still gets its own offset and promise, and
resolves only once all its bytes are written; if the shared write fails, every
append it carried rejects.

With `createFileStorage(root, { io: 'sync' })`, every read, write, size query,
truncation and flush is a blocking call on the calling thread instead of a
round trip through libuv's thread pool. Use it in a worker thread or a CLI: on
a server's main thread each call, an fsync or a slow disk included, blocks every
other task. Read-only handles in this mode run their reads one after another.
The packed-consumer check runs this mode in a worker thread on Node.js 20, 24
and 26 and on Bun, and checks that the main thread's timer keeps firing while
the worker blocks.

Native ownership is **cooperative within one JavaScript realm**, including
independent adapter instances and both ESM/CommonJS builds. It is not an OS-level
file lock. Use one owner service/worker for a root; multiple processes or Node
worker threads writing that root concurrently are outside the v0.1 contract.

## Browser OPFS

Run this inside a **dedicated module worker** on HTTPS or localhost:

```js
import { createOPFSStorage } from 'defuss-storage/opfs';

const storage = await createOPFSStorage({ name: 'my-db' });
const file = await storage.open('events.dsq', { create: true });
try {
  await file.append(new Uint8Array([1, 2, 3]));
  await file.flush();
} finally {
  await file.close();
}
```

The adapter uses `navigator.storage.getDirectory()`, a namespace directory under
`defuss-storage`, `FileSystemSyncAccessHandle`, and Web Locks. The same origin and
namespace share bytes. Web Locks coordinate this package's opens/removes across
workers and tabs; the native sync handle additionally owns its file. Even a
read-only open has exclusive ownership. A terminated worker releases its browser
locks, and a new worker can then open the file; partially written
bytes may remain. OPFS persistence remains subject to browser quota, eviction and
user clearing. The package does not request persistent-storage permission or
change user browser settings.

VERIFIED (Playwright WebKit 26.5): in an ephemeral browser context, Playwright's
default and comparable to private browsing, `getDirectory()` fails with
`UnknownError`, which `createOPFSStorage` reports as `IO_ERROR`. A persistent
profile works. Safari's own private mode was not tested.

## API and invariants

| Adapter operation | Contract |
| --- | --- |
| `open(name, options?)` | Missing file fails unless `create:true`; creation never truncates an existing file. |
| `open(name, {create:true, exclusive:true})` | Requires a new file. |
| `open(name, {readOnly:true})` | Requires an existing file; mutations fail. |
| `open(name, {writeBuffer: bytes})` | Collects appends of up to `bytes` before one backend write; see Write buffer. Not with `readOnly`. |
| `list()` | Sorted names of regular supported entries; not recursive or a transactional snapshot. |
| `remove(name)` | True when removed, false when absent; rejects an open owned file. |

| File operation | Contract |
| --- | --- |
| `size()` | Current byte size. The handle asks the backend once and then tracks its own writes; see Performance. |
| `read(offset, length, options?)` | Up to `length` owned bytes; EOF returns an empty array. |
| `readInto(offset, target, options?)` | Fills the supplied Uint8Array window until full/EOF; returns count; leaves the remainder untouched. |
| `readExactly(offset, length, options?)` | Returns the full requested range or rejects `UNEXPECTED_EOF`. |
| `write(offset, bytes, options?)` | Copies input at call time, or takes its buffer with `{transfer: true}`; retries partial writes. Extending a file zero-fills gaps. Empty writes do not extend it. |
| `append(bytes, options?)` | Queues EOF selection and the complete write together; returns `{offset, byteLength}`. Native appends queued together share one vectored write; see Performance. `{transfer: true}` takes the input's buffer instead of copying it. |
| `truncate(size, options?)` | Shrinks or zero-extends. |
| `flush()` | Memory: no-op. Native: file-handle sync. OPFS: sync-access-handle flush. |
| `stream({start?, end?, chunkSize?, signal?})` | Owned chunks over `[start,end)`, read one chunk ahead of a slow consumer. Default chunk size 64 KiB. |
| `close()` | Drains previously queued operations, closes/relinquishes ownership; idempotent. Always admitted. |

| Helper | Contract |
| --- | --- |
| `appendChunks(file, source, options?)` | Appends each chunk of an `AsyncIterable<Uint8Array>` and yields each `{offset, byteLength}`; one pull and one append outstanding at a time, or up to `inFlight` appends. |

Offsets and their sums must be nonnegative safe integers. Inputs must be
Uint8Array views (Node Buffer inputs are accepted); view windows are respected.
SharedArrayBuffer-backed and detached buffers are rejected. `maxReadBytes`
defaults to 64 MiB and bounds each allocated read, caller-provided readInto window,
and stream chunk. Set it when creating the adapter.

`readInto` borrows its target until resolution. Keep it attached and unresized
until then: a target that is detached or resized (resizable `ArrayBuffer`) while
queued or between partial reads rejects `IO_ERROR` instead of returning zero
bytes or reading past the admitted window. Writes own a call-time copy, but
do not provide atomic commit or rollback. Cancellation and I/O failure can leave
a partial mutation. Signals are checked before queued execution and between
partial I/O/chunks; they do not interrupt an already running native operation.
The queue remains usable after an operational failure.

Streams capture the end size on the first pull. Later appends are excluded;
overwrites can be visible, and shrinking below unread bytes rejects. **Streams
are not snapshots.** Once the consumer spends 5 µs or more on a chunk (timed
on the first chunk, then on every 8th), the stream reads the next chunk while
the consumer works. A paused stream then
holds that one chunk, and its queue slot only until the read settles. A chunk
read ahead is read again at its pull if a write, append or truncation was
queued after it, so it shows the same bytes as a read at pull time; its error,
if any, also surfaces only at that pull. Each chunk read is one admitted
operation, so a pull on a saturated handle rejects `QUEUE_FULL`; the read-ahead
is skipped instead. Breaking or cancelling a stream does not close the
caller-owned file. Call `close()` in
a `finally` block. Closing rejects new operations and may interrupt a stream's
later pulls after accepted work drains.

`flush()` is explicit. `close()` does not imply it. File flush does not promise
directory metadata durability, atomic replacement, multi-file commits, or power
failure recovery. Those belong to the record engine and its commit protocol.
Storage capabilities declare `snapshots:false` and `atomicReplace:false`.

Operational errors expose `StorageError.code`: `NOT_FOUND`, `ALREADY_EXISTS`,
`BUSY`, `CLOSED`, `READ_ONLY`, `PERMISSION_DENIED`, `QUOTA_EXCEEDED`,
`UNEXPECTED_EOF`, `UNSUPPORTED`, `ABORTED`, `QUEUE_FULL`, or `IO_ERROR`; native
failures remain available as `cause`. Invalid arguments use TypeError/RangeError.
Match `code` rather than relying on `instanceof` across independent module
builds/realms. A StorageError thrown by another build (for example a CommonJS
backend under the ESM handle) keeps its code when the code is one of these;
anything else becomes `IO_ERROR`.

### Admission and backpressure

Each open handle bounds its own queued work. Admission happens at call time,
before any input is copied:

| Option | Default | Bounds |
| --- | --- | --- |
| `maxWriteBytes` | 64 MiB | One write/append input. A larger input throws `RangeError`. |
| `maxPendingWriteBytes` | 64 MiB | Write/append input copies held by queued or running operations of one handle. |
| `maxPendingOperations` | 1,024 | Queued plus running operations of one handle, writes or not. |

Pass them to `createMemoryStorage`, `createFileStorage`, `createOPFSStorage` or
`createStorageFile`. Values are positive safe integers. Setting only one byte
bound moves the other default to keep `maxWriteBytes <= maxPendingWriteBytes`;
setting both inconsistently throws `RangeError`. The defaults are starting
policies, not measured optima.

A call that does not fit rejects `QUEUE_FULL` immediately, without copying and
without I/O. There is no hidden queue of waiting callers. Get backpressure by
awaiting operations, by bounding concurrency, or with `appendChunks`. A rejected
call changed nothing, so it can be retried after earlier work settles; the
package never retries it for you. `close()` is never subject to admission.

These are per-handle bounds, not a process-wide memory ceiling. Other handles,
caller buffers, returned read arrays and the memory adapter's stored bytes are
outside them.

**Compatibility:** 0.1.0 accepted any number of un-awaited writes. Code that
fires many writes without awaiting can now get `QUEUE_FULL`; await operations,
write larger chunks less often, or raise the limits.

### Streaming ingestion

```js
import { appendChunks } from 'defuss-storage';

for await (const { offset, byteLength } of appendChunks(file, readable)) {
  index.push(offset, byteLength);
}
```

Each pull requests one source chunk, awaits its append, then yields the receipt,
so a slow file slows the producer instead of buffering input. It is a sequence of
ordinary appends, not an atomic batch: other writers can interleave, so offsets
need not be contiguous. Empty chunks are ordinary empty appends; a chunk above
`maxWriteBytes` rejects `RangeError`. Nothing is flushed, and the file stays open.

On early `break`, append failure or cancellation the helper closes the source
iterator. A failed append may already have changed bytes without producing a
receipt, and it is not retried. If closing the source also fails, the primary
error is thrown with the cleanup failure as its `suppressed` property. The signal
is checked before each pull and each append; a pending `next()` or native write
is only cooperatively cancellable. [examples/stream-ingest.ts](examples/stream-ingest.ts)
copies a native file this way and verifies its SHA-256.

`appendChunks(file, source, { inFlight: 16 })` keeps up to 16 appends
outstanding and still yields receipts in source order; on native files, appends
that queue behind a running write share one vectored write. The window must fit
the handle's admission budget (16 chunks within `maxPendingWriteBytes`), or the
append beyond it rejects `QUEUE_FULL`. Before the helper finishes, by
completion, failure or `break`, it waits for every append it issued. After a
failure, appends issued behind the failing one may still have written their
bytes. `transfer: true` in the options hands every chunk's buffer over.

### Write buffer

```js
const log = await storage.open('events.log', { create: true, writeBuffer: 1024 * 1024 });
```

Appends of up to `writeBuffer` bytes are copied into one per-handle buffer and
resolve at once. The buffer is written in one backend call when it is full and
before any read, positional write, truncation, `flush()` or `close()`; `size()`
includes buffered bytes. It is off by default because of these trade-offs:

- Other processes do not see buffered bytes until the buffer is written, and a
  crash loses them. Durability was only ever promised by `flush()`, and still is.
- A failed buffer write rejects the operation that needed it, not the appends,
  which already resolved. The buffered bytes are discarded, the handle queries
  its size again, and the error message names the buffered appends. `close()`
  still closes the file and releases ownership, then rejects with that error.
- The buffer is one allocation of `writeBuffer` bytes per handle, outside the
  admission budget.

### Performance

Figures are from `benchmarks/0.2.0-darwin-arm64.json` (macOS arm64, Node.js
26.11.1, warm page cache), one `make bench` run at load average 3.5 on 18
logical CPUs; compare figures within one report. The browser and Bun figures
come from the `-browsers.json` and `-bun.json` reports of the same run.

- **Small awaited appends: use the write buffer or synchronous I/O.** Each async
  native call costs a thread-pool round trip of about 8 µs, whatever its size.
  Awaited 4 KiB appends measured 317 MiB/s by default, 4,681 MiB/s with
  `writeBuffer: 1 MiB` and 1,009 MiB/s with `io: 'sync'`.
- **Or keep appends in flight.** With 16 appends in flight, appends that queue
  behind a running write share one vectored write: 2,444 MiB/s with 4 KiB
  chunks and 8,791 MiB/s with 64 KiB, against 188 and 2,295 MiB/s for 0.1.0.
  Await small appends in groups, for example `Promise.all` over 16, within the
  admission budget, or use `appendChunks` with `inFlight: 16` (1,467 MiB/s
  against 321 MiB/s with the default of 1, for 4 KiB chunks).
- **Larger chunks still help.** Awaited native appends measured 316 MiB/s with
  4 KiB chunks, 4,085 MiB/s with 64 KiB and 10,187 MiB/s with 1 MiB.
- **Synchronous I/O for lookups and scans in a worker.** With `io: 'sync'`,
  random 4 KiB `readInto` calls took 1.1 µs at p50 against 8.3 µs, and 64 KiB
  stream scans reached 12,007 MiB/s against 5,943 MiB/s.
- **Slow consumers overlap with reads.** A stream whose consumer spends 5 µs or
  more per chunk reads the next chunk meanwhile. With a checksum over every byte
  as the consumer, 1 MiB chunks streamed at 6,544 MiB/s against 4,822 MiB/s for
  0.1.0, and 64 KiB chunks at 4,426 against 3,177 MiB/s. Faster consumers read
  at the pull: for them the overlap costs more than it hides (see `ARCH.md`).
- **Open lookup-heavy files read-only.** Eight `readInto` calls in flight on a
  read-only native handle reached 260k reads/s against 124k for 0.1.0, which ran
  them one by one. A read-write handle stays serial.
- **Hand large buffers over.** `{ transfer: true }` skips the call-time copy,
  which costs about 24 µs per MiB; taking the buffer costs under 1 µs (probe).
  The end-to-end gain varies: this run measured 7,090 MiB/s with transfer
  against 7,805 MiB/s with the copy, with wide, overlapping ranges.
- **In browsers, buffer small appends.** On OPFS, `writeBuffer: 1 MiB` made
  awaited 4 KiB appends 8.7× (WebKit) to 32× (Firefox) faster, and `transfer`
  made 1 MiB appends 1.1× to 1.6× faster. `inFlight` gains nothing there: OPFS
  has no vectored write. Synchronous OPFS reads complete their internal retry
  loop without an extra async promise. A 4 KiB stream chunk took 1,694 ns in a
  targeted Chromium probe, against 1,707 ns before that final fix and 1,782 ns
  for 0.1.0 (see `VALIDATION.md`).
- **Bun shows the same gains.** On Bun 1.4.3, 4 KiB appends with 16 in flight
  reached 2,216 MiB/s against 169 MiB/s for 0.1.0, and `writeBuffer: 1 MiB`
  made awaited 4 KiB appends 28× faster.
- **`readInto` avoids allocation.** It reuses the caller's buffer; `read`
  allocates a new array per call.
- **The size is tracked, not queried.** A handle asks its backend for the size
  once, then follows its own writes, appends and truncations, and asks again
  only after a failed mutation or a short read. Within the ownership contract it
  is the only writer, so the tracked size is exact; a change by a writer outside
  that contract is not seen by `size()` until then.

### Close failures

An ordinary I/O failure leaves the handle usable. A failed `close()` is
different: the resource state is uncertain, so the close is not retried and
every later `close()` returns the same rejected promise. The native and OPFS
adapters then keep the name owned: in the same JavaScript realm (native) or
origin (OPFS) every later `open` or `remove` of it rejects `BUSY`, so no second
owner can run beside a resource that may still be live. Recovery requires ending
that owner context: the process or Node realm for native files, the worker for
OPFS. The native path is tested with a real failing close; the OPFS path is
covered by code review only, because no browser operation is known to make a
sync handle's close fail. A failing cleanup after a failed `open` follows the same rule and never
replaces the open error.

## DSON 1.3.0

Install `defuss-dson@1.3.0` alongside the storage package. The complete runnable
example is [examples/dson-frames.ts](examples/dson-frames.ts). Its critical seek
path is:

```js
import { inspectFrame, decodeFrame, FRAME_HEADER_BYTES } from 'defuss-dson/sequence';

async function readRecord(file, offset) {
  const header = await file.readExactly(offset, FRAME_HEADER_BYTES);
  const metadata = inspectFrame(header);
  const frame = await file.readExactly(offset, metadata.byteLength);
  return decodeFrame(frame).value;
}
```

`metadata.offset` here is zero because `header` is a newly read buffer. The file
offset is still the supplied `offset`. Set `maxReadBytes` large enough for a whole
frame when using this pattern; the sequence decoder can also consume smaller
chunks. A stable file version must be supplied by the higher layer if concurrent
mutations are allowed between the header and payload reads.

This package does not rebuild keys, choose recovery offsets, truncate damaged
tails, or implement tombstones, snapshots or compaction. Those are DBSONL/DB
responsibilities. DataView will consume a logical RecordSource implemented above
this byte layer rather than interpreting file offsets itself.

## Custom adapters

`createStorageFile(name, backend, options?)` (admission options plus `readOnly`
and `writeBuffer`) wraps a byte backend with the same
queue, bounded reads, admission limits, owned write inputs, cancellation,
streaming and error normalization. The exported `StorageFileBackend` contract has `size`, `read`,
`write`, `truncate`, `flush`, and `close`, plus an optional `writev(offset, chunks)`;
read/write/writev return byte counts and may be partial. With `writev`, appends
that queue behind a running operation are written in one call. All methods may be synchronous or asynchronous. The backend must
enforce zero-filled extension, consistent sizes and ownership. The wrapper checks
every reported size and byte count: a negative, fractional or out-of-range value
rejects `IO_ERROR` instead of being read as EOF. `size` is called once per
handle and again only after a failed mutation or a short read, so a backend
whose size changes by other means is outside the contract. The wrapper never
calls `read` concurrently. Its close method releases the
resource and is called at most once; it should release ownership only after the
resource is confirmed closed. The adapter owner implements naming, listing and
deletion.

## Verification and measurements

The same 33 contract cases, admission, `appendChunks`, the write buffer and
buffer hand-off included, run against memory files and native files with
asynchronous and with synchronous I/O under vitest on Node.js and under
`bun test` on Bun, and
against memory and real OPFS in
Chromium, Firefox and WebKit dedicated workers. Additional tests cover DSON
framing, a fault matrix of short, invalid and failing backend calls, admission
accounting against a stalled backend, close-failure quarantine, borrowed
`readInto` targets, cross-build error codes, ownership across module formats,
workers and processes, worker termination, append batching, stream read-ahead,
and pulling four 4 KiB chunks (plus one read ahead) from a synthetic 8 GiB
source. That last case verifies bounded reads, not an 8 GiB resident-memory
benchmark.

`bun run test:package` installs the packed artifact in a clean consumer and checks
ESM, CommonJS, every entry point, synchronous I/O in a worker thread,
TypeScript declarations with neither DOM nor Node ambient types, and that the
root entry's module graph imports no platform module. `make bench` writes
report-only benchmarks for Node.js, Bun, and OPFS in Chromium, Firefox and
WebKit, each compared with the 0.1.0 tarball, to `benchmarks/`; they are not a
comparison with other databases. See
`VALIDATION.md` for the exact executed runtime matrix and limitations.

For a separately installed browser, `CHROMIUM_EXECUTABLE_PATH` selects its
executable and optional `CHROMIUM_ARGS` accepts a JSON string array of launch
arguments. The standard path is `bunx playwright install chromium`.

## License

MIT. Copyright 2026 Aron Homberg.
