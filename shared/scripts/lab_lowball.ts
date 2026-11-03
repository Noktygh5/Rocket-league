// Lab: a ball in the air in front of the boss's goal and moving at it (z 300-600, 700-1500 uu/s), the boss near the goal with 20-80 boost,
// opponent parked far away. Counts goals conceded within 6 s and touches, and prints one trace. Usage: npx tsx scripts/lab_lowball.ts [n=30] [seedBase=1] [v]
import { GameSim, Phase, createBot, defaultConfig, placeCar, ARENA } from '../src';
import { Prng } from '../src/prng';
const n = Number(process.argv[2] ?? 30), seedBase = Number(process.argv[3] ?? 1), L = ARENA.halfLength;
let conceded = 0, touched = 0, shown = 0;
for (let s = 0; s < n; s++) {
  const rng = new Prng(seedBase * 911 + s);
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'boss' }, { team: 1, name: 'idle' }], 40 + s), matchLength: 60, skipReplay: true });
  const boss: any = createBot('ultrahard', sim, 0, 40 + s);
  while (sim.phase !== Phase.Playing) sim.step();
  const k = sim.cars[0];
  placeCar(k, (rng.next() - 0.5) * 2500, -L + 700 + rng.next() * 2200, Math.PI / 2); k.boost = 20 + rng.next() * 60;
  const bx = (rng.next() - 0.5) * 2200, by = -L + 2200 + rng.next() * 1800, bz = 300 + rng.next() * 300;
  const tx = (rng.next() - 0.5) * 1800, ty = -L - 100, dx = tx - bx, dy = ty - by, dl = Math.hypot(dx, dy), sp = 700 + rng.next() * 800;
  sim.ball.pos.x = bx; sim.ball.pos.y = by; sim.ball.pos.z = bz; sim.ball.vel.x = dx / dl * sp; sim.ball.vel.y = dy / dl * sp; sim.ball.vel.z = 0;
  sim.cars[1].pos.x = 3500; sim.cars[1].pos.y = L - 600;
  const s0 = sim.score[1]; let g = false; const tr: string[] = [];
  for (let i = 0; i < 120 * 6; i++) {
    boss.think(); sim.step();
    if (process.argv[4] === 'v' && i % 15 === 0 && i < 120 * 3) tr.push(`${(i / 120).toFixed(2)}s m${boss.debug.mode} thr${boss.threat ? 1 : 0} boss(${k.pos.x | 0},${k.pos.y | 0},z${k.pos.z | 0} b${k.boost | 0}) ball(${sim.ball.pos.x | 0},${sim.ball.pos.y | 0},${sim.ball.pos.z | 0}) jump${sim.inputs[0].jump ? 1 : 0}`);
    if (sim.score[1] > s0) { g = true; break; }
  }
  if (g) conceded++; if (k.lastTouchTick >= 0) touched++;
  if (g && process.argv[4] === 'v' && shown++ < 1) console.log(`conceded #${s}\n  ` + tr.join('\n  '));
}
console.log(`low ball at goal: conceded ${conceded}/${n}, boss touched ${touched}/${n}`);
