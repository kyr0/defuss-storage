// Dedicated-worker side of the parallel benchmark (bench-parallel.mjs). The
// page starts several of these workers and sends each one request at a time:
// 'setup' writes the scan dataset, 'scan' streams one byte range and spends
// `work` steps per 16 bytes, which stands in for a decoder, 'fill' appends
// `bytes` to a file of its own after the same work per chunk, which stands in
// for an encoder, 'fillShared' writes one byte range of a file that other
// workers write at once, through a shared writer, and 'drop' returns a file's
// size and removes it. Replies are {result} or {error}. VERIFIED: (bench:parallel,
// 2026-11-20) with 64 steps one worker coded 200 to 620 MiB/s in Chromium 151,
// Firefox 153 and WebKit 26.5, a few hundred MiB/s per core like a real decoder.
import { createOPFSStorage } from '/dist/opfs.mjs';

let store;
const tasks = {
  async setup({ namespace, bytes }) {
    store = await createOPFSStorage({ name: namespace });
    const file = await store.open('scan.bin', { create: true }); await file.truncate(0);
    const block = new Uint8Array(1 << 20); for (let i = 0; i < block.length; i++) block[i] = (i * 31) & 255;
    for (let at = 0; at < bytes; at += block.length) await file.write(at, block.subarray(0, Math.min(block.length, bytes - at)));
    await file.flush(); await file.close(); return { sharedWriters: store.capabilities.sharedWriters === true };
  },
  async scan({ namespace, start, end, work, chunkSize, shared }) {
    store ??= await createOPFSStorage({ name: namespace });
    const file = await store.open('scan.bin', shared ? { readOnly: true, shared: true } : {});
    let bytes = 0, sum = 0;
    try {
      for await (const chunk of file.stream({ start, end, chunkSize })) {
        bytes += chunk.length;
        for (let i = 0; i < chunk.length; i += 16) for (let k = 0; k < work; k++) sum = (sum + chunk[i] * k) | 0;
      }
    } finally { await file.close(); }
    return { bytes, sum };
  },
  async fill({ namespace, name, bytes, work, chunkSize }) {
    store ??= await createOPFSStorage({ name: namespace });
    const chunk = new Uint8Array(chunkSize); for (let i = 0; i < chunk.length; i++) chunk[i] = (i * 31) & 255;
    const file = await store.open(name, { create: true });
    let sum = 0;
    try {
      await file.truncate(0);
      for (let at = 0; at < bytes; at += chunkSize) {
        for (let i = 0; i < chunk.length; i += 16) for (let k = 0; k < work; k++) sum = (sum + chunk[i] * k) | 0;
        await file.append(chunk.subarray(0, Math.min(chunkSize, bytes - at)));
      }
      await file.flush();
      return { bytes: await file.size(), sum };
    } finally { await file.close(); await store.remove(name); }
  },
  async fillShared({ namespace, start, end, work, chunkSize }) {
    store ??= await createOPFSStorage({ name: namespace });
    const chunk = new Uint8Array(chunkSize); for (let i = 0; i < chunk.length; i++) chunk[i] = (i * 31) & 255;
    const file = await store.open('fill-shared.bin', { create: true, shared: true });
    let sum = 0;
    try {
      for (let at = start; at < end; at += chunkSize) {
        for (let i = 0; i < chunk.length; i += 16) for (let k = 0; k < work; k++) sum = (sum + chunk[i] * k) | 0;
        await file.write(at, chunk.subarray(0, Math.min(chunkSize, end - at)));
      }
      await file.flush();
      return { bytes: end - start, sum };
    } finally { await file.close(); }
  },
  async drop({ namespace, name }) {
    store ??= await createOPFSStorage({ name: namespace });
    const file = await store.open(name, { readOnly: true }); const size = await file.size(); await file.close();
    await store.remove(name); return size;
  },
};
self.onmessage = async ({ data }) => {
  try { postMessage({ id: data.id, result: await tasks[data.task](data) }); }
  catch (error) { postMessage({ id: data.id, error: `${error?.name} ${error?.code ?? ''}: ${error?.message}` }); }
};
