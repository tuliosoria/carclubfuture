/**
 * Minimal CSV parser for clean, comma-delimited data (e.g. Stooq daily OHLCV).
 * No quoted-field support needed — Stooq's format is plain commas.
 */

/**
 * Parse a CSV string into an array of plain objects keyed by the header row.
 * Handles Windows (\r\n) and Unix (\n) line endings. Ignores trailing blank lines.
 *
 * @param {string} text - Raw CSV text
 * @returns {Array<Record<string, string>>}
 */
export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((row) => {
    const cells = row.split(",");
    return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  });
}
