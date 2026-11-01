import { BALL, BallState, CarInput, CarState, collideCarBall, placeCar, stepBall, stepCar, vec3 } from '../src';
const dt = 1 / 120;
function hit(speed: number, offsetY = 0, ballZ: number = BALL.radius, jump = false) {
  const car = new CarState(); placeCar(car, 0, -600, Math.PI / 2); car.vel.y = speed;
  const ball = new BallState(); ball.pos.x = offsetY; ball.pos.y = 0; ball.pos.z = ballZ;
  const inp = new CarInput(); inp.throttle = 0; let tick = 0; let contact = false, post = 0;
  for (let i = 0; i < 120; i++) { car.vel.y = speed; stepCar(car, inp, dt); car.vel.y = speed; stepBall(ball, dt); if (collideCarBall(car, ball, tick++)) contact = true; if (contact && post++ > 3) break; }
  return { v: vec3.length(ball.vel), vy: ball.vel.y, vz: ball.vel.z, spin: vec3.length(ball.angVel) };
}
for (const sp of [300, 1000, 1400, 2200]) { const h = hit(sp); console.log(`car ${sp} -> ball ${h.v.toFixed(0)} (x${(h.v / sp).toFixed(2)}) fwd ${h.vy.toFixed(0)} up ${h.vz.toFixed(0)} spin ${h.spin.toFixed(1)}`); }
const side = hit(1400, 125); console.log(`glancing side hit @1400 -> ball ${side.v.toFixed(0)}`);
