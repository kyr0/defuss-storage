// Pure formatting for the persistence demo's hex view: 16 bytes per row with
// the file offset, hex pairs and printable ASCII, like `xxd`.
// VERIFIED: (test/client.test.ts) alignment, ASCII column and fresh bytes.

export interface HexRow {
  readonly offset: string;
  /** One entry per byte: its hex pair and whether it is new since the last view. */
  readonly bytes: readonly { readonly hex: string; readonly fresh: boolean }[];
  readonly ascii: string;
}

/**
 * Rows for `bytes`, which start at file offset `start`. Bytes at or after
 * `freshFrom` (a file offset) are marked fresh. Rows align to 16-byte file
 * offsets, so the first row may start part-way.
 */
export function hexRows(bytes: Uint8Array, start: number, freshFrom = Number.POSITIVE_INFINITY): HexRow[] {
  const rows: HexRow[] = [];
  const first = start - (start % 16);
  for (let rowStart = first; rowStart < start + bytes.length; rowStart += 16) {
    const cells: { hex: string; fresh: boolean }[] = [];
    let ascii = '';
    for (let offset = rowStart; offset < rowStart + 16; offset++) {
      const index = offset - start;
      if (index < 0 || index >= bytes.length) { cells.push({ hex: '  ', fresh: false }); ascii += ' '; continue; }
      const byte = bytes[index]!;
      cells.push({ hex: byte.toString(16).padStart(2, '0'), fresh: offset >= freshFrom });
      ascii += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.';
    }
    rows.push({ offset: rowStart.toString(16).padStart(8, '0'), bytes: cells, ascii });
  }
  return rows;
}
