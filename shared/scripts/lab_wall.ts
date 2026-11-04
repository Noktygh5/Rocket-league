// Lab: getting down from a wall. The boss starts on the floor beside a side wall facing it, is driven up the wall by script (real physics) until it is
// above 700 uu on the wall, then plays on its own for 8 s with the ball on the floor in midfield and a parked opponent. Reports how long it takes to be back
// on the floor (below 120 uu), how often it ever gets down, and how long it takes to touch the ball. Usage: npx tsx scripts/lab_wall.ts [n=20]
import { GameSim, Phase, createBot, defaultConfig, placeCar } from '../src';
import { Prng } from '../src/prng';
const n = Number(process.argv[2] ?? 20);
let tried = 0, down = 0, downSum = 0, touchN = 0, touchSum = 0, stuck = 0;
for (let s = 0; s < n; s++) {
  const rng = new Prng(31 * s + 7);
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'human' }, { team: 1, name: 'boss' }], 300 + s), matchLength: 60, skipReplay: true });
  const boss: any = createBot('ultrahard', sim, 1, 300 + s);
  while (sim.phase !== Phase.Playing) sim.step();
  const side = s % 2 ? 1 : -1, k = sim.cars[1];
  placeCar(k, side * 5000, -2000 + rng.next() * 4000, side > 0 ? 0 : Math.PI); k.vel.x = side * 1800; k.boost = 100;
  sim.cars[0].pos.x = -side * 3000; sim.cars[0].pos.y = -7000;
  sim.ball.pos.x = -side * 1500 + (rng.next() - 0.5) * 2000; sim.ball.pos.y = (rng.next() - 0.5) * 3000; sim.ball.pos.z = 92; sim.ball.vel.x = 0; sim.ball.vel.y = 0; sim.ball.vel.z = 0;
  let up = false;
  for (let t = 0; t < 600 && !up; t++) {                          // drive up the wall: full throttle and boost straight into it
    const inp = sim.inputs[1]; inp.clear(); inp.throttle = 1; inp.boost = true; sim.step();
    if (k.onGround && k.pos.z > 700 && Math.abs(k.surfaceNormal.z) < 0.4) up = true;
  }
  if (!up) continue;
  tried++;
  let floorT = -1, touchT = -1; const t0 = k.lastTouchTick;
  for (let t = 0; t < 120 * 8; t++) {
    boss.think(); sim.step();
    if (floorT < 0 && k.onGround && k.pos.z < 120) floorT = t / 120;
    if (touchT < 0 && k.lastTouchTick !== t0 && k.lastTouchTick >= 0) touchT = t / 120;
  }
  if (floorT >= 0) { down++; downSum += floorT; } else stuck++;
  if (touchT >= 0) { touchN++; touchSum += touchT; }
}
console.log(`wall start: reached the wall ${tried}/${n}; back on the floor within 8 s ${down}/${tried} (mean ${(downSum / Math.max(1, down)).toFixed(1)} s), still up there ${stuck}; touched the ball ${touchN}/${tried} (mean ${(touchSum / Math.max(1, touchN)).toFixed(1)} s)`);
