// Benchmark workloads shared by scripts/bench.mjs (Node.js and Bun: memory and
// native files) and scripts/bench-worker.mjs (OPFS in browser workers), so every
// runtime runs the same code and its figures stay comparable. No platform
// imports: browsers load this file as served. Every workload checks its results
// (offsets, lengths, checksums), so a fast but wrong result fails the run
// instead of being recorded.

export const MiB = 1024 * 1024;

/** Deterministic bytes: xorshift32 over 32-bit words, seeded per chunk so any chunk can be regenerated alone. */
export function fill(target, seed) {
  const words = new Uint32Array(target.buffer, target.byteOffset, target.byteLength >>> 2);
  let x = (seed * 2654435761 + 1) >>> 0 || 1;
  for (let i = 0; i < words.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; words[i] = x >>> 0; }
  for (let i = words.length * 4; i < target.length; i++) target[i] = i & 255;
  return target;
}
export const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null;
export const median = values => percentile([...values].sort((a, b) => a - b), 0.5);
export const round = (value, digits = 3) => value === null ? null : Number(value.toFixed(digits));

/** Consumer work for the stream benchmark: a rotate-xor over 32-bit words, touching every byte once. */
export function checksum(bytes, sum) {
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >>> 2);
  for (let i = 0; i < words.length; i++) sum = ((sum << 5) | (sum >>> 27)) ^ words[i];
  return sum >>> 0;
}

/** Median plus the run-to-run range, so a difference smaller than the spread is not read as a change. */
export function spread(values) { const sorted = [...values].sort((a, b) => a - b); return { median: round(median(sorted)), min: round(sorted[0]), max: round(sorted.at(-1)) }; }
/**
 * Per-call latency percentiles plus the mean. Why the mean as well: browsers
 * coarsen `performance.now()`, so a per-call percentile of a microsecond
 * operation is quantization. VERIFIED: (OPFS runs) worker timers stepped by
 * 5 µs (Chromium) and 20 µs (Firefox, WebKit), and OPFS `readInto` reported a
 * p50 of 0 µs. HYPOTHESIS: the mean of many quantized samples tracks the true
 * cost, since each call starts at a random phase of the timer's tick;
 * falsifier: a mean that differs from the total time of an untimed loop
 * divided by its calls.
 */
export const latency = values => {
  const sorted = values.sort((a, b) => a - b); const total = sorted.reduce((sum, v) => sum + v, 0);
  return { reads: sorted.length, mean: round(sorted.length ? total / sorted.length : null), p50: round(percentile(sorted, 0.5)), p95: round(percentile(sorted, 0.95)), p99: round(percentile(sorted, 0.99)) };
};

/**
 * Binds the workloads to one configuration ({reps, datasetBytes, chunkSizes,
 * randomReads, randomReadBytes}) and a log function that receives one message
 * per event; the caller adds timestamp and level.
 */
