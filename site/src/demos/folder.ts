// The folder a visitor picks for the Filesystem backend, in browsers that offer
// showDirectoryPicker (Chromium-based ones). The page keeps the handle for the
// session and hands it to the demo worker, where createDirectoryStorage writes
// below it. Why per session instead of storing the handle: a stored handle
// needs a fresh permission prompt after a reload anyway, so the visitor picks
// again. VERIFIED: (site e2e, three engines, with an OPFS folder standing in
// for the native picker) the persistence demo writes to and reads from the folder.
import { demoWorker } from './client.ts';

type Picker = (options: { mode: 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>;
const picker = (): Picker | undefined => (globalThis as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;

let folder: string | undefined;
const listeners = new Set<() => void>();

/** True where the browser can ask for a folder on this computer. */
export const canPickFolder = (): boolean => typeof picker() === 'function';
/** The picked folder's name, or undefined before a pick. */
export const pickedFolder = (): string | undefined => folder;
/** Runs `listener` after each successful pick. */
export function onFolderPicked(listener: () => void): void { listeners.add(listener); }

/**
 * Asks for a folder with read-write access (call it from a click: the picker
 * needs that gesture) and hands it to the worker. Resolves false when the
 * visitor cancels the dialog.
 */
export async function pickFolder(): Promise<boolean> {
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await picker()!({ mode: 'readwrite', id: 'defuss-storage-demo' });
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') return false;
    throw error;
  }
  folder = (await demoWorker().call('dir:set', { handle })).name;
  for (const listener of listeners) listener();
  return true;
}
