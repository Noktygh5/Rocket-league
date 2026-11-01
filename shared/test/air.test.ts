import { describe, expect, it } from 'vitest';
import { CAR, CarInput, CarState, PHYSICS, Vec3, placeCar, stepCar, vec3, mat3 } from '../src';

const dt = PHYSICS.dt;
const inputOf = (o: Partial<CarInput>): CarInput => Object.assign(new CarInput(), o);

function airCar(z = 800): CarState {
  const c = new CarState();
  placeCar(c, 0, 0, Math.PI / 2); // faces +Y
  c.pos.z = z;
  c.wheelContacts = 0; c.onGround = false;
  return c;
}
function groundCar(): CarState {
  const c = new CarState();
  placeCar(c, 0, 0, Math.PI / 2);
  return c;
}
function localAng(c: CarState): Vec3 {
  return mat3.mulVecTransposed(new Vec3(), c.basis, c.angVel);
}

/** Jump on the ground, holding the button for `holdSeconds`; returns apex height gain. */
function jumpApex(holdSeconds: number): number {
  const c = groundCar();
  const z0 = c.pos.z;
  let apex = z0;
  for (let i = 0; i < 120 * 3; i++) {
    const t = i * dt;
    const jump = t < holdSeconds || i === 0;
    stepCar(c, inputOf({ jump }), dt);
    apex = Math.max(apex, c.pos.z);
  }
  return apex - z0;
}

describe('jump', () => {
  it('hold-jump goes higher than tap-jump', () => {
    const tap = jumpApex(0.001);
    const hold = jumpApex(0.3);
    expect(tap).toBeGreaterThan(40);
    expect(hold).toBeGreaterThan(tap * 1.5);
    expect(hold).toBeGreaterThan(150);
    expect(hold).toBeLessThan(450);
  });

  it('tap jump starts with the 291.667 impulse', () => {
    const c = groundCar();
    stepCar(c, inputOf({ jump: true }), dt);
    expect(c.vel.z).toBeGreaterThan(280);
    expect(c.vel.z).toBeLessThan(330);
    expect(c.jumped).toBe(true);
  });

  it('landing restores jumps', () => {
    const c = groundCar();
    for (let i = 0; i < 120 * 3; i++) stepCar(c, inputOf({ jump: i < 5 }), dt);
    expect(c.onGround).toBe(true);
    expect(c.jumped).toBe(false);
    expect(c.flipUsed).toBe(false);
  });
});

