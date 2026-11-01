export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

/**
 * Piecewise-linear lookup. `table` is a flat array [x0, y0, x1, y1, ...] with ascending x.
 * Inputs outside the range clamp to the end values.
 */
export function curve(table: readonly number[], x: number): number {
  const n = table.length;
  if (x <= table[0]) return table[1];
  if (x >= table[n - 2]) return table[n - 1];
  for (let i = 2; i < n; i += 2) {
    if (x <= table[i]) {
      const x0 = table[i - 2], y0 = table[i - 1];
      return y0 + ((x - x0) / (table[i] - x0)) * (table[i + 1] - y0);
    }
  }
  return table[n - 1];
}
