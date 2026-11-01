import { BallState, copyBall, stepBall } from '../ball';
import { ARENA, BALL, PHYSICS } from '../constants';

const MAX_STEPS = 400;

/** Predicted ball trajectory sampled every `stepDt` seconds (index 0 = now). */
export class BallPath {
  n = 0;
  stepDt = 1 / 60;
  t = new Float32Array(MAX_STEPS);
  x = new Float32Array(MAX_STEPS);
  y = new Float32Array(MAX_STEPS);
  z = new Float32Array(MAX_STEPS);
  vx = new Float32Array(MAX_STEPS);
  vy = new Float32Array(MAX_STEPS);
  vz = new Float32Array(MAX_STEPS);
  /** Time until the ball is fully past a goal line (+1 orange goal, -1 blue goal), or -1. */
  goalTime = -1;
  goalSide = 0;
}

const scratch = new BallState();

/** Ball-only prediction using the real ball and arena code (ignores cars). */
export function predictBall(path: BallPath, ball: BallState, horizon: number, stepTicks = 2): void {
  copyBall(scratch, ball);
  const dt = stepTicks * PHYSICS.dt;
  path.stepDt = dt;
  path.goalTime = -1;
  path.goalSide = 0;
  const n = Math.min(MAX_STEPS, Math.floor(horizon / dt) + 1);
  for (let i = 0; i < n; i++) {
    path.t[i] = i * dt;
    path.x[i] = scratch.pos.x; path.y[i] = scratch.pos.y; path.z[i] = scratch.pos.z;
    path.vx[i] = scratch.vel.x; path.vy[i] = scratch.vel.y; path.vz[i] = scratch.vel.z;
    if (path.goalSide === 0) {
      if (scratch.pos.y > ARENA.halfLength + BALL.radius) { path.goalSide = 1; path.goalTime = i * dt; }
      else if (scratch.pos.y < -ARENA.halfLength - BALL.radius) { path.goalSide = -1; path.goalTime = i * dt; }
    }
    for (let k = 0; k < stepTicks; k++) stepBall(scratch, PHYSICS.dt);
  }
  path.n = n;
}
