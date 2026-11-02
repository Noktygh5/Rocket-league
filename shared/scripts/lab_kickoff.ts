// Lab: which kickoff technique reaches the ball fastest in this physics?
// Usage: npx tsx scripts/lab_kickoff.ts
import { CarInput, GameSim, Phase, PHYSICS, defaultConfig } from '../src';

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

interface Variant { name: string; jumpAt: number; diag: number; cancelAfter: number; boostAir: boolean }

function run(v: Variant): { t: number; speed: number; upright: number } {
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'a' }, { team: 1, name: 'b' }], 5), skipReplay: true });
  while (sim.phase !== Phase.Playing) sim.step();
  const car = sim.cars[0];
  let t = 0, flipAt = -1, jumped = false, second = false;
  const maxT = 6;
  while (t < maxT) {
    const out: CarInput = sim.inputs[0];
    out.clear();
    const m = car.basis.m;
    const bx = sim.ball.pos.x - car.pos.x, by = sim.ball.pos.y - car.pos.y;
    const dist = Math.hypot(bx, by);
    if (dist < 150) return { t, speed: Math.hypot(car.vel.x, car.vel.y), upright: m[8] };
    const lx = bx * m[0] + by * m[3], ly = bx * m[1] + by * m[4];
    const ang = Math.atan2(ly, lx);
    out.throttle = 1;
    if (car.onGround) {
      out.steer = clamp(-ang * 2.6, -1, 1);
      out.boost = car.boost > 0 && Math.abs(ang) < 0.3;
    }
    if (v.jumpAt >= 0 && t >= v.jumpAt && !jumped && car.onGround) { jumped = true; out.jump = true; }
    if (jumped && !second) {
      out.jump = t < v.jumpAt + 0.08;
      out.boost = true;
      if (t >= v.jumpAt + 0.1) {
        second = true; flipAt = t;
        out.jump = true; out.pitch = 1;
        const side = ang >= 0 ? -1 : 1; // diagonal toward the ball side
        out.yaw = side * v.diag; out.steer = side * v.diag;
      }
    } else if (second && !car.onGround) {
      out.boost = v.boostAir;
      if (v.cancelAfter >= 0 && t - flipAt > v.cancelAfter) out.pitch = -1;
      out.throttle = 1;
    } else if (second && car.onGround) {
      out.steer = clamp(-ang * 2.6, -1, 1);
      out.boost = car.boost > 0 && Math.abs(ang) < 0.3;
    }
    sim.step();
    t += PHYSICS.dt;
  }
  return { t: maxT, speed: 0, upright: car.basis.m[8] };
}

const variants: Variant[] = [{ name: 'boost only', jumpAt: -1, diag: 0, cancelAfter: -1, boostAir: false }];
for (const jumpAt of [0.0, 0.15, 0.3, 0.5]) {
  for (const diag of [0, 0.5, 1]) {
    for (const cancelAfter of [-1, 0.12, 0.25]) {
      variants.push({ name: `jump@${jumpAt} diag${diag} cancel${cancelAfter}`, jumpAt, diag, cancelAfter, boostAir: true });
    }
  }
}
const rows = variants.map((v) => ({ v, r: run(v) })).sort((a, b) => a.r.t - b.r.t);
for (const { v, r } of rows.slice(0, 12)) console.log(`${v.name.padEnd(34)} reach ball ${r.t.toFixed(2)}s  speed ${r.speed.toFixed(0)}  upright ${r.upright.toFixed(2)}`);
const base = rows.find((x) => x.v.name === 'boost only');
console.log(`--\nboost only: ${base?.r.t.toFixed(2)}s speed ${base?.r.speed.toFixed(0)}`);
