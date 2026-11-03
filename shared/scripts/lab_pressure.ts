// Lab: defending under pressure. An attacker (Hard bot) is on the ball close to the boss's goal, the boss starts
// somewhere in midfield with little boost. Counts goals conceded in 8 s, how often the boss touched the ball,
// and how often it went for a boost pad while the ball was within 3500 uu of its goal.
// Usage: npx tsx scripts/lab_pressure.ts [bot=current|v2] [n=40] [seedBase=1] [v]
import { GameSim, Phase, createBot, defaultConfig, placeCar, ARENA } from '../src';
import { Prng } from '../src/prng';
import { BossV2 } from './boss_v2';

const which = process.argv[2] ?? 'current';
const n = Number(process.argv[3] ?? 40);
const seedBase = Number(process.argv[4] ?? 1);
const L = ARENA.halfLength;
let conceded = 0, touched = 0, padTicks = 0, closeTicks = 0, cornerTicks = 0, ticksAll = 0, scored = 0;
for (let s = 0; s < n; s++) {
  const rng = new Prng(seedBase * 7919 + s);
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'boss' }, { team: 1, name: 'human' }], 50 + s), matchLength: 120, skipReplay: true });
  const boss: any = which === 'v2' ? new BossV2(sim, 0) : createBot(which === 'current' ? 'ultrahard' : (which as any), sim, 0, 50 + s);
  const atk = createBot('hard', sim, 1, 60 + s);
  while (sim.phase !== Phase.Playing) sim.step();
  const bx = (rng.next() - 0.5) * 3600, by = process.argv[5] === 'far' ? -L + 2800 + rng.next() * 3000 : -L + 1300 + rng.next() * 2200;
  sim.ball.pos.x = bx; sim.ball.pos.y = by; sim.ball.pos.z = 100;
  sim.ball.vel.x = (rng.next() - 0.5) * 200; sim.ball.vel.y = -200 - rng.next() * 500; sim.ball.vel.z = 0;
  // attacker 700-1000 uu behind the ball (further from our goal), already moving at it
  const a = sim.cars[1];
  placeCar(a, bx + (rng.next() - 0.5) * 500, by + 800 + rng.next() * 400, -Math.PI / 2);
  a.vel.y = -900; a.boost = 60;
  const k = sim.cars[0];
  const far = process.argv[5] === 'far';
  if (far) placeCar(k, (rng.next() - 0.5) * 4000, 500 + rng.next() * 4500, -Math.PI / 2); else placeCar(k, (rng.next() - 0.5) * 3600, -L + 800 + rng.next() * 2600, -Math.PI / 2);
  k.boost = 10 + rng.next() * 30;
  const s0 = sim.score[1], s1 = sim.score[0];
  let g = false; const trace: string[] = [];
  for (let i = 0; i < 120 * 8; i++) {
    boss.think(); atk.think(); sim.step();
    ticksAll++;
    if (i % 30 === 0) trace.push(`${(i/120).toFixed(2)}s m${boss.debug.mode} boss(${k.pos.x|0},${k.pos.y|0},z${k.pos.z|0},b${k.boost|0}) ball(${sim.ball.pos.x|0},${sim.ball.pos.y|0},${sim.ball.pos.z|0}) atk(${a.pos.x|0},${a.pos.y|0})`);
    const bp = sim.ball.pos;
    if (bp.y < -L + 3500) {
      closeTicks++;
      if (boss.debug.mode === 3) padTicks++;
      if (Math.abs(bp.x) > 2300 && bp.y < -L + 1800) cornerTicks++;
    }
    if (sim.score[1] > s0) { g = true; break; }
    if (sim.score[0] > s1) { scored++; break; }
  }
  if (g) conceded++;
  if (k.lastTouchTick >= 0) touched++;
  if (g && process.argv[6] === 'v') console.log(`conceded #${s}\n  ` + trace.join('\n  '));
}
console.log(`${which}: conceded ${conceded}/${n}, boss scored ${scored}, touched ${touched}/${n}, pad-mode ${(100 * padTicks / Math.max(1, closeTicks)).toFixed(1)}% of ticks with ball near own goal, corner ${(100 * cornerTicks / Math.max(1, closeTicks)).toFixed(1)}%`);
