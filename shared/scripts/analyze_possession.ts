// What does the boss do while the HUMAN has the ball (human within 750 uu of it)? Per recording: the share of live time the human has the ball, and during
// it the boss's distance to the ball (mean and median), how often the boss is within 1000 uu, its plan modes, its boost, and how often it is closing in
// (distance to the ball shrinking by more than 300 uu/s) versus standing off. Usage (from shared/): npx tsx scripts/analyze_possession.ts <folder> [...]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const names = ['Drive', 'Strike', 'Aerial', 'Pad', 'Shadow'];
for (const dir of process.argv.slice(2)) {
  const rows = readFileSync(join(dir, 'telemetry.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).filter((r: any) => r.k === 't' && r.ph === 1);
  const ds: number[] = []; const modes: Record<string, number> = {}; let hold = 0, near = 0, closing = 0, standoff = 0, boostSum = 0, n = 0, slowAway = 0;
  let prevD = -1;
  for (const r of rows) {
    const b = r.ball, h = r.cars[0], k = r.cars[1];
    const dh = Math.hypot(b[0] - h.p[0], b[1] - h.p[1]);
    const dk = Math.hypot(b[0] - k.p[0], b[1] - k.p[1]);
    if (dh < 750) {
      hold++; ds.push(dk); n++; boostSum += k.b;
      const m = names[r.bot?.m ?? 0]; modes[m] = (modes[m] ?? 0) + 1;
      if (dk < 1000) near++;
      if (prevD >= 0) { const rate = (prevD - dk) / (4 / 120); if (rate > 300) closing++; else if (rate < 100) standoff++; if (dk > 1500 && Math.hypot(k.v[0], k.v[1]) < 900) slowAway++; }
    }
    prevD = dh < 750 ? dk : -1;
  }
  ds.sort((a, b) => a - b);
  const pct = (x: number) => (100 * x / Math.max(1, n)).toFixed(0) + '%';
  console.log(`${dir.split('/').pop()!.slice(0, 19)}: human has the ball ${(100 * hold / rows.length).toFixed(0)}% of live play | boss then: median ${ds.length ? ds[Math.floor(ds.length / 2)] | 0 : 0} uu from the ball, within 1000 uu ${pct(near)}, closing in ${pct(closing)}, standing off ${pct(standoff)}, slow and away ${pct(slowAway)}, boost ${(boostSum / Math.max(1, n)).toFixed(0)} | modes ${Object.entries(modes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}`);
}
