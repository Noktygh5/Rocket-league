// Lab: breakaway. The ball is in the boss's attacking half rolling toward the goal, the boss is behind it, and the opponent cannot defend
// (parked far back by its own... the boss's own goal). Counts goals within 15 s, the mean time, the distance from the boss to the ball
// 2 s after its first touch, and how many touches it takes. With `defender` the opponent is a Hard bot 2,500 uu behind the boss instead.
// Usage: npx tsx scripts/lab_breakaway.ts [n=30] [seedBase=1] [parked|defender|keeper] [v]
import { GameSim, Phase, createBot, defaultConfig, placeCar, ARENA } from '../src';
import { Prng } from '../src/prng';
const n = Number(process.argv[2] ?? 30), seedBase = Number(process.argv[3] ?? 1), mode = process.argv[4] ?? 'parked', L = ARENA.halfLength;
let goals = 0, tsum = 0, d2sum = 0, d2n = 0, touchSum = 0, shown = 0;
for (let s = 0; s < n; s++) {
  const rng = new Prng(seedBase * 271 + s);
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'boss' }, { team: 1, name: 'opp' }], 200 + s), matchLength: 60, skipReplay: true });
  const boss: any = createBot('ultrahard', sim, 0, 200 + s);
  const opp: any = mode === 'defender' || mode === 'keeper' ? createBot('hard', sim, 1, 210 + s) : null;
  while (sim.phase !== Phase.Playing) sim.step();
  const bx = (rng.next() - 0.5) * 4000, by = 800 + rng.next() * 2500;
  sim.ball.pos.x = bx; sim.ball.pos.y = by; sim.ball.pos.z = 92;
  sim.ball.vel.x = (rng.next() - 0.5) * 300; sim.ball.vel.y = 300 + rng.next() * 900; sim.ball.vel.z = 0;
  const k = sim.cars[0]; placeCar(k, bx + (rng.next() - 0.5) * 900, by - 900 - rng.next() * 700, Math.PI / 2); k.vel.y = 900; k.boost = 25 + rng.next() * 50;
  const o = sim.cars[1];
  if (mode === 'defender') { placeCar(o, (rng.next() - 0.5) * 2000, by - 3500, Math.PI / 2); o.vel.y = 800; o.boost = 30; }
  else if (mode === 'keeper') { placeCar(o, (rng.next() - 0.5) * 1200, L - 1100 - rng.next() * 900, -Math.PI / 2); o.boost = 40; }
  else { o.pos.x = 3500; o.pos.y = -L + 600; }
  const s0 = sim.score[0]; let g = false, t = 0, firstT = -1, touches = 0, lastTouch = -1, d2 = -1; const tr: string[] = [];
  for (; t < 120 * 15; t++) {
    boss.think(); opp?.think(); sim.step();
    if (k.lastTouchTick !== lastTouch && k.lastTouchTick >= 0) { lastTouch = k.lastTouchTick; touches++; if (firstT < 0) firstT = t; }
    if (firstT >= 0 && d2 < 0 && t - firstT >= 240) d2 = Math.hypot(sim.ball.pos.x - k.pos.x, sim.ball.pos.y - k.pos.y);
    if (process.argv[5] === 'v' && t % 60 === 0) tr.push(`${t / 120}s m${boss.debug.mode} boss(${k.pos.x | 0},${k.pos.y | 0} b${k.boost | 0} v${Math.hypot(k.vel.x, k.vel.y) | 0}) ball(${sim.ball.pos.x | 0},${sim.ball.pos.y | 0},${sim.ball.pos.z | 0} v${Math.hypot(sim.ball.vel.x, sim.ball.vel.y) | 0}) opp(${o.pos.x | 0},${o.pos.y | 0})`);
    if (sim.score[0] > s0) { g = true; break; }
  }
  if (g) { goals++; tsum += t / 120; }
  if (d2 >= 0) { d2sum += d2; d2n++; }
  touchSum += touches;
  if (!g && process.argv[5] === 'v' && shown++ < 2) console.log(`NO GOAL #${s} ball (${bx | 0},${by | 0})\n  ` + tr.join('\n  '));
}
console.log(`breakaway (${mode}): ${goals}/${n} scored within 15 s, mean ${(tsum / Math.max(1, goals)).toFixed(1)} s, boss ${(d2sum / Math.max(1, d2n)).toFixed(0)} uu from the ball 2 s after its first touch, ${(touchSum / n).toFixed(1)} touches`);
