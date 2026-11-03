// Where does the bot's Pad mode happen? For every recording folder given: the share of live time in Pad mode, split by what the human is doing
// (carrying the ball: within 750 uu of it and moving with it; near it; far from it) and where the ball is (bot's own half / the bot's attacking half).
// Usage: npx tsx scripts/analyze_pads.ts <folder> [<folder> ...]   (bot = index 1)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const bot = 1, hum = 0, att = -1;
const tot: Record<string, number> = {}; let live = 0, padAll = 0;
for (const dir of process.argv.slice(2)) {
  const rows = readFileSync(join(dir, 'telemetry.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  for (const r of rows) {
    if (r.k !== 't' || r.ph !== 1) continue;
    live++;
    if (r.bot?.m !== 3) continue;
    padAll++;
    const b = r.ball, h = r.cars[hum], k = r.cars[bot];
    const dh = Math.hypot(b[0] - h.p[0], b[1] - h.p[1]);
    const rel = Math.hypot(b[3] - h.v[0], b[4] - h.v[1]);
    const who = dh < 750 && rel < 900 ? 'human carrying the ball' : dh < 2000 ? 'human near the ball' : 'human far from the ball';
    const half = b[1] * att < 0 ? "ball in the bot's own half" : "ball in the bot's attacking half";
    const boost = k.b < 10 ? 'bot boost<10' : k.b < 40 ? 'bot boost 10-40' : 'bot boost 40+';
    for (const key of [who, half, boost, `${who} | ${half}`]) tot[key] = (tot[key] ?? 0) + 1;
  }
}
console.log(`live ${(live * 4 / 120).toFixed(0)} s, Pad mode ${(100 * padAll / live).toFixed(1)}% of it. Pad-mode time split:`);
for (const [k, v] of Object.entries(tot).sort((a, b) => b[1] - a[1])) console.log(`  ${(100 * v / padAll).toFixed(0).padStart(3)}% (${(v * 4 / 120).toFixed(0)} s)  ${k}`);
