// Runs one playground script in a fresh dedicated worker. The script is the
// visitor's own code in their own browser; the page terminates this worker when
// the script ends or runs too long. Why a fresh worker per run instead of the
// shared demo worker: a script that loops forever or keeps a file open cannot
// block the other demos, and VERIFIED: (site e2e ownership) terminating a
// worker releases every Web Lock it took.
import * as core from 'defuss-storage';
import * as opfs from 'defuss-storage/opfs';
import { rewriteImports } from './imports.ts';

const MODULES: Record<string, unknown> = { 'defuss-storage': core, 'defuss-storage/opfs': opfs };

const post = (message: unknown) => (self as unknown as Worker).postMessage(message);

function show(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return `Uint8Array(${value.length}) [${Array.from(value.subarray(0, 16)).join(', ')}${value.length > 16 ? ', ...' : ''}]`;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try { return JSON.stringify(value); } catch { return String(value); }
}

const sandboxConsole = {
  log: (...values: unknown[]) => post({ type: 'line', tone: 'default', text: values.map(show).join(' ') }),
  info: (...values: unknown[]) => post({ type: 'line', tone: 'info', text: values.map(show).join(' ') }),
  warn: (...values: unknown[]) => post({ type: 'line', tone: 'warning', text: values.map(show).join(' ') }),
  error: (...values: unknown[]) => post({ type: 'line', tone: 'destructive', text: values.map(show).join(' ') }),
};

self.onmessage = async ({ data }: MessageEvent<{ source: string }>) => {
  const started = performance.now();
  try {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;
    const run = new AsyncFunction('__modules', 'console', rewriteImports(data.source, Object.keys(MODULES)));
    await run(MODULES, sandboxConsole);
    post({ type: 'done', ms: performance.now() - started });
  } catch (error) {
    const { code, message = String(error) } = error as { code?: string; message?: string };
    post({ type: 'error', message: code ? `${code}: ${message}` : message, ms: performance.now() - started });
  }
};
