/**
 * Byte backend over a `FileSystemFileHandle`: reads from `getFile()`
 * snapshots, writes committed through `createWritable`. The directory adapter
 * uses it for every handle, the OPFS adapter for shared handles where the
 * browser has no read-only sync access handle.
 *
 * Why commit per write instead of keeping one stream open until `flush()`:
 * a stream's bytes stay invisible to `getFile()` until it closes, so an open
 * stream would break read-after-write, which every adapter guarantees. The
 * price is a copy of the file per backend write; the `writeBuffer` open option
 * and append batching (`writev`) turn many small appends into one commit.
 * HYPOTHESIS: the copy makes each commit cost grow with the file size
 * (falsifier: commit time flat across file sizes in a browser benchmark).
 *
 * @module
 */
import type { ByteBackend } from "./file.js";

// Structural host interfaces keep declarations independent of DOM lib versions;
// a DOM FileSystemFileHandle satisfies FileHandle.
interface WritableStream {
  write(params: { type: "write"; position: number; data: ArrayBuffer }): Promise<void>;
  truncate(size: number): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}
interface FileSnapshot {
  readonly size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}
export interface FileHandle {
  readonly kind: "file";
  getFile(): Promise<FileSnapshot>;
  createWritable?(options: { keepExistingData: boolean }): Promise<WritableStream>;
}
/**
 * The bytes of `data` as an ArrayBuffer of exactly their length; a view that
 * covers a whole ArrayBuffer passes through without a copy. Why not the view:
 * WebKit's writable stream writes the entire buffer behind a view, ignoring its
 * offset and length. VERIFIED: (write-buffer contract case, WebKit 26.5) 1-byte
 * views of a 4-byte write buffer landed as 4 bytes each, [6, 2, 3, 0] instead
 * of [6]. An ArrayBuffer also fits the DOM's write type, which refuses views
 * that may sit on a SharedArrayBuffer.
 */
const exact = (data: Uint8Array): ArrayBuffer => {
  const { buffer } = data;
  return buffer instanceof ArrayBuffer && data.byteOffset === 0 && data.byteLength === buffer.byteLength ? buffer : data.slice().buffer as ArrayBuffer;
};

/**
 * Byte backend over one file handle; each write, writev and truncate is one
 * committed stream. Reads share one `getFile()` snapshot until the next commit
 * replaces the file. Why not a snapshot per read: VERIFIED: (site probe,
 * Chromium 151, OPFS-backed folder, 1,000 random record reads) 400 µs per read
 * with a fresh snapshot, 260 µs with a shared one. A read that fails is retried
 * once on a fresh snapshot. HYPOTHESIS: Chromium rejects reads of a snapshot
 * whose file another program changed (falsifier: change the file outside the
 * browser, then read through an open handle without an error).
 */
export function fileBackend(file: FileHandle, release: () => Promise<void>): ByteBackend {
  let snapshot: Promise<FileSnapshot> | undefined;
  const current = (): Promise<FileSnapshot> => (snapshot ??= file.getFile());
  const commit = async (edit: (stream: WritableStream) => Promise<number>): Promise<number> => {
    snapshot = undefined;
    const stream = await file.createWritable!({ keepExistingData: true });
    let written: number;
    try { written = await edit(stream); } catch (error) {
      // Abort discards the copy; the file keeps its last committed bytes.
      await stream.abort(error).catch(() => {});
      throw error;
    }
    await stream.close();
    return written;
  };
  const slice = async (offset: number, length: number): Promise<Uint8Array> =>
    new Uint8Array(await (await current()).slice(offset, offset + length).arrayBuffer());
  return {
    size: async () => (await current()).size,
    read: async (offset, target) => {
      let bytes: Uint8Array;
      try { bytes = await slice(offset, target.length); } catch {
        snapshot = undefined;
        bytes = await slice(offset, target.length);
      }
      target.set(bytes);
      return bytes.length;
    },
    write: (offset, data) => commit(async stream => {
      await stream.write({ type: "write", position: offset, data: exact(data) });
      return data.length;
    }),
    writev: (offset, chunks) => commit(async stream => {
      let at = offset;
      for (const chunk of chunks) { await stream.write({ type: "write", position: at, data: exact(chunk) }); at += chunk.length; }
      return at - offset;
    }),
    truncate: async size => { await commit(async stream => { await stream.truncate(size); return 0; }); },
    // Nothing to flush: each write was committed when its stream closed.
    flush: () => {},
    close: release,
  };
}
