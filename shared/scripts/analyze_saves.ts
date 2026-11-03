// Saving, measured from recordings. Every human touch that sends the ball at the boss's goal (on target by a straight-line + gravity estimate)
// is a shot; the outcome is a GOAL, a SAVE (the boss touched the ball before it crossed the line) or MISSED (neither). For each: how far the
// boss was from where the ball would cross, how long the ball needed, the boss's boost and plan mode at the moment of the shot.
// Usage: npx tsx scripts/analyze_saves.ts <folder> [<folder> ...]   (bot = index 1, defends +Y)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const L = 7680, GH = 893, GZ = 643;
const names = ['Drive', 'Strike', 'Aerial', 'Pad', 'Shadow'];
let all = 0, goals = 0, saves = 0, missed = 0; const lines: string[] = [];
for (const dir of process.argv.slice(2)) {
  const rows: any[] = readFileSync(join(dir, 'telemetry.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const ticks = rows.filter((r) => r.k === 't'), ev = rows.filter((r) => r.k === 'e');
  const goalsH = ev.filter((e) => e.type === 'goal' && e.a === 0), hitsB = ev.filter((e) => e.type === 'ballHit' && e.a === 1);
  const byTick = new Map<number, any>(); for (const t of ticks) byTick.set(t.tick, t);
  let lastShot = -999;
  for (const h of ev.filter((e) => e.type === 'ballHit' && e.a === 0)) {
    const r = ticks.find((t) => t.tick >= h.tick && t.ph === 1); if (!r) continue;
    const [x, y, z, vx, vy, vz] = r.ball;
    if (vy < 800 || y > L) continue;
    const t = (L - y) / vy; if (t > 2.6) continue;                  // a shot: it reaches the line within 2.6 s (longer is a carry or a pass)
    const grounded = z < 150 && Math.abs(vz) < 250;
    const xa = x + vx * t, za = grounded ? 91 : Math.max(91, z + vz * t - 0.5 * 650 * t * t);
    if (Math.abs(xa) > GH + 120 || za > GZ + 100) continue;       // not on target
    if (h.tick - lastShot < 120) continue; lastShot = h.tick;
    const tEnd = h.tick + Math.round((t + 0.8) * 120);
    const scored = goalsH.find((g) => g.tick >= h.tick && g.tick <= tEnd + 120);
    const saved = hitsB.find((b) => b.tick > h.tick && b.tick <= tEnd);
    const out = scored ? 'GOAL' : saved ? 'SAVE' : 'MISSED';
    all++; if (out === 'GOAL') goals++; else if (out === 'SAVE') saves++; else missed++;
    const bot = r.cars[1], d = Math.hypot(bot.p[0] - xa, bot.p[1] - L);
    lines.push(`  ${dir.slice(-25, -10)} ${(h.tick / 120).toFixed(1)}s ${out.padEnd(6)} shot ${Math.hypot(vx, vy) | 0} uu/s from y=${y | 0}, crosses x=${xa | 0} z=${za | 0} in ${t.toFixed(2)} s | boss ${d | 0} uu from that point (needs ${(d / 1409).toFixed(1)} s unboosted), boost ${bot.b | 0}, ${names[r.bot.m]}${bot.g ? '' : ' (airborne)'}`);
  }
}
console.log(`shots on target at the boss's goal: ${all}  ->  goals ${goals}, saves ${saves}, missed (off target in the end / no touch needed) ${missed}`);
console.log(lines.join('\n'));
