// Pure client modules against real inputs: hex rows, the playground's import
// rewriting, chart options over the published reports, and engine matching.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { siteData } from '../build/data.ts';
import { explorerNote, explorerOption, optionsOption, rowsFor } from '../src/chart-options.ts';
import { rewriteImports } from '../src/demos/imports.ts';
import { hexRows } from '../src/hex.ts';
import { message } from '../src/messages.ts';

const data = siteData(fileURLToPath(new URL('../..', import.meta.url)));
const text = (key: string, values?: Record<string, string | number>) => message('en', key as never, values);
const format = (value: number, digits = 0) => value.toFixed(digits);

test('hexRows aligns to 16-byte offsets and marks fresh bytes', () => {
  const rows = hexRows(new TextEncoder().encode('hello\n'), 14, 18);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.offset, '00000000');
  assert.deepEqual(rows[0]!.bytes.slice(14).map(cell => cell.hex), ['68', '65']);
  assert.equal(rows[0]!.ascii.slice(14), 'he');
  assert.deepEqual(rows[1]!.bytes.slice(0, 4).map(cell => [cell.hex, cell.fresh]), [['6c', false], ['6c', false], ['6f', true], ['0a', true]]);
  assert.equal(rows[1]!.ascii.slice(0, 4), 'llo.');
});

test('rewriteImports maps package imports to bundled modules and rejects others', () => {
  const allowed = ['defuss-storage', 'defuss-storage/opfs'];
  assert.equal(rewriteImports("import { a, b as c } from 'defuss-storage/opfs';", allowed), 'const { a, b: c } = __modules["defuss-storage/opfs"];');
  assert.equal(rewriteImports('import * as core from "defuss-storage"', allowed), 'const core = __modules["defuss-storage"];');
  assert.throws(() => rewriteImports("import fs from 'node:fs';", allowed), /not 'node:fs'/);
  assert.throws(() => rewriteImports("import storage from 'defuss-storage';", allowed), /named imports/);
});

test('explorer options and notes follow the recorded reports', () => {
  const node = data.environments.find(environment => environment.id === 'node')!;
  assert.equal(rowsFor(node, 'file', '0.2.0').length, 3);
  const option = explorerOption(node, 'file', 'pipelined', text, '#000') as { series: { id: string; data: unknown[] }[] };
  assert.deepEqual(option.series.map(series => series.id), ['v0.1.0', 'v0.1.0-range', 'v0.2.0', 'v0.2.0-range']);
  const current = rowsFor(node, 'file', '0.2.0')[0]!.pipelined.median;
  assert.equal(option.series[2]!.data[0], Number(current.toFixed(1)));
  assert.match(explorerNote(node, 'file', 'pipelined', text, format), /^At (4 KiB|64 KiB|1 MiB), 0\.2\.0 reaches/);
  assert.match(explorerNote(node, 'file', 'readInto', text, format), /Lower is better/);
  const options = optionsOption(data, text) as { series: { data: (number | null)[] }[] };
  assert.equal(options.series.length, 5);
  // Browsers have no synchronous I/O option: their bar is empty, not zero.
  assert.equal(options.series[2]!.data[2], null);
});
