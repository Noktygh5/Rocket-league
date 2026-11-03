// Lab: ball awareness. A "human" dribbles the ball side to side across the boss's half (waypoints at x = +-3000, y = -1800) at a
// modest speed, no boost. Measures, over 15 s: when the boss first touches the ball, how many times it touches it, how often it is
// within 1200 uu of the ball, how many goals it concedes, and how many touches the dribbler gets.
// Usage: npx tsx scripts/lab_dribble.ts [bot=current|v2] [n=12] [seedBase=1] [v]
import { GameSim, Phase, createBot, defaultConfig, placeCar, ARENA } from '../src';
import { Prng } from '../src/prng';
import { BossV2 } from './boss_v2';
const which = process.argv[2] ?? 'current', n = Number(process.argv[3] ?? 12), seedBase = Number(process.argv[4] ?? 1), L = ARENA.halfLength;
let firstSum = 0, firstN = 0, bossTouches = 0, humanTouches = 0, nearTicks = 0, ticksAll = 0, conceded = 0;
for (let s = 0; s < n; s++) {
  const rng = new Prng(seedBase * 6151 + s);
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'boss' }, { team: 1, name: 'human' }], 120 + s), matchLength: 120, skipReplay: true });
  const boss: any = which === 'v2' ? new BossV2(sim, 0) : createBot('ultrahard', sim, 0, 120 + s);
  while (sim.phase !== Phase.Playing) sim.step();
  const k = sim.cars[0], h = sim.cars[1];
  let side = rng.next() < 0.5 ? -1 : 1;
  const sy0 = Number(process.argv[6] ?? -1800);
  sim.ball.pos.x = -side * 2200; sim.ball.pos.y = sy0; sim.ball.pos.z = 92; sim.ball.vel.x = 0; sim.ball.vel.y = 0; sim.ball.vel.z = 0;
  placeCar(h, -side * 2800, sy0, side > 0 ? 0 : Math.PI);   // behind the ball, facing the way it will be pushed
  h.vel.x = side * 400; h.boost = 0;
  placeCar(k, (rng.next() - 0.5) * 3000, -4800 - rng.next() * 1500, Math.PI / 2); k.boost = 30 + rng.next() * 40;
  const s0 = sim.score[1];
  let firstT = -1, bt = 0, ht = 0, lastB = -1, lastH = -1; const tr: string[] = [];
  for (let t = 0; t < 120 * 15; t++) {
    boss.think();
    // the dribbler: push the ball toward the current waypoint, getting behind it first
    const inp = sim.inputs[1]; inp.clear();
    const b = sim.ball, m = h.basis.m;
    const wx = side * 3000, wy = sy0;
    if (Math.abs(b.pos.x - wx) < 700) side = -side;
    let ux = wx - b.pos.x, uy = wy - b.pos.y; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const tx = b.pos.x - ux * 150, ty = b.pos.y - uy * 150;
    const dx = tx - h.pos.x, dy = ty - h.pos.y;
    const ang = Math.atan2(dx * m[1] + dy * m[4], dx * m[0] + dy * m[3]);
    inp.steer = Math.max(-1, Math.min(1, -ang * 2.5));
    const fwd = h.vel.x * m[0] + h.vel.y * m[3];
    const bd = Math.hypot(dx, dy); inp.throttle = fwd < (bd < 500 ? 620 : 1000) ? 0.7 : 0.0;
    sim.step();
    ticksAll++;
    if (Math.hypot(b.pos.x - k.pos.x, b.pos.y - k.pos.y) < 1200) nearTicks++;
    if (k.lastTouchTick !== lastB && k.lastTouchTick >= 0) { lastB = k.lastTouchTick; bt++; if (firstT < 0) firstT = t / 120; }
    if (h.lastTouchTick !== lastH && h.lastTouchTick >= 0) { lastH = h.lastTouchTick; ht++; }
    if (process.argv[5] === 'v' && t % 120 === 0) tr.push(`${t / 120}s m${boss.debug?.mode} boss(${k.pos.x | 0},${k.pos.y | 0} b${k.boost | 0} v${Math.hypot(k.vel.x, k.vel.y) | 0}) ball(${b.pos.x | 0},${b.pos.y | 0} v${Math.hypot(b.vel.x, b.vel.y) | 0}) human(${h.pos.x | 0},${h.pos.y | 0})`);
    if (sim.score[1] > s0) { conceded++; break; }
  }
  if (firstT >= 0) { firstSum += firstT; firstN++; }
  bossTouches += bt; humanTouches += ht;
  if (process.argv[5] === 'v' && s < 2) console.log(`#${s}\n  ` + tr.join('\n  '));
}
console.log(`${which} vs dribbler: boss first touch ${(firstSum / Math.max(1, firstN)).toFixed(1)} s (${firstN}/${n} got one), boss touches/15s ${(bossTouches / n).toFixed(1)}, dribbler touches ${(humanTouches / n).toFixed(1)}, near ball (<1200) ${(100 * nearTicks / ticksAll).toFixed(0)}% of the time, conceded ${conceded}/${n}`);
