// Byte-stream ingestion: copies a native file into a defuss-storage file with
// appendChunks, then streams it back and compares SHA-256 digests. Neither side
// holds the whole file: input chunks come from fs.createReadStream (64 KiB) and
// the verification pass reads 64 KiB chunks. VERIFIED: (run 2026-11-07) a
// 69,049-byte input was ingested in 2 appends with matching digests.
// Usage: bun examples/stream-ingest.ts [file] (or Node.js 24+, which strips types natively; VERIFIED on 24.22.2 and 26.11.1)
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendChunks } from '../dist/index.mjs';
import { createFileStorage } from '../dist/node.mjs';

const input = process.argv[2] ?? fileURLToPath(import.meta.url);
const root = await mkdtemp(path.join(tmpdir(), 'defuss-storage-ingest-'));
try {
  const storage = await createFileStorage(root);
  const file = await storage.open('copy.bin', { create: true, exclusive: true });
  try {
    const source = createHash('sha256'); let chunks = 0;
    // Hash each chunk as it passes through, so the reference digest is streaming too.
    async function* hashed(stream: AsyncIterable<Uint8Array>) { for await (const chunk of stream) { source.update(chunk); yield chunk; } }
    for await (const _receipt of appendChunks(file, hashed(createReadStream(input)))) chunks++;
    await file.flush();
    const copy = createHash('sha256');
    for await (const chunk of file.stream()) copy.update(chunk);
    const [expected, actual] = [source.digest('hex'), copy.digest('hex')];
    console.log(`Ingested ${await file.size()} bytes in ${chunks} appends; sha256 ${actual}`);
    if (expected !== actual) throw new Error(`digest mismatch: ${expected} != ${actual}`);
  } finally { await file.close(); }
} finally { await rm(root, { recursive: true, force: true }); }