describe('second jump and flips', () => {
  function secondJumpAt(tSecond: number, extra: Partial<CarInput> = {}): CarState {
    const c = groundCar();
    let pressed = false;
    for (let i = 0; i < 120 * (tSecond + 0.3); i++) {
      const t = i * dt;
      const jump = i < 3 || (t >= tSecond && t < tSecond + 0.05);
      if (t >= tSecond && !pressed) pressed = true;
      // keep the car airborne for long windows (cancel gravity-driven landing) by lifting it
      if (t > 0.5 && t < tSecond && c.pos.z < 700) { c.vel.z = Math.max(c.vel.z, 0); c.pos.z = Math.max(c.pos.z, 700); }
      stepCar(c, inputOf({ jump, ...(t >= tSecond ? extra : {}) }), dt);
    }
    return c;
  }

  it('double jump works inside the 1.25 s window and not after', () => {
    const inside = secondJumpAt(1.0);
    expect(inside.flipUsed).toBe(true);
    const outside = secondJumpAt(1.5);
    expect(outside.flipUsed).toBe(false);
  });

  it('a car that falls off a ledge still gets its second jump', () => {
    const c = airCar(600);
    stepCar(c, inputOf({ jump: false }), dt);
    stepCar(c, inputOf({ jump: true }), dt);
    expect(c.flipUsed).toBe(true);
    expect(c.vel.z).toBeGreaterThan(-5 + 200); // impulse applied on top of tiny fall speed
  });

  it('no direction input = vertical double jump, no rotation', () => {
    const c = airCar();
    stepCar(c, inputOf({}), dt);
    stepCar(c, inputOf({ jump: true }), dt);
    expect(c.flipActive).toBe(false);
    for (let i = 0; i < 30; i++) stepCar(c, inputOf({}), dt);
    expect(vec3.length(c.angVel)).toBeLessThan(0.5);
  });

  const dirs: [string, number, number][] = [
    ['forward', 1, 0], ['backward', -1, 0], ['left', 0, -1], ['right', 0, 1],
    ['forward-left', 1, -1], ['forward-right', 1, 1], ['back-left', -1, -1], ['back-right', -1, 1],
  ];
  for (const [name, px, yw] of dirs) {
    it(`flip ${name}: impulse and rotation match the input direction`, () => {
      const c = airCar();
      stepCar(c, inputOf({}), dt);
      stepCar(c, inputOf({ jump: true, pitch: px, yaw: yw }), dt);
      expect(c.flipActive).toBe(true);
      // car faces +Y, right = +X
      const dy = c.vel.y, dx = c.vel.x;
      if (px > 0) expect(dy).toBeGreaterThan(150);
      if (px < 0) expect(dy).toBeLessThan(-150);
      if (px === 0) expect(Math.abs(dy)).toBeLessThan(5);
      if (yw > 0) expect(dx).toBeGreaterThan(150);
      if (yw < 0) expect(dx).toBeLessThan(-150);
      if (yw === 0) expect(Math.abs(dx)).toBeLessThan(5);
      for (let i = 0; i < 25; i++) stepCar(c, inputOf({ pitch: px, yaw: yw }), dt);
      const w = localAng(c);
      if (px > 0) expect(w.y).toBeGreaterThan(2);
      if (px < 0) expect(w.y).toBeLessThan(-2);
      if (yw > 0) expect(w.x).toBeGreaterThan(2);
      if (yw < 0) expect(w.x).toBeLessThan(-2);
    });
  }

  it('flip hang: vertical velocity is damped during the flip', () => {
    const a = airCar(1500), b = airCar(1500);
    a.vel.z = 600; b.vel.z = 600;
    stepCar(a, inputOf({}), dt); stepCar(b, inputOf({}), dt);
    stepCar(a, inputOf({ jump: true, pitch: 1 }), dt);
    stepCar(b, inputOf({ jump: false }), dt);
    for (let i = 0; i < 40; i++) { stepCar(a, inputOf({ pitch: 1 }), dt); stepCar(b, inputOf({}), dt); }
    expect(a.vel.z).toBeLessThan(b.vel.z - 100);
  });

  it('opposite pitch cancels the flip rotation', () => {
    const run = (cancel: boolean) => {
      const c = airCar();
      stepCar(c, inputOf({}), dt);
      stepCar(c, inputOf({ jump: true, pitch: 1 }), dt);
      for (let i = 0; i < 120 * 0.4; i++) stepCar(c, inputOf({ pitch: cancel ? -1 : 0 }), dt);
      return Math.abs(localAng(c).y);
    };
    expect(run(true)).toBeLessThan(run(false) * 0.5);
  });

  it('pitch input is locked for about a second after a flip', () => {
    const c = airCar(1800);
    stepCar(c, inputOf({}), dt);
    stepCar(c, inputOf({ jump: true, yaw: 1 }), dt); // side flip so pitch axis is free
    for (let i = 0; i < 120 * 0.7; i++) stepCar(c, inputOf({}), dt);
    expect(c.pitchLock).toBeGreaterThan(0);
    const w0 = localAng(c).y;
    for (let i = 0; i < 20; i++) stepCar(c, inputOf({ pitch: 1 }), dt);
    expect(Math.abs(localAng(c).y - w0)).toBeLessThan(0.3);
    for (let i = 0; i < 120 * 0.6; i++) stepCar(c, inputOf({}), dt);
    expect(c.pitchLock).toBeLessThanOrEqual(0);
    const w1 = localAng(c).y;
    for (let i = 0; i < 20; i++) stepCar(c, inputOf({ pitch: 1 }), dt);
    expect(localAng(c).y - w1).toBeGreaterThan(1);
  });

  it('flip duration constant is honoured', () => {
    const c = airCar(1800);
    stepCar(c, inputOf({}), dt);
    stepCar(c, inputOf({ jump: true, pitch: 1 }), dt);
    for (let i = 0; i < 120 * (CAR.flip.duration - 0.05); i++) stepCar(c, inputOf({}), dt);
    expect(c.flipActive).toBe(true);
    for (let i = 0; i < 120 * 0.1; i++) stepCar(c, inputOf({}), dt);
    expect(c.flipActive).toBe(false);
  });
});

describe('air control', () => {
  it('pitch, yaw and roll inputs produce angular velocity about the right local axes', () => {
    const t = (o: Partial<CarInput>) => {
      const c = airCar();
      for (let i = 0; i < 20; i++) stepCar(c, inputOf(o), dt);
      return localAng(c);
    };
    expect(t({ pitch: 1 }).y).toBeGreaterThan(0.5); // nose down
    expect(t({ pitch: -1 }).y).toBeLessThan(-0.5);
    expect(t({ yaw: 1 }).z).toBeLessThan(-0.5); // turn right
    expect(t({ roll: 1 }).x).toBeGreaterThan(1); // roll right
    expect(t({ roll: -1 }).x).toBeLessThan(-1);
  });

  it('angular velocity saturates at 5.5 rad/s', () => {
    const c = airCar(1900);
    let max = 0;
    for (let i = 0; i < 120; i++) { stepCar(c, inputOf({ roll: 1 }), dt); max = Math.max(max, vec3.length(c.angVel)); }
    expect(max).toBeLessThanOrEqual(CAR.maxAngularSpeed + 1e-6);
    expect(max).toBeGreaterThan(5);
  });

  it('boost thrusts along the nose in the air', () => {
    const c = airCar(1500);
    for (let i = 0; i < 60; i++) stepCar(c, inputOf({ boost: true }), dt);
    expect(c.vel.y).toBeGreaterThan(400); // faces +Y
  });

  it('boost never goes below zero and holding at 0 does nothing', () => {
    const c = airCar(1500);
    c.boost = 0;
    for (let i = 0; i < 30; i++) stepCar(c, inputOf({ boost: true }), dt);
    expect(c.boost).toBe(0);
    expect(c.vel.y).toBeLessThan(5);
  });

  it('a tap of boost still burns about 0.1 s worth', () => {
    const c = airCar(1500);
    c.boost = 50;
    stepCar(c, inputOf({ boost: true }), dt);
    for (let i = 0; i < 60; i++) stepCar(c, inputOf({}), dt);
    expect(50 - c.boost).toBeGreaterThan(2.5);
    expect(50 - c.boost).toBeLessThan(4.5);
  });
});
