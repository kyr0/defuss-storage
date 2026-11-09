// The shared contract cases and the DSON integration against the memory adapter
// and the native adapter with asynchronous and with synchronous I/O. Browser workers run the same cases against real OPFS.
import { describe, test } from 'vitest';
import * as dson from 'defuss-dson/sequence';
import { createMemoryStorage, type AdapterOptions, type StorageAdapter } from '../dist/index.mjs';
import { createFileStorage } from '../dist/node.mjs';
import { contractCases, dsonContract, runCase } from './contract.ts';
import { withTempDir } from './fixtures.ts';

/** Runs `body` with an adapter of one kind and a factory for more of the same kind and namespace. */
type Fixture = (body: (storage: StorageAdapter, configure: (options: AdapterOptions) => Promise<StorageAdapter>) => Promise<void>) => Promise<void>;
const adapters: Record<string, Fixture> = {
  memory: body => body(createMemoryStorage(), async options => createMemoryStorage(options)),
  file: body => withTempDir('storage-test', async dir => body(await createFileStorage(dir), options => createFileStorage(dir, options))),
  'file (sync I/O)': body => withTempDir('storage-sync', async dir => body(await createFileStorage(dir, { io: 'sync' }), options => createFileStorage(dir, { ...options, io: 'sync' }))),
};

for (const [adapter, fixture] of Object.entries(adapters)) {
  describe(adapter, () => {
    for (const [name, body] of contractCases) {
      test(name, () => fixture((storage, configure) => runCase(storage, body, configure)));
    }
    test('DSON 1.3.0 direct seek and incremental decode', () => fixture(async storage => { await dsonContract(storage, dson); }));
  });
}
