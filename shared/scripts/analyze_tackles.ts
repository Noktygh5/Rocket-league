// Tackles: boss touches while the human is on the ball (human within 750 uu of it), per minute of live play, and how many of the human's
// possessions (spells of at least 1 s on the ball) the boss ended with a touch. Usage (from shared/): npx tsx scripts/analyze_tackles.ts <folder> [...]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
for (const dir of process.argv.slice(2)) {
  const rows = readFileSync(join(dir, 'telemetry.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const ticks = rows.filter((r: any) => r.k === 't');
  const live = ticks.filter((r: any) => r.ph === 1).length * 4 / 120;
  const byTick = new Map<number, any>(); for (const t of ticks) byTick.set(t.tick, t);
  const hits = rows.filter((r: any) => r.k === 'e' && r.type === 'ballHit' && r.a === 1);
  let tackles = 0;
  for (const h of hits) { const r = ticks.find((t: any) => t.tick >= h.tick); if (!r || r.ph !== 1) continue; const b = r.ball, hm = r.cars[0]; if (Math.hypot(b[0] - hm.p[0], b[1] - hm.p[1]) < 750) tackles++; }
  // possessions: runs of >= 1 s with the human within 750 of the ball
  let spells = 0, ended = 0, run = 0, runStart = 0;
  const live1 = ticks.filter((r: any) => r.ph === 1);
  for (let i = 0; i < live1.length; i++) {
    const r = live1[i]; const d = Math.hypot(r.ball[0] - r.cars[0].p[0], r.ball[1] - r.cars[0].p[1]);
    if (d < 750) { if (run === 0) runStart = r.tick; run++; } else { if (run * 4 / 120 >= 1) { spells++; if (hits.some((h: any) => h.tick >= runStart && h.tick <= r.tick + 30)) ended++; } run = 0; }
  }
  console.log(`${dir.split('/').pop()!.slice(0, 19)}: boss tackles (touches with the human on the ball) ${tackles} = ${(tackles / (live / 60)).toFixed(1)}/min; human possessions of 1 s+: ${spells}, ended by a boss touch: ${ended} (${(100 * ended / Math.max(1, spells)).toFixed(0)}%)`);
}
