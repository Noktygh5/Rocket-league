import { describe, expect, it } from 'vitest';
import { ARENA, CAR, CarInput, CarState, PHYSICS, Vec3, arena, placeCar, stepCar, vec3 } from '../src';

const dt = PHYSICS.dt;

function mk(x = 0, y = 0, yaw = Math.PI / 2): CarState {
  const c = new CarState();
  placeCar(c, x, y, yaw);
  return c;
}
function run(c: CarState, inp: CarInput, seconds: number, each?: (t: number) => void): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    stepCar(c, inp, dt);
    if (each) each(i * dt);
  }
}
const inputOf = (o: Partial<CarInput>): CarInput => Object.assign(new CarInput(), o);
const speed = (c: CarState) => vec3.length(c.vel);

describe('ground physics', () => {
  it('rests on the floor without drifting or jittering', () => {
    const c = mk();
    run(c, new CarInput(), 3);
    expect(c.onGround).toBe(true);
    expect(c.wheelContacts).toBe(4);
    expect(Math.abs(c.pos.z - CAR.restHeight)).toBeLessThan(1.5);
    expect(speed(c)).toBeLessThan(2);
    expect(Math.abs(c.pos.y)).toBeLessThan(1);
  });

  it('throttle alone tops out near 1410 uu/s', () => {
    const c = mk(0, -4000);
    run(c, inputOf({ throttle: 1 }), 5);
    expect(speed(c)).toBeGreaterThan(1380);
    expect(speed(c)).toBeLessThan(1415);
  });

  it('boost from rest reaches supersonic and caps at 2300', () => {
    const c = mk(0, -4500);
    c.boost = 100;
    let tSuper = -1;
    let maxSp = 0;
    run(c, inputOf({ throttle: 1, boost: true }), 3.2, (t) => {
      c.boost = 100; // infinite for this test
      if (tSuper < 0 && c.supersonic) tSuper = t;
      maxSp = Math.max(maxSp, speed(c));
    });
    expect(tSuper).toBeGreaterThan(1.0);
    expect(tSuper).toBeLessThan(4.0);
    expect(maxSp).toBeLessThanOrEqual(2300.01);
    expect(maxSp).toBeGreaterThan(2250);
  });

  it('boost drains 100 in about 3 seconds', () => {
    const c = mk(0, -4500);
    c.boost = 100;
    let t0 = -1;
    run(c, inputOf({ throttle: 1, boost: true }), 3.5, (t) => {
      if (t0 < 0 && c.boost <= 0) t0 = t;
    });
    expect(t0).toBeGreaterThan(2.9);
    expect(t0).toBeLessThan(3.1);
  });

  it('brakes harder than it coasts', () => {
    const a = mk(0, -3000), b = mk(0, -3000);
    a.vel.y = 1000; b.vel.y = 1000;
    run(a, inputOf({ throttle: -1 }), 0.2);
    run(b, new CarInput(), 0.2);
    expect(a.vel.y).toBeLessThan(b.vel.y - 400);
    // reverse throttle brakes to a stop first, then drives backwards
    const c = mk(0, 0);
    c.vel.y = 500;
    run(c, inputOf({ throttle: -1 }), 3);
    expect(c.vel.y).toBeLessThan(-500);
  });

  it('turns tighter at low speed than at high speed', () => {
    const radius = (v: number) => {
      const c = mk(0, 0, 0);
      c.vel.x = v;
      run(c, inputOf({ steer: 1 }), 0.3);
      const w = Math.abs(c.angVel.z);
      return vec3.length(c.vel) / w;
    };
    const r500 = radius(500), r1500 = radius(1500);
    expect(r500).toBeGreaterThan(180);
    expect(r500).toBeLessThan(330);
    expect(r1500).toBeGreaterThan(r500 * 2.5);
  });

  it('powerslide keeps speed but sheds lateral grip', () => {
    const c = mk(0, 0, 0);
    c.vel.x = 1200;
    run(c, inputOf({ steer: 1, handbrake: true }), 0.6);
    const left = new Vec3(-Math.sin(Math.atan2(c.basis.m[3], c.basis.m[0])), Math.cos(Math.atan2(c.basis.m[3], c.basis.m[0])), 0);
    const lat = Math.abs(vec3.dot(c.vel, left));
    expect(lat).toBeGreaterThan(150); // sliding
    expect(speed(c)).toBeGreaterThan(700);
  });
});

describe('wall and ceiling driving', () => {
  it('drives up the side wall and stays stuck on the ceiling', () => {
    const c = mk(3000, 0, 0); // facing +X toward the side wall
    c.boost = 100;
    let reachedWall = false;
    let reachedCeiling = false;
    run(c, inputOf({ throttle: 1, boost: true }), 3.4, () => {
      c.boost = 100;
      if (c.onGround && c.surfaceNormal.x < -0.95) reachedWall = true;
      if (c.onGround && c.surfaceNormal.z < -0.95) reachedCeiling = true;
    });
    expect(reachedWall).toBe(true);
    expect(reachedCeiling).toBe(true);
    // keep driving along the ceiling with throttle only; must not fall
    run(c, inputOf({ throttle: 1 }), 1);
    expect(c.onGround).toBe(true);
    expect(c.surfaceNormal.z).toBeLessThan(-0.9);
    expect(c.pos.z).toBeGreaterThan(ARENA.ceilingHeight - 60);
    // car must still be inside the arena
    expect(arena.sdf(c.pos.x, c.pos.y, c.pos.z)).toBeGreaterThan(-5);
  });

  it('sticks to a wall while rolling parallel to it', () => {
    const c = mk(3500, -3000, Math.PI / 2);
    c.boost = 100;
    run(c, inputOf({ throttle: 1, boost: true, steer: 0 }), 2.2, () => { c.boost = 100; });
    // aim at the wall and climb
    run(c, inputOf({ throttle: 1, boost: true, steer: 1 }), 0.5, () => { c.boost = 100; });
    run(c, inputOf({ throttle: 1, boost: true }), 1.5, () => { c.boost = 100; });
    expect(arena.sdf(c.pos.x, c.pos.y, c.pos.z)).toBeGreaterThan(-5);
  });
});
