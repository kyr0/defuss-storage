// Page side of the demo worker: typed request/reply over postMessage.
import type { Operation, Progress, Reply, Requests } from './protocol.ts';

/** A failed worker request, carrying the StorageError code when there was one. */
export class DemoError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export interface DemoWorker {
  call<O extends Operation>(op: O, args: Requests[O]['args'], onProgress?: (progress: number, step: string) => void): Promise<Requests[O]['result']>;
  terminate(): void;
}

/** Starts one demo worker. VERIFIED: (site e2e ownership) each instance is its own Web Lock owner. */
export function startWorker(): DemoWorker {
  const worker = new Worker(new URL('./storage.worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; progress?: (progress: number, step: string) => void }>();
  let next = 1;
  worker.onmessage = ({ data }: MessageEvent<Reply | Progress>) => {
    const entry = pending.get(data.id);
    if (!entry) return;
    if ('progress' in data) { entry.progress?.(data.progress, data.step); return; }
    pending.delete(data.id);
    if (data.ok) entry.resolve(data.value);
    else entry.reject(new DemoError(data.code, data.message));
  };
  worker.onerror = event => {
    for (const entry of pending.values()) entry.reject(new DemoError('WORKER', event.message || 'worker failed'));
    pending.clear();
  };
  return {
    call(op, args, onProgress) {
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, progress: onProgress });
        worker.postMessage({ id, op, args });
      });
    },
    terminate() {
      worker.terminate();
      for (const entry of pending.values()) entry.reject(new DemoError('TERMINATED', 'worker terminated'));
      pending.clear();
    },
  };
}

let shared: DemoWorker | undefined;
/** The page's long-lived demo worker (persistence, limits, benchmark). */
export const demoWorker = (): DemoWorker => (shared ??= startWorker());
