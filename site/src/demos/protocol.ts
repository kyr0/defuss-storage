// The message contract between the page and the demo worker. Requests carry an
// id; the worker answers each with one Reply (and, for long jobs, Progress
// messages before it). Kept in one module so both sides type-check against it.
// VERIFIED: (tsc) page and worker compile against this contract.

/** Where a demo runs: OPFS, memory, or a folder the visitor picked (Chromium's directory picker). */
export type Backend = 'opfs' | 'memory' | 'directory';

export interface FileView {
  readonly backend: Backend;
  /** Why OPFS was not used, when backend is memory. */
  readonly reason?: string;
  readonly size: number;
  /** Up to the last 256 bytes of the file, and where they start. */
  readonly tail: Uint8Array;
  readonly tailOffset: number;
}

export interface BenchCase {
  readonly id: 'append4k' | 'append4kBuffered' | 'append1mCopy' | 'append1mTransfer' | 'stream64k' | 'readInto4k';
  readonly unit: 'MiB/s' | 'µs';
  readonly value: number;
}

/** One record of the seek demo, read from the file at its indexed offset. */
export interface SeekRow { readonly index: number; readonly offset: number; readonly text: string }

/** The backend a demo run asks for; OPFS falls back to memory where the context has none. */
export interface On { readonly backend: Backend }

export interface Requests {
  /** Hands the worker the folder the visitor picked; the directory backend writes below it. */
  'dir:set': { args: { handle: FileSystemDirectoryHandle }; result: { name: string } };
  'persist:state': { args: On; result: FileView };
  'persist:append': { args: On & { text: string }; result: FileView & { offset: number; byteLength: number; ms: number } };
  'persist:read': { args: On; result: FileView & { text: string; ms: number } };
  'persist:truncate': { args: On; result: FileView };
  'owner:open': { args: Record<string, never>; result: { backend: Backend } };
  'owner:close': { args: Record<string, never>; result: null };
  'limits:fire': { args: On & { calls: number; chunk: number; ops: number; bytes: number }; result: { states: ('ok' | 'full' | 'error')[]; ms: number; backend: Backend } };
  'limits:chunks': { args: On & { calls: number; chunk: number; ops: number; bytes: number }; result: { count: number; ms: number; backend: Backend } };
  'bench:run': { args: Record<string, never>; result: { cases: BenchCase[]; backend: Backend } };
  'seek:generate': { args: On & { records: number }; result: { records: number; bytes: number; writeMs: number; seekMicros: number; backend: Backend } };
  'seek:rows': { args: { from: number; count: number }; result: { rows: SeekRow[] } };
  'seek:jump': { args: { index: number }; result: SeekRow & { byteLength: number } };
}

export type Operation = keyof Requests;

export interface Request<O extends Operation = Operation> { readonly id: number; readonly op: O; readonly args: Requests[O]['args'] }

export type Reply =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly code: string; readonly message: string };

export interface Progress { readonly id: number; readonly progress: number; readonly step: string }
