import { GameSim, Phase, Prng, arena, defaultConfig } from '../src';
const rng = new Prng(2024);
const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'a' }, { team: 0, name: 'b' }, { team: 1, name: 'c' }, { team: 1, name: 'd' }], 3), matchLength: 3600, skipReplay: true });
const hold = sim.cars.map(() => ({ t: 0, thr: 1, steer: 0, boost: false, pitch: 0, yaw: 0, roll: 0, hb: false, jumpAt: -1 }));
const n = sim.cars.length;
const tipped = new Array(n).fill(0), worstTipped = new Array(n).fill(0), still = new Array(n).fill(0), worstStill = new Array(n).fill(0);
let nan = 0, outside = 0, ticks = 0, jumpsTried = 0, goals = 0, demos = 0;
const TOTAL = 120 * 600;
for (let t = 0; t < TOTAL; t++) {
  sim.events.length = 0;
  for (let i = 0; i < n; i++) {
    const h = hold[i], inp = sim.inputs[i];
    if (--h.t <= 0) { h.t = 15 + rng.int(100); h.thr = rng.next() < 0.75 ? 1 : rng.next() < 0.5 ? -1 : 0; h.steer = rng.next() < 0.3 ? 0 : rng.next() < 0.5 ? -1 : 1; h.boost = rng.next() < 0.5; h.hb = rng.next() < 0.15;
      h.pitch = rng.next() < 0.5 ? 0 : rng.next() < 0.5 ? -1 : 1; h.yaw = rng.next() < 0.5 ? 0 : rng.next() < 0.5 ? -1 : 1; h.roll = rng.next() < 0.7 ? 0 : rng.next() < 0.5 ? -1 : 1; if (rng.next() < 0.4) { h.jumpAt = t; jumpsTried++; } }
    inp.throttle = h.thr; inp.steer = h.steer; inp.boost = h.boost; inp.handbrake = h.hb; inp.pitch = h.pitch; inp.yaw = h.yaw; inp.roll = h.roll;
    const dj = t - h.jumpAt; inp.jump = dj >= 0 && dj < 6 || (dj > 20 && dj < 26 && rng.next() < 1); // tap then second tap
  }
  sim.step(); ticks++;
  if (sim.phase !== Phase.Playing) continue;
  for (let i = 0; i < n; i++) {
    const c = sim.cars[i]; if (c.demolished) { tipped[i] = 0; still[i] = 0; continue; }
    if (!Number.isFinite(c.pos.x + c.pos.y + c.pos.z + c.vel.x + c.vel.y + c.vel.z + c.rot.w)) nan++;
    if (arena.sdf(c.pos.x, c.pos.y, c.pos.z) < -40) outside++;
    if (c.basis.m[8] < 0.0 && !c.onGround && c.hitboxContact) { tipped[i]++; worstTipped[i] = Math.max(worstTipped[i], tipped[i]); if (tipped[i] === 240) console.log('car', i, 'tipped 2s: pos', c.pos.x.toFixed(0), c.pos.y.toFixed(0), c.pos.z.toFixed(0), 'speed', Math.hypot(c.vel.x, c.vel.y, c.vel.z).toFixed(0), 'contacts', c.wheelContacts, 'autoRight', c.autoRight, 'tippedTime', c.tippedTime.toFixed(2), 'up', c.basis.m[8].toFixed(2), 'normal', c.hitboxNormal.x.toFixed(2), c.hitboxNormal.y.toFixed(2), c.hitboxNormal.z.toFixed(2), 'inp', JSON.stringify({thr: sim.inputs[i].throttle, jump: sim.inputs[i].jump})); } else tipped[i] = 0;
    const sp = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
    if (sp < 15 && c.onGround) { still[i]++; } else still[i] = 0;
    worstStill[i] = Math.max(worstStill[i], still[i]);
  }
  for (const e of sim.events) { if (e.type === 'goal') goals++; if (e.type === 'demo') demos++; }
  if (!Number.isFinite(sim.ball.pos.x + sim.ball.vel.x)) nan++;
}
const s = (x: number) => (x / 120).toFixed(2) + 's';
console.log(`ticks ${ticks}  NaN ${nan}  outside-arena samples ${outside}  goals ${goals}  demos ${demos}`);
console.log('longest continuous time tipped over (inverted, resting on a surface, not driving):', worstTipped.map(s).join('  '));
console.log('longest time sitting still on the ground:', worstStill.map(s).join('  '));
