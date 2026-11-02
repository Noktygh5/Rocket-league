// Lab: cost of simulating a car + ball with the real physics (for bot planning).
// Usage: npx tsx scripts/lab_rollout.ts
import { BallState, CarInput, CarState, PHYSICS, collideCarBall, copyBall, copyCar, placeCar, stepBall, stepCar } from '../src';

const car = new CarState(), ball = new BallState();
placeCar(car, -1500, -3000, Math.PI / 2);
ball.pos.x = 0; ball.pos.y = 0; ball.pos.z = 92; ball.vel.y = 500;
const inp = new CarInput();
inp.throttle = 1; inp.boost = true;

const c2 = new CarState(), b2 = new BallState();
const RUNS = 400, SECONDS = 2;
const t0 = performance.now();
for (let r = 0; r < RUNS; r++) {
  copyCar(c2, car); copyBall(b2, ball);
  for (let i = 0; i < SECONDS * 120; i++) {
    stepCar(c2, inp, PHYSICS.dt);
    stepBall(b2, PHYSICS.dt);
    collideCarBall(c2, b2, i);
  }
}
const ms = performance.now() - t0;
console.log(`${RUNS} rollouts of ${SECONDS}s: ${ms.toFixed(0)} ms total = ${(ms / RUNS).toFixed(2)} ms per rollout, ${(ms / RUNS / SECONDS).toFixed(2)} ms per simulated second`);
console.log(`at 2 plans/s with 24 rollouts of 2s: ${(2 * 24 * (ms / RUNS)).toFixed(0)} ms of CPU per real second (${(2 * 24 * (ms / RUNS) / 10).toFixed(1)}% of a core)`);
