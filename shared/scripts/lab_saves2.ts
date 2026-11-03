// Lab: saves when the keeper is NOT waiting in goal. A shooter hits the ball at the boss's goal from 1500-5000 uu out while the boss
// starts anywhere on the pitch (drive speed, 10-60 boost). Counts goals conceded and touches. The shooter is parked far away; the ball is struck at t=0.
// Usage: npx tsx scripts/lab_saves2.ts [bot=current|v2|hard] [shots=60] [seedBase=1] [v]
import { GameSim, Phase, createBot, defaultConfig, placeCar, ARENA } from '../src';
import { Prng } from '../src/prng';
import { BossV2 } from './boss_v2';
const which = process.argv[2] ?? 'current', shots = Number(process.argv[3] ?? 60), seedBase = Number(process.argv[4] ?? 1), L = ARENA.halfLength;
let saved = 0, touched = 0; const byZone = [[0, 0], [0, 0], [0, 0]];
for (let s = 0; s < shots; s++) {
  const rng = new Prng(seedBase * 4099 + s);
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'keeper' }, { team: 1, name: 'shooter' }], 90 + s), matchLength: 120, skipReplay: true });
  const keeper: any = which === 'v2' ? new BossV2(sim, 0) : createBot(which === 'current' ? 'ultrahard' : (which as any), sim, 0, 90 + s);
  while (sim.phase !== Phase.Playing) sim.step();
  const k = sim.cars[0];
  // keeper anywhere: zone 0 = near goal, 1 = midfield, 2 = in their half (the usual case when a human shoots)
  const zone = s % 3;
  const ky = zone === 0 ? -L + 1200 + rng.next() * 1500 : zone === 1 ? -1500 + rng.next() * 3000 : 1500 + rng.next() * 4500;
  placeCar(k, (rng.next() - 0.5) * 5000, ky, rng.next() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
  k.vel.y = (rng.next() - 0.3) * 1400; k.boost = 10 + rng.next() * 50;
  sim.cars[1].pos.x = 3500; sim.cars[1].pos.y = L - 600;
  const sx = (rng.next() - 0.5) * 3500, sy = -L + 3500 + rng.next() * 3500;     // ball struck from 3.5k-7k out of our goal line
  const tx = (rng.next() - 0.5) * 2 * (ARENA.goal.halfWidth - 150), tz = 90 + rng.next() * 380;
  const dx = tx - sx, dy = -L - sy, dz = tz - 100, dl = Math.hypot(dx, dy, dz);
  const sp = 1800 + rng.next() * 1800;
  sim.ball.pos.x = sx; sim.ball.pos.y = sy; sim.ball.pos.z = 100;
  sim.ball.vel.x = dx / dl * sp; sim.ball.vel.y = dy / dl * sp; sim.ball.vel.z = dz / dl * sp;
  const s0 = sim.score[1]; let goal = false; const tr: string[] = [];
  for (let i = 0; i < 120 * 6; i++) {
    keeper.think(); sim.step();
    if (process.argv[5] === 'v' && i % 30 === 0) tr.push(`${(i / 120).toFixed(2)}s m${keeper.debug?.mode} k(${k.pos.x | 0},${k.pos.y | 0},z${k.pos.z | 0} b${k.boost | 0} v${Math.hypot(k.vel.x, k.vel.y) | 0}) ball(${sim.ball.pos.x | 0},${sim.ball.pos.y | 0},${sim.ball.pos.z | 0})`);
    if (sim.score[1] > s0) { goal = true; break; }
  }
  if (k.lastTouchTick >= 0) touched++;
  byZone[zone][1]++; if (!goal) { saved++; byZone[zone][0]++; }
  if (goal && process.argv[5] === 'v') console.log(`GOAL #${s} zone ${zone} shot ${sp | 0} from (${sx | 0},${sy | 0})\n  ` + tr.join('\n  '));
}
console.log(`${which}: saved ${saved}/${shots} (${(100 * saved / shots).toFixed(0)}%), touched ${touched}; by keeper position: near goal ${byZone[0][0]}/${byZone[0][1]}, midfield ${byZone[1][0]}/${byZone[1][1]}, their half ${byZone[2][0]}/${byZone[2][1]}`);
