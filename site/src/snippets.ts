// Code shown in the page's code windows (highlighted at build time) and the
// playground's example scripts (highlighted in the editor). Every snippet uses
// the package's public API as documented in its README. VERIFIED: (site e2e)
// the playground examples run against the package build.
import type { Snippet } from '../build/highlight.ts';

const shell = (code: string): Snippet => ({ lang: 'shellscript', code, prefix: '$' });
const js = (code: string): Snippet => ({ lang: 'javascript', code });

export const snippets: Readonly<Record<string, Snippet>> = {
  hero: js(`import { createOPFSStorage } from 'defuss-storage/opfs';

const storage = await createOPFSStorage({ name: 'my-app' });
const log = await storage.open('events.log', {
  create: true,
  writeBuffer: 1024 * 1024, // batch small appends
});

const bytes = new TextEncoder().encode('hello\\n');
const { offset } = await log.append(bytes);
await log.readExactly(offset, bytes.byteLength);
await log.flush();`),

  'install-bun': shell('bun add defuss-storage'),
  'install-pnpm': shell('pnpm add defuss-storage'),
  'install-npm': shell('npm install defuss-storage'),
  'install-yarn': shell('yarn add defuss-storage'),

  persist: js(`const line = new TextEncoder().encode(text + '\\n');
const { offset, byteLength } = await file.append(line);
await file.flush();`),

  'limits-fire': js(`const file = await storage.open('limits.bin', { create: true });
// limits come from createOPFSStorage({ maxPendingOperations, maxPendingWriteBytes })
const calls = Array.from({ length: n }, () => file.append(chunk));
const results = await Promise.allSettled(calls);
// rejected: StorageError { code: 'QUEUE_FULL' }, nothing copied`),
  'limits-chunks': js(`import { appendChunks } from 'defuss-storage';

async function* chunks() {
  for (let i = 0; i < n; i++) yield chunk;
}
// as many appends in flight as the limits admit
const inFlight = Math.min(maxPendingOperations, maxPendingWriteBytes / chunk.byteLength);
for await (const receipt of appendChunks(file, chunks(), { inFlight })) count++;`),

  seek: js(`const index = [];
for (const line of lines) index.push(await log.append(encode(line)));

// any record, one read at its offset:
const { offset, byteLength } = index[123456];
const record = await log.readExactly(offset, byteLength);`),
  'use-worker': js(`import { createOPFSStorage } from 'defuss-storage/opfs';

const storage = await createOPFSStorage({ name: 'notes' });
const file = await storage.open('notes.log', { create: true });

self.onmessage = async ({ data }) => {
  const bytes = new TextEncoder().encode(data + '\\n');
  const receipt = await file.append(bytes);
  await file.flush();
  self.postMessage(receipt); // { offset, byteLength }
};`),
  'use-main': js(`const worker = new Worker(
  new URL('./storage.worker.js', import.meta.url),
  { type: 'module' },
);

worker.onmessage = ({ data }) => console.log('stored at', data.offset);
worker.postMessage('first note');`),
  'use-node': js(`import { createReadStream } from 'node:fs';
import { appendChunks } from 'defuss-storage';
import { createFileStorage } from 'defuss-storage/node';

const storage = await createFileStorage('./data');
const file = await storage.open('copy.bin', { create: true });
try {
  const source = createReadStream('./input.bin', { highWaterMark: 64 * 1024 });
  for await (const { offset, byteLength } of appendChunks(file, source, { inFlight: 16 })) {
    // index records by offset here
  }
  await file.flush();
} finally {
  await file.close();
}`),
  'use-memory': js(`import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from 'defuss-storage';
import { appendRecord } from './log.js'; // your code, taking any storage

test('appends a record', async () => {
  const storage = createMemoryStorage();
  const file = await storage.open('log', { create: true });
  const { offset } = await appendRecord(file, { id: 1 });
  assert.equal(offset, 0);
  await file.close();
});`),
  errors: js(`try {
  await storage.open('events.log');
} catch (error) {
  if (error.code === 'BUSY') showOpenElsewhere();
  else if (error.code === 'NOT_FOUND') createFirst();
  else throw error;
}`),
  bench: shell('make bench   # Node.js, Bun and OPFS in three browsers, each against 0.1.0'),
};

/** The playground's example scripts: plain JavaScript modules, run in a fresh worker. */
export const presets: Readonly<Record<'chunks' | 'owner' | 'stream' | 'errors', string>> = {
  chunks: `import { appendChunks } from 'defuss-storage';
import { createOPFSStorage } from 'defuss-storage/opfs';

const storage = await createOPFSStorage({ name: 'playground' });
const file = await storage.open('numbers.bin', { create: true });
try {
  await file.truncate(0);
  async function* source() {
    for (let i = 0; i < 1000; i++) yield new Uint8Array(1024).fill(i % 256);
  }
  const started = performance.now();
  let count = 0;
  for await (const receipt of appendChunks(file, source(), { inFlight: 16 })) count++;
  console.log('appended', count, 'chunks in', Math.round(performance.now() - started), 'ms');
  console.log('size', await file.size());
  console.log('last 4 bytes', [...await file.readExactly(await file.size() - 4, 4)]);
  await file.flush();
} finally {
  await file.close();
}
console.log('files', await storage.list());
`,
  owner: `import { createOPFSStorage } from 'defuss-storage/opfs';

const storage = await createOPFSStorage({ name: 'playground' });
const first = await storage.open('owned.bin', { create: true });
try {
  await storage.open('owned.bin');
} catch (error) {
  console.log('second open:', error.code); // BUSY: one owner per file
}
await first.close();
const again = await storage.open('owned.bin');
console.log('after close: opened again, size', await again.size());
await again.close();

try {
  await storage.open('missing.bin');
} catch (error) {
  console.log('missing file:', error.code);
}
try {
  await again.append(new Uint8Array(1));
} catch (error) {
  console.log('closed handle:', error.code);
}
`,
  stream: `import { createOPFSStorage } from 'defuss-storage/opfs';

const storage = await createOPFSStorage({ name: 'playground' });
const file = await storage.open('stream.bin', { create: true });
try {
  await file.truncate(0);
  const block = new Uint8Array(1024 * 1024);
  for (let i = 0; i < block.length; i++) block[i] = i % 251;
  for (let i = 0; i < 8; i++) await file.append(block);

  let sum = 0;
  let chunks = 0;
  const started = performance.now();
  for await (const chunk of file.stream({ chunkSize: 64 * 1024 })) {
    for (const byte of chunk) sum = (sum + byte) % 65521;
    chunks++;
  }
  console.log(chunks, 'chunks, checksum', sum, 'in', Math.round(performance.now() - started), 'ms');
} finally {
  await file.close();
}
`,
  errors: `import { createOPFSStorage } from 'defuss-storage/opfs';

const storage = await createOPFSStorage({ name: 'playground' });
const file = await storage.open('buffered.log', { create: true, writeBuffer: 64 * 1024 });
try {
  await file.truncate(0);
  const line = new TextEncoder().encode('a small record\\n');
  const started = performance.now();
  for (let i = 0; i < 5000; i++) await file.append(line);
  console.log('5000 buffered appends in', Math.round(performance.now() - started), 'ms');
  console.log('size includes buffered bytes:', await file.size());
  await file.flush(); // writes the buffer, then flushes the handle
} finally {
  await file.close();
}
`,
};
