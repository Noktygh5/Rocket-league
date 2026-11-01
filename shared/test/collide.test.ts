import { describe, expect, it } from 'vitest';
import {
  BALL, BallState, CarCarResult, CarInput, CarState, PHYSICS, collideCarBall, collideCarCar,
  placeCar, stepBall, stepCar, vec3,
} from '../src';

const dt = PHYSICS.dt;
const inputOf = (o: Partial<CarInput>): CarInput => Object.assign(new CarInput(), o);

function carAt(x: number, y: number, yaw: number, vSpeed = 0): CarState {
  const c = new CarState();
  placeCar(c, x, y, yaw);
  c.vel.x = Math.cos(yaw) * vSpeed;
  c.vel.y = Math.sin(yaw) * vSpeed;
  return c;
}

/** Car drives (+Y) at `speed` into a ball at the origin; returns ball speed after the hit. */
function headOn(speed: number, yOffset = 0, ballZ: number = BALL.radius) {
  const car = carAt(0, -400, Math.PI / 2, speed);
  const ball = new BallState();
  ball.pos.y = 0; ball.pos.x = yOffset; ball.pos.z = ballZ;
  let tick = 0;
  for (let i = 0; i < 120; i++) {
    stepCar(car, inputOf({ throttle: 1 }), dt);
    stepBall(ball, dt);
    collideCarBall(car, ball, tick++);
  }
  return { car, ball };
}

describe('car-ball', () => {
  it('a nose hit sends the ball forward faster than the car was moving', () => {
    const { ball } = headOn(1000);
    const sp = vec3.length(ball.vel);
    expect(ball.vel.y).toBeGreaterThan(1200);
    expect(sp).toBeGreaterThan(1300);
    expect(sp).toBeLessThan(2200);
  });

  it('faster approaches give faster balls, with the extra impulse scaling down at high speed', () => {
    const slow = vec3.length(headOn(600).ball.vel);
    const mid = vec3.length(headOn(1400).ball.vel);
    const fast = vec3.length(headOn(2200).ball.vel);
    expect(mid).toBeGreaterThan(slow);
    expect(fast).toBeGreaterThan(mid);
    expect(fast / 2200).toBeLessThan(mid / 1400 + 0.05);
  });

  it('a nose hit is stronger than a glancing hit with the side of the car', () => {
    const nose = headOn(1200, 0);
    // approach so only the side of the car brushes the ball
    const car = carAt(-125, -400, Math.PI / 2, 1200);
    const ball = new BallState();
    ball.pos.z = BALL.radius;
    let tick = 0;
    for (let i = 0; i < 120; i++) {
      stepCar(car, inputOf({ throttle: 1 }), dt);
      stepBall(ball, dt);
      collideCarBall(car, ball, tick++);
    }
    expect(vec3.length(nose.ball.vel)).toBeGreaterThan(vec3.length(ball.vel) * 1.5);
  });

  it('never leaves the ball overlapping the car', () => {
    const { car, ball } = headOn(1500);
    // after the hit the ball must not be inside the hitbox
    const dx = ball.pos.x - car.pos.x, dy = ball.pos.y - car.pos.y, dz = ball.pos.z - car.pos.z;
    expect(Math.hypot(dx, dy, dz)).toBeGreaterThan(BALL.radius);
  });

  it('flip reset: ball touching the underside restores the flip', () => {
    const car = carAt(0, 0, Math.PI / 2);
    car.pos.z = 700; car.onGround = false; car.wheelContacts = 0;
    car.flipUsed = true;
    const ball = new BallState();
    ball.pos.x = 0; ball.pos.y = 0; ball.pos.z = 700 - 18 - BALL.radius + 10;
    const hit = collideCarBall(car, ball, 1);
    expect(hit).toBe(true);
    expect(car.flipUsed).toBe(false);
  });

  it('records the touch tick', () => {
    const { car } = headOn(800);
    expect(car.lastTouchTick).toBeGreaterThanOrEqual(0);
  });
});

describe('car-car', () => {
  it('separates overlapping cars and exchanges momentum', () => {
    const a = carAt(0, -50, Math.PI / 2, 600);
    const b = carAt(0, 50, -Math.PI / 2, 600);
    let result = 0;
    for (let i = 0; i < 60; i++) {
      stepCar(a, inputOf({ throttle: 1 }), dt);
      stepCar(b, inputOf({ throttle: 1 }), dt);
      const r = collideCarCar(a, b);
      if (r !== CarCarResult.None) result = r;
    }
    expect(result).toBe(CarCarResult.Bumped);
    expect(a.vel.y).toBeLessThan(200);
    expect(b.vel.y).toBeGreaterThan(-200);
    expect(Math.abs(a.pos.y - b.pos.y)).toBeGreaterThan(80);
  });

  it('a supersonic nose hit demolishes the victim', () => {
    const a = carAt(0, -600, Math.PI / 2, 2250);
    a.supersonic = true;
    const b = carAt(0, 0, Math.PI / 2, 0);
    let result: number = CarCarResult.None;
    for (let i = 0; i < 40 && result <= CarCarResult.Bumped; i++) {
      stepCar(a, inputOf({ throttle: 1 }), dt);
      stepCar(b, inputOf({}), dt);
      a.vel.y = 2250;
      a.supersonic = true;
      result = collideCarCar(a, b);
    }
    expect(result).toBe(CarCarResult.ADemoedB);
    expect(b.demolished).toBe(true);
    expect(b.respawnTimer).toBeGreaterThan(2.9);
  });

  it('a slow hit does not demolish', () => {
    const a = carAt(0, -150, Math.PI / 2, 1800);
    const b = carAt(0, 0, Math.PI / 2, 0);
    let demo = false;
    for (let i = 0; i < 30; i++) {
      stepCar(a, inputOf({ throttle: 1 }), dt);
      stepCar(b, inputOf({}), dt);
      const r = collideCarCar(a, b);
      if (r === CarCarResult.ADemoedB || r === CarCarResult.BDemoedA) demo = true;
    }
    expect(demo).toBe(false);
    expect(b.demolished).toBe(false);
  });

  it('a supersonic hit with the side of the attacker does not demolish', () => {
    const a = carAt(-70, 0, 0, 2250); // moving +X but... hit with its side by facing +Y
    a.rot.z = Math.SQRT1_2; a.rot.w = Math.SQRT1_2; // face +Y while moving +X
    a.supersonic = true;
    const b = carAt(0, 0, Math.PI / 2, 0);
    let demo = false;
    for (let i = 0; i < 20; i++) {
      a.vel.x = 2250; a.vel.y = 0; a.supersonic = true;
      stepCar(a, inputOf({}), dt);
      const r = collideCarCar(a, b);
      a.vel.x = 2250;
      if (r === CarCarResult.ADemoedB) demo = true;
    }
    expect(demo).toBe(false);
  });
});