export function workloads(config, log) {
  /** Deterministic random offsets (seeded xorshift32) for `count` reads within a file of `bytes`. */
  function offsets(count, bytes, seed) {
    const out = []; let x = (0x9e3779b9 + seed) >>> 0;
    for (let i = 0; i < count; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; out.push(x % (bytes - config.randomReadBytes)); }
    return out;
  }

  /**
   * One repetition: timed sequential appends, a separately timed flush, a full
   * stream scan, random 4 KiB `read` (allocating) and `readInto` lookups, and the
   * same lookups with eight `readInto` calls in flight on a read-only reopen.
   * Every result is checked against the deterministic chunk, so a fast but wrong
   * result cannot pass as a measurement.
   */
  async function sequentialRun(storage, chunkSize, rep) {
    const name = `seq-${chunkSize}-${rep}.bin`; const file = await storage.open(name, { create: true, exclusive: true });
    const chunk = fill(new Uint8Array(chunkSize), chunkSize + rep); const count = Math.max(1, Math.floor(config.datasetBytes / chunkSize));
    const bytes = count * chunkSize; const check = (at, value) => { if (value !== chunk[at % chunkSize]) throw new Error('random read verification failed'); };
    let result;
    try {
      let start = performance.now();
      for (let i = 0; i < count; i++) { const r = await file.append(chunk); if (r.offset !== i * chunkSize) throw new Error('append offset mismatch'); }
      const appendMs = performance.now() - start;
      start = performance.now(); await file.flush(); const flushMs = performance.now() - start;
      let seen = 0; let firstChunkMs = null;
      start = performance.now();
      for await (const part of file.stream({ chunkSize: Math.min(chunkSize, file.maxReadBytes) })) {
        firstChunkMs ??= performance.now() - start;
        if (part[0] !== chunk[(seen % chunkSize)]) throw new Error('stream verification failed'); seen += part.length;
      }
      const streamMs = performance.now() - start; if (seen !== bytes) throw new Error('stream length mismatch');
      let expected = 0; for (let i = 0; i < count; i++) expected = checksum(chunk, expected);
      let sum = 0; start = performance.now();
      for await (const part of file.stream({ chunkSize: Math.min(chunkSize, file.maxReadBytes) })) sum = checksum(part, sum);
      const streamWorkMs = performance.now() - start; if (sum !== expected) throw new Error('stream checksum mismatch');
      const readMicros = []; const readIntoMicros = []; const target = new Uint8Array(config.randomReadBytes);
      for (const at of offsets(config.randomReads, bytes, rep)) {
        let t = performance.now(); const copy = await file.read(at, target.length); readMicros.push((performance.now() - t) * 1000);
        if (copy.length !== target.length) throw new Error('random read length mismatch'); check(at, copy[0]);
        t = performance.now(); const n = await file.readInto(at, target); readIntoMicros.push((performance.now() - t) * 1000);
        if (n !== target.length) throw new Error('random readInto length mismatch'); check(at, target[0]);
      }
      result = { bytes, appendMs, flushMs, streamMs, streamWorkMs, firstChunkMs, readMicros, readIntoMicros };
    } finally { await file.close(); }
    const pipeName = `pipe-${chunkSize}-${rep}.bin`; const piped = await storage.open(pipeName, { create: true, exclusive: true });
    try {
      // Sixteen appends in flight, awaited together: the producer pattern that batching serves.
      const start = performance.now();
      for (let i = 0; i < count; i += 16) {
        const receipts = await Promise.all(Array.from({ length: Math.min(16, count - i) }, () => piped.append(chunk)));
        receipts.forEach((r, k) => { if (r.offset !== (i + k) * chunkSize) throw new Error('pipelined append offset mismatch'); });
      }
      result.pipelinedAppendMs = performance.now() - start;
      if ((await piped.size()) !== bytes) throw new Error('pipelined append size mismatch');
    } finally { await piped.close(); await storage.remove(pipeName); }
    try {
      // Eight lookups in flight on a read-only handle; 0.1.0 and serial adapters run them one by one.
      const reader = await storage.open(name, { readOnly: true }); const inFlight = 8; const ats = offsets(config.randomReads * 4, bytes, rep + 1); let next = 0;
      try {
        const start = performance.now();
        await Promise.all(Array.from({ length: inFlight }, async () => {
          const target = new Uint8Array(config.randomReadBytes);
          while (next < ats.length) { const at = ats[next++]; await reader.readInto(at, target); check(at, target[0]); }
        }));
        result.parallelReadsPerSecond = ats.length / ((performance.now() - start) / 1000); result.parallelInFlight = inFlight;
      } finally { await reader.close(); }
    } finally { await storage.remove(name); }
    return result;
  }

  /** Summarizes the repetitions of one version × adapter × chunk size. */
  function summarize(runs) {
    const bytes = runs[0].bytes;
    return {
      bytes, reps: runs.length, readBytes: config.randomReadBytes,
      appendMiBps: spread(runs.map(r => bytes / MiB / (r.appendMs / 1000))),
      pipelinedAppendMiBps: { inFlight: 16, ...spread(runs.map(r => bytes / MiB / (r.pipelinedAppendMs / 1000))) },
      flushMs: spread(runs.map(r => r.flushMs)),
      streamMiBps: spread(runs.map(r => bytes / MiB / (r.streamMs / 1000))),
      streamWithChecksumMiBps: spread(runs.map(r => bytes / MiB / (r.streamWorkMs / 1000))),
      firstChunkMs: spread(runs.map(r => r.firstChunkMs)),
      readMicros: latency(runs.flatMap(r => r.readMicros)),
      readIntoMicros: latency(runs.flatMap(r => r.readIntoMicros)),
      parallelReadsPerSecond: { inFlight: runs[0].parallelInFlight, ...spread(runs.map(r => r.parallelReadsPerSecond)) },
    };
  }

  /**
   * Runs every version on the same adapter kind, interleaved per repetition with
   * the order alternating, so drift (CPU frequency, page cache, GC) does not bias
   * the version comparison toward whichever runs first.
   */
  async function sequentialSuite(adapter, storages) {
    const out = Object.fromEntries(Object.keys(storages).map(label => [label, {}]));
    for (const chunkSize of config.chunkSizes) {
      const runs = Object.fromEntries(Object.keys(storages).map(label => [label, []]));
      for (let rep = 0; rep < config.reps; rep++) {
        const order = Object.keys(storages); if (rep % 2) order.reverse();
        for (const label of order) runs[label].push(await sequentialRun(storages[label], chunkSize, rep));
      }
      for (const label of Object.keys(storages)) {
        const r = out[label][chunkSize] = summarize(runs[label]);
        log(`${label} ${adapter} chunk=${chunkSize}: append ${r.appendMiBps.median} MiB/s (${r.appendMiBps.min}-${r.appendMiBps.max}), 16 in flight ${r.pipelinedAppendMiBps.median} (${r.pipelinedAppendMiBps.min}-${r.pipelinedAppendMiBps.max}), stream+checksum ${r.streamWithChecksumMiBps.median} (${r.streamWithChecksumMiBps.min}-${r.streamWithChecksumMiBps.max}), read p50 ${r.readMicros.p50} µs, readInto p50 ${r.readIntoMicros.p50} µs (mean ${r.readIntoMicros.mean}), ${r.parallelReadsPerSecond.inFlight} in flight ${Math.round(r.parallelReadsPerSecond.median / 1000)}k reads/s`);
      }
    }
    return out;
  }

  /**
   * This build's opt-in features against its defaults, each variant interleaved
   * per repetition with alternating order. `storages.async` is the default
   * adapter; `storages.sync`, when given (native files with `io: "sync"`), adds
   * the synchronous-I/O variants and an async/sync lookup and scan comparison.
   * Appends are timed until a final 1-byte read, which writes any buffered bytes
   * first, so the write buffer is charged for its last write. Every variant
   * checks the resulting size.
   */
  async function optionsSuite(core, storages) {
    const small = 4096; const count = config.datasetBytes / small; const bigCount = config.datasetBytes / MiB; const chunk = fill(new Uint8Array(small), 11);
    let seq = 0;
    /** Opens a fresh file, times `body` plus the final read, checks the size, removes the file. */
    const timed = async (storage, openOptions, bytes, body) => {
      const name = `opt-${seq++}.bin`; const f = await storage.open(name, { create: true, exclusive: true, ...openOptions });
      try {
        const start = performance.now(); await body(f); await f.read(0, 1); const ms = performance.now() - start;
        if ((await f.size()) !== bytes) throw new Error('options size mismatch'); return bytes / MiB / (ms / 1000);
      } finally { await f.close(); await storage.remove(name); }
    };
    const awaited = f => (async () => { for (let i = 0; i < count; i++) await f.append(chunk); })();
    async function* chunks() { for (let i = 0; i < count; i++) yield chunk; }
    const variants = {
      'append 4 KiB awaited': () => timed(storages.async, {}, config.datasetBytes, awaited),
      'append 4 KiB awaited, writeBuffer 1 MiB': () => timed(storages.async, { writeBuffer: MiB }, config.datasetBytes, awaited),
      ...(storages.sync ? { 'append 4 KiB awaited, io sync': () => timed(storages.sync, {}, config.datasetBytes, awaited) } : {}),
      'appendChunks 4 KiB, inFlight 1': () => timed(storages.async, {}, config.datasetBytes, async f => { for await (const _ of core.appendChunks(f, chunks())) { /* receipts unused */ } }),
      'appendChunks 4 KiB, inFlight 16': () => timed(storages.async, {}, config.datasetBytes, async f => { for await (const _ of core.appendChunks(f, chunks(), { inFlight: 16 })) { /* receipts unused */ } }),
      ...Object.fromEntries([false, true].map(transfer => [`append 1 MiB awaited, ${transfer ? 'transfer' : 'copy'}`, () => {
        // Fresh inputs for both variants, allocated before timing: a transfer detaches each one.
        const inputs = Array.from({ length: bigCount }, (_, i) => fill(new Uint8Array(MiB), i));
        return timed(storages.async, {}, bigCount * MiB, async f => {
          for (const input of inputs) { await f.append(input, { transfer }); if (transfer && input.buffer.byteLength) throw new Error('transfer did not detach'); }
        });
      }])),
    };
    const runs = Object.fromEntries(Object.keys(variants).map(k => [k, []]));
    for (let rep = 0; rep < config.reps; rep++) {
      const order = Object.keys(variants); if (rep % 2) order.reverse();
      for (const key of order) runs[key].push(await variants[key]());
    }
    const out = { appendMiBps: Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, spread(v)])) };
    for (const [k, v] of Object.entries(out.appendMiBps)) log(`options ${k}: ${v.median} MiB/s (${v.min}-${v.max})`);
    if (!storages.sync) return out;
    // Random 4 KiB readInto latency and a 64 KiB stream scan, async against sync I/O.
    const lookups = { async: [], sync: [] }; const scans = { async: [], sync: [] };
    for (let rep = 0; rep < config.reps; rep++) for (const io of rep % 2 ? ['sync', 'async'] : ['async', 'sync']) {
      const name = `opt-read-${rep}.bin`; const w = await storages[io].open(name, { create: true, exclusive: true });
      for (let i = 0; i < count; i += 256) await w.append(fill(new Uint8Array(small * 256), i)); await w.close();
      const f = await storages[io].open(name, { readOnly: true }); const target = new Uint8Array(small);
      try {
        for (const at of offsets(config.randomReads, config.datasetBytes, rep)) { const t = performance.now(); if ((await f.readInto(at, target)) !== small) throw new Error('readInto length'); lookups[io].push((performance.now() - t) * 1000); }
        let seen = 0; const t = performance.now(); for await (const part of f.stream({ chunkSize: 65536 })) seen += part.length;
        if (seen !== config.datasetBytes) throw new Error('scan length'); scans[io].push(config.datasetBytes / MiB / ((performance.now() - t) / 1000));
      } finally { await f.close(); await storages[io].remove(name); }
    }
    out.readIntoMicros = { async: latency(lookups.async), sync: latency(lookups.sync) };
    out.streamMiBps = { async: spread(scans.async), sync: spread(scans.sync) };
    log(`options readInto p50 async ${out.readIntoMicros.async.p50} µs, sync ${out.readIntoMicros.sync.p50} µs; stream 64 KiB async ${out.streamMiBps.async.median} MiB/s, sync ${out.streamMiBps.sync.median} MiB/s`);
    return out;
  }

  return { sequentialSuite, optionsSuite };
}
