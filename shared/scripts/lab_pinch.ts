// Lab: does this physics reward pinching the ball against a wall? Hits a ball resting at the side wall
// (and, for comparison, one in open field) from several approach angles with a front flip.
// Usage: npx tsx scripts/lab_pinch.ts
import { BALL, ARENA, BallState, CarInput, CarState, PHYSICS, collideCarBall, placeCar, stepBall, stepCar } from '../src';

function hit(ballX: number, ballY: number, approachDeg: number, flipLead: number, carSpeed: number): { speed: number; vx: number; vy: number; vz: number } {
  const car = new CarState(), ball = new BallState();
  const a = (approachDeg * Math.PI) / 180;
  // direction the car travels (0 deg = +x toward the wall, 90 deg = along +y)
  const dx = Math.cos(a), dy = Math.sin(a);
  const start = 1500;
  placeCar(car, ballX - dx * start, ballY - dy * start, Math.atan2(dy, dx));
  car.vel.x = dx * carSpeed; car.vel.y = dy * carSpeed;
  ball.pos.x = ballX; ball.pos.y = ballY; ball.pos.z = BALL.radius; ball.vel.x = 0; ball.vel.y = 0; ball.vel.z = 0;
  const inp = new CarInput();
  let tick = 0, jumped = false, flipAt = -1, touchedAt = -1, best = 0;
  let out = { speed: 0, vx: 0, vy: 0, vz: 0 };
  for (let i = 0; i < 120 * 3; i++) {
    inp.clear();
    inp.throttle = 1; inp.boost = car.boost > 0;
    const dist = Math.hypot(ball.pos.x - car.pos.x, ball.pos.y - car.pos.y);
    const ttc = dist / Math.max(1, carSpeed);
    if (!jumped && ttc < flipLead && car.onGround) { jumped = true; inp.jump = true; flipAt = i; }
    else if (jumped && i - flipAt < 6) inp.jump = true;
    else if (jumped && i - flipAt >= 13 && i - flipAt < 17 && !car.flipUsed) { inp.jump = true; inp.pitch = 1; }
    stepCar(car, inp, PHYSICS.dt);
    stepBall(ball, PHYSICS.dt);
    if (collideCarBall(car, ball, ++tick) && touchedAt < 0) touchedAt = i;
    if (touchedAt >= 0 && i - touchedAt <= 60) {
      const s = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z);
      if (s > best) { best = s; out = { speed: s, vx: ball.vel.x, vy: ball.vel.y, vz: ball.vel.z }; }
    }
  }
  return touchedAt < 0 ? { speed: -1, vx: 0, vy: 0, vz: 0 } : out;
}

const wallX = ARENA.halfWidth - BALL.radius - 2;
console.log('approach angle (0 = straight into the wall, 90 = along it) | ball speed off a flip hit: at the wall  vs  open field');
for (const deg of [0, 20, 40, 60, 75, 85]) {
  const row: string[] = [];
  for (const lead of [0.10, 0.16, 0.22]) {
    const w = hit(wallX, 0, deg, lead, 1700);
    const o = hit(0, 0, deg, lead, 1700);
    row.push(`lead ${lead.toFixed(2)}: ${w.speed.toFixed(0)} vs ${o.speed.toFixed(0)}`);
  }
  console.log(`${String(deg).padStart(3)} deg | ${row.join('   ')}`);
}
