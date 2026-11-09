// DSON 1.3.0 frames over defuss-storage: append encoded frames, seek one record
// directly through its recorded offset, then decode the whole file incrementally
// from small stream chunks. Storage stays byte-only; DSON owns the framing.
// Run: bun examples/dson-frames.ts (or Node.js 24+, which strips types natively; VERIFIED on 24.22.2 and 26.11.1).
import { createMemoryStorage } from '../dist/index.mjs';
import { encodeFrame, inspectFrame, decodeFrame, SequenceDecoder, FRAME_HEADER_BYTES } from 'defuss-dson/sequence';

const storage = createMemoryStorage();
const file = await storage.open('records.dsq', { create: true, exclusive: true });
try {
  // This example keeps its index in memory; persistent indexes belong to DBSONL.
  const offsets = new Map<string, number>();
  for (const value of [{ id: 'a', score: 12n }, { id: 'b', score: 24n }]) {
    offsets.set(value.id, (await file.append(encodeFrame(value))).offset);
  }
  await file.flush();
  const offset = offsets.get('b')!;
  const metadata = inspectFrame(await file.readExactly(offset, FRAME_HEADER_BYTES));
  // VERIFIED: (probe, DSON 1.3.0) inspectFrame reports offset 0 for the freshly
  // read header buffer while the frame's file offset is 48.
  const found = decodeFrame(await file.readExactly(offset, metadata.byteLength)).value;
  console.log('Seek:', found);
  const decoder = new SequenceDecoder();
  for await (const chunk of file.stream({ chunkSize: 7 })) {
    for (const record of decoder.push(chunk)) console.log('Stream:', record.offset, record.value);
  }
  decoder.finish();
} finally { await file.close(); }
