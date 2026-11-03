// Lab: a carry up the pitch, recreated from a recorded match. The human (a script) carries the ball from the far wall of the boss's attacking half
// toward the boss's goal at 1,300-1,700 uu/s while the boss starts on the other side of the pitch with some boost. Counts goals conceded within
// 14 s, when the boss first touches the ball, and how often it touches the ball before the carrier is within 2,500 uu of the boss's goal.
// Usage: npx tsx scripts/lab_carry.ts [n=24] [seedBase=1] [v]
import { GameSim, Phase, createBot, defaultConfig, placeCar, ARENA } from '../src';
import { Prng } from '../src/prng';
const n = Number(process.argv[2] ?? 24), seedBase = Number(process.argv[3] ?? 1), L = ARENA.halfLength;
let conceded = 0, early = 0, firstSum = 0, firstN = 0, shown = 0;
for (let s = 0; s < n; s++) {
  const rng = new Prng(seedBase * 733 + s);
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'human' }, { team: 1, name: 'boss' }], 500 + s), matchLength: 60, skipReplay: true });
  const boss: any = createBot('ultrahard', sim, 1, 500 + s);
  while (sim.phase !== Phase.Playing) sim.step();
  const side = rng.next() < 0.5 ? -1 : 1, h = sim.cars[0], k = sim.cars[1];
  const bx = side * (3200 + rng.next() * 1200), by = -3800 - rng.next() * 1200;
  sim.ball.pos.x = bx; sim.ball.pos.y = by; sim.ball.pos.z = 92; sim.ball.vel.x = 0; sim.ball.vel.y = 400; sim.ball.vel.z = 0;
  placeCar(h, bx, by - 300, Math.PI / 2); h.vel.y = 900; h.boost = 0;
  placeCar(k, -side * (2500 + rng.next() * 1500), -2500 + rng.next() * 2500, -Math.PI / 2); k.boost = 20 + rng.next() * 50;
  const s0 = sim.score[0]; let firstT = -1, lastTouch = -1, earlyT = false, g = false; const tr: string[] = [];
  for (let t = 0; t < 120 * 14; t++) {
    boss.think();
    // the carrier: get behind the ball on the line to the boss's goal and push it along at about 1500
    const inp = sim.inputs[0]; inp.clear();
    const b = sim.ball, m = h.basis.m;
    let ux = 0 - b.pos.x, uy = L - b.pos.y; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const tx = b.pos.x - ux * 170, ty = b.pos.y - uy * 170;
    const dx = tx - h.pos.x, dy = ty - h.pos.y;
    const ang = Math.atan2(dx * m[1] + dy * m[4], dx * m[0] + dy * m[3]);
    inp.steer = Math.max(-1, Math.min(1, -ang * 2.5));
    const fwd = h.vel.x * m[0] + h.vel.y * m[3], d = Math.hypot(dx, dy);
    inp.throttle = fwd < (d < 500 ? 1450 : 1900) ? 1 : 0;
    sim.step();
    if (k.lastTouchTick !== lastTouch && k.lastTouchTick >= 0) { lastTouch = k.lastTouchTick; if (firstT < 0) firstT = t / 120; if (Math.hypot(b.pos.x, b.pos.y - L) > 2500) earlyT = true; }
    if (process.argv[4] === 'v' && t % 120 === 0) tr.push(`${t / 120}s m${boss.debug.mode} boss(${k.pos.x | 0},${k.pos.y | 0} b${k.boost | 0} v${Math.hypot(k.vel.x, k.vel.y) | 0}) tgt(${boss.plan.tx | 0},${boss.plan.ty | 0} k${boss.plan.kind}) human(${h.pos.x | 0},${h.pos.y | 0}) ball(${b.pos.x | 0},${b.pos.y | 0} v${Math.hypot(b.vel.x, b.vel.y) | 0})`);
    if (sim.score[0] > s0) { g = true; break; }
  }
  if (g) conceded++; if (earlyT) early++; if (firstT >= 0) { firstSum += firstT; firstN++; }
  if (process.argv[4] === 'v' && shown++ < 1) console.log(`#${s}\n  ` + tr.join('\n  '));
}
console.log(`carry: conceded ${conceded}/${n}, boss touched the ball before the carrier was near its goal ${early}/${n}, first touch at ${(firstSum / Math.max(1, firstN)).toFixed(1)} s (${firstN}/${n} touched it)`);
