// How much time does the bot spend on a wall or the ceiling (on the ground but above 350 uu), and how much of it with the human attacking?
// Usage: npx tsx scripts/analyze_walls.ts <folder> [<folder> ...]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
for (const dir of process.argv.slice(2)) {
  const rows = readFileSync(join(dir, 'telemetry.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).filter((r) => r.k === 't' && r.ph === 1);
  let wall = 0, wallHighest = 0, run = 0, longest = 0, ownEndWall = 0; const att = -1;
  for (const r of rows) {
    const c = r.cars[1];
    const onWall = c.g && c.p[2] > 350;
    if (onWall) { wall++; run++; longest = Math.max(longest, run); wallHighest = Math.max(wallHighest, c.p[2]); if (c.p[1] * att < -5000) ownEndWall++; } else run = 0;
  }
  console.log(`${dir.split('/').pop()}: on a wall above 350 uu ${(100 * wall / rows.length).toFixed(1)}% of live play (${(wall * 4 / 120).toFixed(0)} s), longest ${(longest * 4 / 120).toFixed(1)} s, highest ${wallHighest | 0} uu, ${(ownEndWall * 4 / 120).toFixed(0)} s of it at the bot's own end`);
}
