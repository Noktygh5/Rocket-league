// Benchmark from the recorded games: every human shot at the boss's goal (see analyze_saves.ts) is replayed into the CURRENT boss
// (state loaded from the telemetry just after the human's touch, the human's car moved away) and the boss either saves it or not.
// Usage: npx tsx scripts/replay_shots.ts [folder ...]   (default: every folder in ../Recordings)   VERBOSE=1 for one line per shot
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GameSim, Phase, createBot, defaultConfig, placeCar } from '../src';
const L = 7680, GH = 893, GZ = 643;
const root = join(process.cwd(), '..', 'Recordings'); // run from shared/
const dirs = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(root).filter((d) => existsSync(join(root, d, 'telemetry.ndjson'))).map((d) => join(root, d));
let n = 0, saved = 0, conceded = 0, wasGoal = 0, nowGoalOfThose = 0;
for (const dir of dirs) {
  const rows: any[] = readFileSync(join(dir, 'telemetry.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const ticks = rows.filter((r) => r.k === 't'), ev = rows.filter((r) => r.k === 'e');
  const goalsH = ev.filter((e) => e.type === 'goal' && e.a === 0), hitsB = ev.filter((e) => e.type === 'ballHit' && e.a === 1);
  let lastShot = -999;
  for (const h of ev.filter((e) => e.type === 'ballHit' && e.a === 0)) {
    const r = ticks.find((t) => t.tick >= h.tick + 4 && t.ph === 1); if (!r) continue;
    const [x, y, z, vx, vy, vz] = r.ball;
    if (vy < 800 || y > L) continue;
    const t = (L - y) / vy; if (t > 2.6) continue;
    const grounded = z < 150 && Math.abs(vz) < 250;
    const xa = x + vx * t, za = grounded ? 91 : Math.max(91, z + vz * t - 0.5 * 650 * t * t);
    if (Math.abs(xa) > GH + 120 || za > GZ + 100) continue;
    if (h.tick - lastShot < 120) continue; lastShot = h.tick;
    const tEnd = h.tick + Math.round((t + 0.8) * 120);
    const rec = goalsH.find((g) => g.tick >= h.tick && g.tick <= tEnd + 120) ? 'GOAL' : hitsB.find((b) => b.tick > h.tick && b.tick <= tEnd) ? 'save' : 'missed';
    // replay
    const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'human' }, { team: 1, name: 'boss' }], 77), matchLength: 600, skipReplay: true });
    const boss: any = createBot('ultrahard', sim, 1, 77);
    while (sim.phase !== Phase.Playing) sim.step();
    for (const [i, d] of r.cars.entries()) { placeCar(sim.cars[i], d.p[0], d.p[1], Math.atan2(d.f[1], d.f[0])); const c = sim.cars[i]; c.vel.x = d.v[0]; c.vel.y = d.v[1]; c.vel.z = d.v[2]; c.boost = d.b; }
    sim.cars[0].pos.x = 3300; sim.cars[0].pos.y = -6900; sim.cars[0].vel.x = 0; sim.cars[0].vel.y = 0; sim.cars[0].vel.z = 0;
    sim.ball.pos.x = x; sim.ball.pos.y = y; sim.ball.pos.z = z; sim.ball.vel.x = vx; sim.ball.vel.y = vy; sim.ball.vel.z = vz;
    let goal = false, touched = false; const k = sim.cars[1], t0 = k.lastTouchTick;
    for (let i = 0; i < Math.round((t + 1.5) * 120); i++) { boss.think(); sim.step(); if (k.lastTouchTick !== t0 && k.lastTouchTick >= 0) touched = true; if (sim.score[0] > 0) { goal = true; break; } }
    n++; if (goal) conceded++; else saved++;
    if (rec === 'GOAL') { wasGoal++; if (!goal) nowGoalOfThose++; }
    if (process.env.VERBOSE) console.log(`  ${dir.slice(-25, -10)} ${(h.tick / 120).toFixed(1)}s shot ${Math.hypot(vx, vy) | 0} uu/s, line in ${t.toFixed(2)} s: recorded ${rec.padEnd(6)} -> now ${goal ? 'GOAL' : touched ? 'saved' : 'no goal (shot missed)'}`);
  }
}
console.log(`recorded human shots on target at the boss's goal, replayed into the current boss: ${n}; conceded ${conceded}, stopped ${saved} (of the ${wasGoal} that were goals in the games, ${nowGoalOfThose} are now stopped)`);
