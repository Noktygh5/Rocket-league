import { CarInput, CarState, placeCar, stepCar } from '../src';
const dt = 1 / 120;
function heading(c: CarState) { return Math.atan2(c.basis.m[3], c.basis.m[0]); }
{ // turning benchmark: throttle 1, steer 1 from rest
  const c = new CarState(); placeCar(c, 0, 0, 0); const inp = new CarInput(); inp.throttle = 1; inp.steer = 1;
  let acc = 0, prev = heading(c), t90 = -1, t180 = -1, t360 = -1; const sp: string[] = [];
  for (let i = 1; i <= 120 * 8; i++) { stepCar(c, inp, dt); const h = heading(c); let d = prev - h; if (d < -Math.PI) d += 2 * Math.PI; if (d > Math.PI) d -= 2 * Math.PI; acc += d; prev = h; const t = i * dt;
    if (t90 < 0 && acc > Math.PI / 2) t90 = t; if (t180 < 0 && acc > Math.PI) t180 = t; if (t360 < 0 && acc > 2 * Math.PI) t360 = t; if (i % 120 === 0) sp.push(Math.hypot(c.vel.x, c.vel.y).toFixed(0)); }
  console.log(`TURN full throttle+steer: 90deg ${t90.toFixed(3)}s (real ~0.775)  180deg ${t180.toFixed(2)}s (real ~1.55)  360deg ${t360.toFixed(2)}s (real ~3.1)`);
  console.log(`  speed each second: ${sp.join(' ')}  (real settles ~1234)`);
}
{ // straight-line benchmarks
  const run = (boost: boolean) => { const c = new CarState(); placeCar(c, 0, -4500, Math.PI / 2); const inp = new CarInput(); inp.throttle = 1; inp.boost = boost; let t1410 = -1, t2200 = -1, t2300 = -1;
    for (let i = 1; i <= 120 * 6; i++) { c.boost = 100; stepCar(c, inp, dt); const v = c.vel.y, t = i * dt; if (t1410 < 0 && v >= 1400) t1410 = t; if (t2200 < 0 && v >= 2200) t2200 = t; if (t2300 < 0 && v >= 2299) t2300 = t; }
    return { t1410, t2200, t2300, v: c.vel.y }; };
  const a = run(false), b = run(true);
  console.log(`THROTTLE only: reaches 1400 at ${a.t1410.toFixed(2)}s, final ${a.v.toFixed(0)} (cap 1410)`);
  console.log(`BOOST+throttle: 1400 at ${b.t1410.toFixed(2)}s, 2200 at ${b.t2200.toFixed(2)}s, 2299 at ${b.t2300.toFixed(2)}s`);
}
{ // braking + coasting
  const c = new CarState(); placeCar(c, 0, 0, Math.PI / 2); c.vel.y = 1400; const inp = new CarInput(); inp.throttle = -1; let t = 0;
  while (c.vel.y > 1 && t < 5) { stepCar(c, inp, dt); t += dt; }
  const d = new CarState(); placeCar(d, 0, 0, Math.PI / 2); d.vel.y = 1400; const none = new CarInput(); let t2 = 0;
  while (d.vel.y > 1 && t2 < 6) { stepCar(d, none, dt); t2 += dt; }
  console.log(`BRAKE 1400->0: ${t.toFixed(2)}s (3500 uu/s^2 => 0.40s)   COAST 1400->0: ${t2.toFixed(2)}s (525 => 2.67s)`);
}
{ // jump + flip
  for (const [name, hold] of [['tap', 0.001], ['hold', 0.3]] as [string, number][]) {
    const c = new CarState(); placeCar(c, 0, 0, Math.PI / 2); let apex = 0, air = 0; const z0 = c.pos.z;
    for (let i = 0; i < 120 * 3; i++) { const inp = new CarInput(); inp.jump = i * dt < hold || i === 0; stepCar(c, inp, dt); apex = Math.max(apex, c.pos.z - z0); if (!c.onGround) air += dt; }
    console.log(`JUMP ${name}: apex ${apex.toFixed(0)} uu, air time ${air.toFixed(2)} s`);
  }
  const ff = (speed: number, px: number, yw: number) => { const c = new CarState(); placeCar(c, 0, -3000, Math.PI / 2); c.pos.z = 400; c.vel.y = speed; c.onGround = false; c.wheelContacts = 0; const e = new CarInput(); stepCar(c, e, dt); const v0 = { x: c.vel.x, y: c.vel.y }; const inp = new CarInput(); inp.jump = true; inp.pitch = px; inp.yaw = yw; stepCar(c, inp, dt); return `${(c.vel.y - v0.y).toFixed(0)} fwd / ${(c.vel.x - v0.x).toFixed(0)} side`; };
  console.log(`FLIP impulse @0:    front ${ff(0, 1, 0)} | back ${ff(0, -1, 0)} | side ${ff(0, 0, 1)}`);
  console.log(`FLIP impulse @1400: front ${ff(1400, 1, 0)} | back ${ff(1400, -1, 0)} | side ${ff(1400, 0, 1)}`);
  console.log(`FLIP impulse @2300: front ${ff(2300, 1, 0)} | back ${ff(2300, -1, 0)} | side ${ff(2300, 0, 1)}`);
}
