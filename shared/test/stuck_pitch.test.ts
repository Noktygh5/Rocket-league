import { describe, expect, it } from 'vitest';
import { CarInput, CarState, PHYSICS, placeCar, stepCar } from '../src';

const dt = PHYSICS.dt;
const inputOf = (o: Partial<CarInput>): CarInput => Object.assign(new CarInput(), o);

/** Car just above the floor, pitched nose-down (positive) or nose-up (negative) by `deg`, at rest. */
function pitched(deg: number, yaw = Math.PI / 2): CarState {
  const c = new CarState();
  placeCar(c, 0, 0, yaw);
  const h = (deg * Math.PI) / 360;
  const q = { x: c.rot.x, y: c.rot.y, z: c.rot.z, w: c.rot.w };
  const s = Math.sin(h), co = Math.cos(h);
  // the car's left axis in world space for forward (cos yaw, sin yaw, 0)
  const px = -Math.sin(yaw) * s, py = Math.cos(yaw) * s, pz = 0, pw = co;
  c.rot.w = pw * q.w - px * q.x - py * q.y - pz * q.z;
  c.rot.x = pw * q.x + px * q.w + py * q.z - pz * q.y;
  c.rot.y = pw * q.y - px * q.z + py * q.w + pz * q.x;
  c.rot.z = pw * q.z + px * q.y - py * q.x + pz * q.w;
  c.pos.z = 60;
  c.onGround = false; c.wheelContacts = 0;
  return c;
}

describe('stuck pitched near the ground while holding W', () => {
  for (const deg of [15, 30, 45, 60, 75, -30, -60]) {
    for (const [name, inp] of [
      ['W (throttle + pitch down)', inputOf({ throttle: 1, pitch: 1 })],
      ['S (reverse + pitch up)', inputOf({ throttle: -1, pitch: -1 })],
      ['no input', inputOf({})],
    ] as const) {
      it(`${deg} deg, ${name}: ends on four wheels`, () => {
        const c = pitched(deg);
        for (let i = 0; i < 120 * 3; i++) stepCar(c, inp, dt);
        const m = c.basis.m;
        expect(m[8]).toBeGreaterThan(0.95);
        expect(c.onGround).toBe(true);
      });
    }
  }
});
