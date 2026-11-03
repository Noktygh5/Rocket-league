// Lab: finishing. A still ball in the boss's attacking half, an empty net (the other car parked far away),
// the boss behind the ball. Counts goals within 12 s and the mean time to score. Usage: npx tsx scripts/lab_open.ts [n=30] [seedBase=1] [v]
import { GameSim, Phase, createBot, defaultConfig, placeCar, ARENA } from '../src';
import { Prng } from '../src/prng';
const n = Number(process.argv[2] ?? 30), seedBase = Number(process.argv[3] ?? 1), L = ARENA.halfLength;
let goals = 0, tsum = 0, touches = 0;
for (let s = 0; s < n; s++) {
  const rng = new Prng(seedBase * 31337 + s);
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'boss' }, { team: 1, name: 'idle' }], 70 + s), matchLength: 60, skipReplay: true });
  const boss: any = createBot('ultrahard', sim, 0, 70 + s);
  while (sim.phase !== Phase.Playing) sim.step();
  const bx = (rng.next() - 0.5) * 6000, by = 800 + rng.next() * 4500;   // boss (blue) attacks +y
  sim.ball.pos.x = bx; sim.ball.pos.y = by; sim.ball.pos.z = 92; sim.ball.vel.x = 0; sim.ball.vel.y = 0; sim.ball.vel.z = 0;
  const k = sim.cars[0];
  placeCar(k, bx + (rng.next() - 0.5) * 3000, by - 1500 - rng.next() * 2500, Math.PI / 2);
  k.boost = 20 + rng.next() * 60;
  sim.cars[1].pos.x = -3500; sim.cars[1].pos.y = -6500;   // parked, far from everything
  const s0 = sim.score[0];
  let t = 0, g = false; const trace: string[] = [];
  for (; t < 120 * 12; t++) {
    boss.think(); sim.step();
    if (process.argv[4] === 'v' && t % 60 === 0) trace.push(`${t / 120}s m${boss.debug.mode} boss(${k.pos.x | 0},${k.pos.y | 0} z${k.pos.z | 0} b${k.boost | 0} v${Math.hypot(k.vel.x, k.vel.y) | 0}) ball(${sim.ball.pos.x | 0},${sim.ball.pos.y | 0},${sim.ball.pos.z | 0} v${Math.hypot(sim.ball.vel.x, sim.ball.vel.y) | 0})`);
    if (sim.score[0] > s0) { g = true; break; }
  }
  if (g) { goals++; tsum += t / 120; }
  if (k.lastTouchTick >= 0) touches++;
  if (!g && process.argv[4] === 'v') console.log(`NO GOAL #${s} ball start (${bx | 0},${by | 0})\n  ` + trace.join('\n  '));
}
console.log(`open-net finishing: ${goals}/${n} scored within 12 s, mean time ${(tsum / Math.max(1, goals)).toFixed(1)} s, touched ${touches}/${n}`);
