// Replay a moment of a recorded game into the boss: loads the telemetry state at a given time (cars, ball, boost) into a fresh sim and lets
// the boss think for a few ticks, printing its plan. Lets us ask "what does the current code do in the situation the old code failed in?".
// Usage: npx tsx scripts/replay_recording.ts <folder> <seconds> [ticksToRun=240] [stepEvery=30]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameSim, Phase, createBot, defaultConfig } from '../src';
const [dir, secStr, runStr, everyStr] = process.argv.slice(2);
const sec = Number(secStr), run = Number(runStr ?? 240), every = Number(everyStr ?? 30);
const rows: any[] = readFileSync(join(dir, 'telemetry.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).filter((r) => r.k === 't');
const row = rows.reduce((a, b) => (Math.abs(b.tick / 120 - sec) < Math.abs(a.tick / 120 - sec) ? b : a));
const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'human' }, { team: 1, name: 'boss' }], 77), matchLength: 600, skipReplay: true });
const boss: any = createBot('ultrahard', sim, 1, 77);
while (sim.phase !== Phase.Playing) sim.step();
const load = (c: any, d: any) => {
  c.pos.x = d.p[0]; c.pos.y = d.p[1]; c.pos.z = d.p[2]; c.vel.x = d.v[0]; c.vel.y = d.v[1]; c.vel.z = d.v[2]; c.boost = d.b;
  // orientation: nose along the logged forward vector, wheels toward the world up (good enough for the first ticks)
  const f = d.f, yaw = Math.atan2(f[1], f[0]); (c as any).setYaw ? (c as any).setYaw(yaw) : null;
};
import('../src').then(({ placeCar }) => {
  for (const [i, d] of row.cars.entries()) { placeCar(sim.cars[i], d.p[0], d.p[1], Math.atan2(d.f[1], d.f[0])); sim.cars[i].vel.x = d.v[0]; sim.cars[i].vel.y = d.v[1]; sim.cars[i].vel.z = d.v[2]; sim.cars[i].boost = d.b; }
  sim.ball.pos.x = row.ball[0]; sim.ball.pos.y = row.ball[1]; sim.ball.pos.z = row.ball[2]; sim.ball.vel.x = row.ball[3]; sim.ball.vel.y = row.ball[4]; sim.ball.vel.z = row.ball[5];
  const names = ['Drive', 'Strike', 'Aerial', 'Pad', 'Shadow'];
  console.log(`replaying ${(row.tick / 120).toFixed(1)} s of ${dir.split('/').pop()}; the recorded boss was in ${names[row.bot.m]}`);
  const k = sim.cars[1], h = sim.cars[0];
  for (let t = 0; t < run; t++) {
    boss.think(); sim.step();
    if (t % every === 0) console.log(`  +${(t / 120).toFixed(2)}s ${names[boss.debug.mode]} carry=${boss.isCarry(k)} boss(${k.pos.x | 0},${k.pos.y | 0},z${k.pos.z | 0} b${k.boost | 0} v${Math.hypot(k.vel.x, k.vel.y) | 0}) tgt(${boss.plan.tx | 0},${boss.plan.ty | 0}) human(${h.pos.x | 0},${h.pos.y | 0}) ball(${sim.ball.pos.x | 0},${sim.ball.pos.y | 0},${sim.ball.pos.z | 0} v${Math.hypot(sim.ball.vel.x, sim.ball.vel.y) | 0})`);
  }
});
