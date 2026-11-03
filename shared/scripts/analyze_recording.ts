// Analyse a recorded vs-Bot match (Recordings/<id>/telemetry.ndjson, see client/src/recorder.ts). Prints what the bot did: score and goals,
// touches, jump presses with no touch, plan modes, boost and pad use, time spent in one place, and the last seconds before each goal it conceded.
// Usage: npx tsx scripts/analyze_recording.ts <path to the recording folder> [botIndex=1]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2]; if (!dir) { console.error('usage: analyze_recording.ts <folder> [botIndex]'); process.exit(1); }
const bot = Number(process.argv[3] ?? 1), hum = 1 - bot;
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const rows: any[] = readFileSync(join(dir, 'telemetry.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const ticks = rows.filter((r) => r.k === 't'), events = rows.filter((r) => r.k === 'e');
const play = ticks.filter((r) => r.ph === 1);
const att = bot === 0 ? 1 : -1;                       // blue (index 0) attacks +y
const L = meta.arena.halfLengthY, dt = 4 / 120;
const secs = play.length * dt;
const f1 = (x: number) => x.toFixed(1);
console.log(`boss version: ${meta.botVersion ?? 'not recorded (a game from before version stamps: probably an older boss, reload the page after code changes)'}`);
console.log(`${meta.id}: ${meta.players.map((p: any) => p.name).join(' vs ')}, ${f1(secs)} s of live play, final score ${JSON.stringify(ticks[ticks.length - 1]?.sc)} (blue-orange)`);
const goals = events.filter((e) => e.type === 'goal');
console.log(`goals: ${goals.map((g) => `${f1(g.tick / 120)}s ${g.a === bot ? 'BOT' : 'HUMAN'}`).join(', ') || 'none'}`);
const hits = events.filter((e) => e.type === 'ballHit');
const hb = hits.filter((e) => e.a === bot), hh = hits.filter((e) => e.a === hum);
console.log(`touches: bot ${hb.length} (${f1(hb.length / (secs / 60))}/min), human ${hh.length} (${f1(hh.length / (secs / 60))}/min)`);
// jumps
let presses = 0, aimless = 0, prev = false; const pend: number[] = []; let lastHit = -1;
const hitTicks = hb.map((e) => e.tick);
for (const r of ticks) {
  if (r.ph !== 1) { pend.length = 0; prev = false; continue; }
  const j = !!r.cars[bot].in[5];
  if (j && !prev) { presses++; pend.push(r.tick); }
  prev = j;
  while (pend.length && r.tick - pend[0] > 264) { const t0 = pend.shift()!; if (!hitTicks.some((h) => h >= t0 && h <= t0 + 264)) aimless++; }
}
console.log(`bot jump presses ${presses} (${f1(presses / (secs / 60))}/min), ${aimless} with no bot touch within 2.2 s (${f1(100 * aimless / Math.max(1, presses))}%)`);
// modes and boost
const names = ['Drive', 'Strike', 'Aerial', 'Pad', 'Shadow'];
const modeT: Record<string, number> = {}; let zero = 0, bsum = 0, zonePad = 0, zoneT = 0;
for (const r of play) {
  const m = names[r.bot?.m ?? 0] ?? '?'; modeT[m] = (modeT[m] ?? 0) + 1;
  const c = r.cars[bot]; bsum += c.b; if (c.b < 1) zero++;
  const by = r.ball[1] * att; if (by > L - 4800 || by < -L + 4200) { zoneT++; if (m === 'Pad') zonePad++; }
}
console.log(`bot plan modes: ${Object.entries(modeT).map(([k, v]) => `${k} ${f1(100 * v / play.length)}%`).join(', ')}; boost avg ${f1(bsum / play.length)}, at zero ${f1(100 * zero / play.length)}%, pad pickups ${events.filter((e) => e.type === 'pad' && e.a === bot).length} (human ${events.filter((e) => e.type === 'pad' && e.a === hum).length}); in Pad mode ${f1(100 * zonePad / Math.max(1, zoneT))}% of the time the ball is in a goal zone`);
// time near the ball, own half, dwell
let near = 0, dwell = 0, behindBall = 0, ownHalf = 0;
for (const r of play) {
  const c = r.cars[bot], b = r.ball;
  const d = Math.hypot(b[0] - c.p[0], b[1] - c.p[1]); if (d < 1500) near++;
  if (Math.hypot(c.v[0], c.v[1]) < 250 && d > 1500) dwell++;
  if (c.p[1] * att < 0) ownHalf++;
}
console.log(`bot within 1500 uu of the ball ${f1(100 * near / play.length)}% of the time, dwelling (slow and away from the ball) ${f1(100 * dwell / play.length)}%, in its own half ${f1(100 * ownHalf / play.length)}%`);
// goals conceded: the lead-up (9 s, a line per second, touches marked)
const winS = Number(process.env.WINDOW ?? 9);
for (const g of goals.filter((g) => g.a !== bot)) {
  console.log(`\nBOT CONCEDED at ${f1(g.tick / 120)}s: the ${winS} s before (bot | human | ball); T = a touch in that second (b bot, h human)`);
  const w = ticks.filter((r) => r.tick <= g.tick && r.tick > g.tick - winS * 120 && r.ph === 1).filter((_, i) => i % 8 === 0);
  for (const r of w) {
    const tag = hits.filter((e) => e.tick > r.tick - 32 && e.tick <= r.tick).map((e) => (e.a === bot ? 'Tb' : 'Th')).join('');
    const c = r.cars[bot], h = r.cars[hum], b = r.ball;
    console.log(`  ${f1(r.tick / 120)}s ${names[r.bot.m].padEnd(6)} bot(${c.p[0] | 0},${c.p[1] | 0},z${c.p[2] | 0} b${c.b | 0} v${Math.hypot(c.v[0], c.v[1]) | 0}${c.in[5] ? ' JUMP' : ''}) human(${h.p[0] | 0},${h.p[1] | 0} v${Math.hypot(h.v[0], h.v[1]) | 0}) ball(${b[0] | 0},${b[1] | 0},${b[2] | 0} v${Math.hypot(b[3], b[4]) | 0}) ${tag}`);
  }
}
