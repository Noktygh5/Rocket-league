// Lab: fastest scripted kickoff run to the ball. Boost straight at it and front-flip at a chosen distance;
// prints the time of first touch for each flip distance. Usage: npx tsx scripts/lab_kickrace.ts
import { CarInput, GameSim, Phase, PHYSICS, defaultConfig } from '../src';

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

function run(flipDist: number, diag: number, boostAfter: boolean): number {
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'a' }, { team: 1, name: 'b' }], 5), skipReplay: true });
  while (sim.phase !== Phase.Playing) sim.step();
  const car = sim.cars[0];
  let t = 0, jumpedAt = -1, flipped = false;
  while (t < 6) {
    const out: CarInput = sim.inputs[0];
    out.clear();
    const m = car.basis.m;
    const bx = sim.ball.pos.x - car.pos.x, by = sim.ball.pos.y - car.pos.y;
    const dist = Math.hypot(bx, by);
    if (car.lastTouchTick >= 0) return t;
    const ang = Math.atan2(bx * m[1] + by * m[4], bx * m[0] + by * m[3]);
    out.throttle = 1;
    if (car.onGround) {
      out.steer = clamp(-ang * 3, -1, 1);
      out.boost = car.boost > 0 && Math.abs(ang) < 0.3;
    }
    if (flipDist > 0 && jumpedAt < 0 && dist < flipDist && car.onGround) { jumpedAt = t; out.jump = true; }
    else if (jumpedAt >= 0 && !flipped) {
      if (t - jumpedAt < 0.05) out.jump = true;
      else if (t - jumpedAt >= 0.11) { flipped = true; out.jump = true; out.pitch = 1; out.yaw = diag; out.steer = diag; }
      out.boost = boostAfter && car.boost > 0;
    } else if (flipped) out.boost = boostAfter && car.boost > 0;
    sim.step();
    t += PHYSICS.dt;
  }
  return -1;
}

console.log(`no flip: touch at ${run(0, 0, true).toFixed(3)} s`);
for (const d of [300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1500]) {
  const a = run(d, 0, true), b = run(d, 0, false), c = run(d, 0.5, true);
  console.log(`flip at ${String(d).padStart(4)} uu: front+boost ${a.toFixed(3)} s | front no boost ${b.toFixed(3)} s | slight diagonal ${c.toFixed(3)} s`);
}
