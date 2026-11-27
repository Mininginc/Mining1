import { parse } from 'csv-parse/sync';

/** Parses CSV text into rows of strings. Handles a UTF-8 byte-order mark, quotes and ragged rows. */
export function readCsv(text: string): string[][] {
  return parse(text, { bom: true, relax_column_count: true, skip_empty_lines: false }) as string[][];
}
