import { describe, expect, it } from 'vitest';
import { ARENA, BALL, PHYSICS, Prng, Vec3, arena, BallState, stepBall } from '../src';

const dt = PHYSICS.dt;
const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

function withBall<T>(fn: (b: BallState) => T): T {
  return fn(new BallState());
}

describe('arena sdf', () => {
  it('measures distance to the nearest surface from inside', () => {
    near(arena.sdf(0, 0, 1000), 1000, 1e-6); // floor is nearer than ceiling
    near(arena.sdf(0, 0, 0), 0, 1e-6);
    near(arena.sdf(ARENA.halfWidth, 0, 1000), 0, 1e-6);
    near(arena.sdf(0, 3000, ARENA.ceilingHeight), 0, 1e-6);
    near(arena.sdf(2000, -2000, 500), 500, 1e-6);
  });
  it('is negative outside and symmetric', () => {
    expect(arena.sdf(ARENA.halfWidth + 900, 0, 500)).toBeLessThan(0);
    expect(arena.sdf(0, 0, -10)).toBeLessThan(0);
    near(arena.sdf(1234, 2345, 345), arena.sdf(-1234, -2345, 345), 1e-9);
  });
  it('has a rounded floor-wall ramp of the configured radius', () => {
    const r = ARENA.rampRadius;
    // On the arc: centre (W - r, z = r); point at 45 deg toward the corner.
    const px = ARENA.halfWidth - r + r * Math.SQRT1_2;
    const pz = r - r * Math.SQRT1_2;
    near(arena.sdf(px, 0, pz), 0, 1e-6);
    const n = arena.normal(new Vec3(), px - 10, 0, pz + 10);
    expect(n.x).toBeLessThan(-0.5);
    expect(n.z).toBeGreaterThan(0.5);
  });
  it('has rounded vertical corners', () => {
    const rc = ARENA.cornerRadius;
    const cx = ARENA.halfWidth - rc, cy = ARENA.halfLength - rc;
    const x = cx + rc * Math.SQRT1_2, y = cy + rc * Math.SQRT1_2;
    near(arena.sdf(x, y, 1000), 0, 1e-6);
  });
  it('has a goal opening in the back wall and solid wall elsewhere', () => {
    const L = ARENA.halfLength;
    expect(arena.sdf(0, L + 380, 300)).toBeGreaterThan(100); // inside goal
    expect(arena.sdf(2000, L + 180, 300)).toBeLessThan(0); // behind solid wall
    expect(arena.sdf(0, L + 380, 700)).toBeLessThan(0); // above goal roof
  });
  it('raycast hits the floor at the right distance with an upward normal', () => {
    const n = new Vec3();
    const t = arena.raycast(100, 200, 50, 0, 0, -1, 200, n);
    near(t, 50, 0.1);
    near(n.z, 1, 1e-3);
    expect(arena.raycast(0, 0, 1000, 0, 0, -1, 200, n)).toBe(-1);
  });
});

describe('ball physics', () => {
  it('free fall matches z = z0 - 0.5 g t^2', () => {
    const old = BALL.drag;
    BALL.drag = 0;
    try {
      withBall((b) => {
        b.pos.z = 1500;
        for (let i = 0; i < 120; i++) stepBall(b, dt); // 1 s, still above floor
        near(b.pos.z, 1500 - 0.5 * 650 * 1, 0.01);
        near(b.vel.z, -650, 0.01);
      });
    } finally {
      BALL.drag = old;
    }
  });

  it('comes to rest on the floor', () => {
    withBall((b) => {
      b.pos.z = 800;
      for (let i = 0; i < 120 * 30; i++) stepBall(b, dt);
      near(b.pos.z, BALL.radius, 0.5);
      expect(Math.hypot(b.vel.x, b.vel.y, b.vel.z)).toBeLessThan(5);
    });
  });

  it('bounces to a decaying height using the restitution', () => {
    withBall((b) => {
      b.pos.z = 1000;
      let apex1 = 0, apex2 = 0, phase = 0, prevVz = 0;
      for (let i = 0; i < 120 * 20; i++) {
        stepBall(b, dt);
        if (prevVz > 0 && b.vel.z <= 0) {
          phase++;
          if (phase === 1) apex1 = b.pos.z;
          if (phase === 2) apex2 = b.pos.z;
        }
        prevVz = b.vel.z;
      }
      expect(apex1).toBeGreaterThan(apex2);
      // e = 0.6 -> second bounce apex height above floor ~ e^2 of the drop height
      expect(apex1 - BALL.radius).toBeGreaterThan(0.25 * (1000 - BALL.radius));
    });
  });

  it('rolls up a wall curve and stays inside the arena', () => {
    withBall((b) => {
      b.pos.x = ARENA.halfWidth - 1100; b.pos.z = BALL.radius;
      b.vel.x = 2000;
      let maxZ = 0;
      for (let i = 0; i < 120 * 2; i++) {
        stepBall(b, dt);
        maxZ = Math.max(maxZ, b.pos.z);
        expect(arena.sdf(b.pos.x, b.pos.y, b.pos.z)).toBeGreaterThan(BALL.radius - 1);
      }
      expect(maxZ).toBeGreaterThan(400);
    });
  });

  it('rolling picks up spin from friction', () => {
    withBall((b) => {
      b.pos.z = BALL.radius;
      b.vel.x = 1000;
      for (let i = 0; i < 60; i++) stepBall(b, dt);
      // rolling about +Y... w.y = vx/R on a rolling ball, clamped by max angular speed
      expect(Math.abs(b.angVel.y)).toBeGreaterThan(1);
    });
  });

  it('never tunnels at max speed from random launches', () => {
    const rng = new Prng(1234);
    for (let trial = 0; trial < 40; trial++) {
      const b = new BallState();
      b.pos.x = (rng.next() - 0.5) * 6000;
      b.pos.y = (rng.next() - 0.5) * 8000;
      b.pos.z = 150 + rng.next() * 1500;
      const a = rng.next() * Math.PI * 2, e = (rng.next() - 0.5) * Math.PI;
      const sp = 6000;
      b.vel.x = Math.cos(a) * Math.cos(e) * sp;
      b.vel.y = Math.sin(a) * Math.cos(e) * sp;
      b.vel.z = Math.sin(e) * sp;
      for (let i = 0; i < 120 * 8; i++) {
        stepBall(b, dt);
        expect(arena.sdf(b.pos.x, b.pos.y, b.pos.z)).toBeGreaterThan(BALL.radius - 2);
        expect(Math.abs(b.pos.x)).toBeLessThan(ARENA.halfWidth);
        expect(b.pos.z).toBeLessThan(ARENA.ceilingHeight);
        expect(Math.abs(b.pos.y)).toBeLessThan(ARENA.goal.backY);
      }
    }
  });

  it('enters the goal through the opening but bounces off the wall above the crossbar', () => {
    withBall((b) => {
      b.pos.y = ARENA.halfLength - 620; b.pos.z = 200; b.vel.y = 3000;
      let maxY = 0;
      for (let i = 0; i < 120; i++) { stepBall(b, dt); maxY = Math.max(maxY, b.pos.y); }
      expect(maxY).toBeGreaterThan(ARENA.halfLength + BALL.radius);
    });
    withBall((b) => {
      b.pos.y = ARENA.halfLength - 620; b.pos.z = 900; b.vel.y = 3000;
      let maxY = 0;
      for (let i = 0; i < 120; i++) { stepBall(b, dt); maxY = Math.max(maxY, b.pos.y); }
      expect(maxY).toBeLessThan(ARENA.halfLength - BALL.radius + 5);
    });
  });
});
