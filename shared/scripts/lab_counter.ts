// Lab: counter-attack. The boss has been attacking (it starts in the opponent's half); the opponent (Hard bot) wins the ball near midfield
// in the boss's half and runs at the boss's goal. Counts goals conceded within 10 s, boss touches, and how long the boss takes to get goal-side of the ball.
// Usage: npx tsx scripts/lab_counter.ts [bot=current|v2|hard] [n=40] [seedBase=1] [v]
import { GameSim, Phase, createBot, defaultConfig, placeCar, ARENA } from '../src';
import { Prng } from '../src/prng';
import { BossV2 } from './boss_v2';
const which = process.argv[2] ?? 'current', n = Number(process.argv[3] ?? 40), seedBase = Number(process.argv[4] ?? 1), L = ARENA.halfLength;
let conceded = 0, touched = 0, backSum = 0, backN = 0;
for (let s = 0; s < n; s++) {
  const rng = new Prng(seedBase * 7919 + s);
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'boss' }, { team: 1, name: 'human' }], 150 + s), matchLength: 120, skipReplay: true });
  const boss: any = which === 'v2' ? new BossV2(sim, 0) : createBot(which === 'current' ? 'ultrahard' : (which as any), sim, 0, 150 + s);
  const atk = createBot('hard', sim, 1, 160 + s);
  while (sim.phase !== Phase.Playing) sim.step();
  const bx = (rng.next() - 0.5) * 3600, by = -3200 + rng.next() * 2600;           // ball in the boss's half, near midfield
  sim.ball.pos.x = bx; sim.ball.pos.y = by; sim.ball.pos.z = 100; sim.ball.vel.x = (rng.next() - 0.5) * 300; sim.ball.vel.y = -300 - rng.next() * 500; sim.ball.vel.z = 0;
  const a = sim.cars[1]; placeCar(a, bx + (rng.next() - 0.5) * 400, by + 500 + rng.next() * 300, -Math.PI / 2); a.vel.y = -1000; a.boost = 60;
  const k = sim.cars[0]; placeCar(k, (rng.next() - 0.5) * 4000, 800 + rng.next() * 3800, -Math.PI / 2); k.vel.y = -600; k.boost = 10 + rng.next() * 40;
  const s0 = sim.score[1]; let g = false, back = -1; const tr: string[] = [];
  for (let i = 0; i < 120 * 10; i++) {
    boss.think(); atk.think(); sim.step();
    if (back < 0 && k.pos.y < sim.ball.pos.y) back = i / 120;
    if (process.argv[5] === 'v' && i % 60 === 0) tr.push(`${i / 120}s m${boss.debug?.mode} boss(${k.pos.x | 0},${k.pos.y | 0} b${k.boost | 0} v${Math.hypot(k.vel.x, k.vel.y) | 0}) ball(${sim.ball.pos.x | 0},${sim.ball.pos.y | 0} v${Math.hypot(sim.ball.vel.x, sim.ball.vel.y) | 0})`);
    if (sim.score[1] > s0) { g = true; break; }
  }
  if (g) conceded++; if (k.lastTouchTick >= 0) touched++; if (back >= 0) { backSum += back; backN++; }
  if (g && process.argv[5] === 'v' && conceded <= 2) console.log(`conceded #${s}\n  ` + tr.join('\n  '));
}
console.log(`${which} counter-attack: conceded ${conceded}/${n}, boss touched ${touched}/${n}, goal-side of the ball after ${(backSum / Math.max(1, backN)).toFixed(1)} s (${backN}/${n})`);
