// "Training set" from the recorded games: for every goal in the chosen recordings (default: the 5 selected full matches), replay the lead-up into the
// CURRENT boss. The state is loaded from the telemetry WINDOW seconds before the goal, the human's car is driven by the human's own recorded inputs,
// and the boss plays its side. Reports whether a goal the boss conceded is still conceded, and whether a goal the boss scored is still scored.
// It is a counterfactual (the human's inputs were a reaction to the old boss, so they drift off-policy after a few seconds): use it as a signal, not a proof.
// Usage (from shared/): npx tsx scripts/replay_goals.ts [WINDOW=8] [folder ...]    VERBOSE=1 prints a line per goal
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GameSim, Phase, createBot, defaultConfig, placeCar } from '../src';
const args = process.argv.slice(2);
const WINDOW = Number(args[0] && !isNaN(Number(args[0])) ? args.shift() : 8);
const root = join(process.cwd(), '..', 'Recordings');
const SELECTED = ['2026-11-03_11-14-39', '2026-11-03_11-18-32', '2026-11-03_11-38-12', '2026-11-03_11-42-08', '2026-11-03_14-18-43']; // last 5 full matches (the only boss loss is the first)
const dirs = args.length ? args : SELECTED.map((d) => join(root, `${d}_ultrahard`)).filter((d) => existsSync(d));
let cN = 0, cStill = 0, sN = 0, sStill = 0; const lines: string[] = [];
for (const dir of dirs) {
  const rows: any[] = readFileSync(join(dir, 'telemetry.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const ticks = rows.filter((r) => r.k === 't');
  const goals = rows.filter((r) => r.k === 'e' && r.type === 'goal');
  for (const g of goals) {
    const conceded = g.a === 0;                                    // the human (blue, team 0) scored
    // start: WINDOW s before the goal, but not before the last non-play frame (kickoff, goal, countdown) + 0.5 s
    let startTick = g.tick - Math.round(WINDOW * 120);
    for (const r of ticks) if (r.tick < g.tick && r.ph !== 1) startTick = Math.max(startTick, r.tick + 60);
    const first = ticks.find((r) => r.tick >= startTick && r.ph === 1); if (!first || g.tick - first.tick < 240) continue;
    const upto = ticks.filter((r) => r.tick >= first.tick && r.tick <= g.tick + 120);
    const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'human' }, { team: 1, name: 'boss' }], 77), matchLength: 600, skipReplay: true });
    const boss: any = createBot('ultrahard', sim, 1, 77);
    while (sim.phase !== Phase.Playing) sim.step();
    for (const [i, d] of first.cars.entries()) { placeCar(sim.cars[i], d.p[0], d.p[1], Math.atan2(d.f[1], d.f[0])); const c = sim.cars[i]; c.pos.z = Math.max(c.pos.z, d.p[2]); c.vel.x = d.v[0]; c.vel.y = d.v[1]; c.vel.z = d.v[2]; c.boost = d.b; }
    const b = first.ball; sim.ball.pos.x = b[0]; sim.ball.pos.y = b[1]; sim.ball.pos.z = b[2]; sim.ball.vel.x = b[3]; sim.ball.vel.y = b[4]; sim.ball.vel.z = b[5];
    const s0 = [sim.score[0], sim.score[1]];
    let gotHuman = false, gotBoss = false, idx = 0;
    const total = g.tick + 120 - first.tick;
    for (let t = 0; t < total; t++) {
      while (idx + 1 < upto.length && upto[idx + 1].tick <= first.tick + t) idx++;
      const inp = upto[idx].cars[0].in;                           // the human's recorded input at this moment: throttle, steer, pitch, yaw, roll, jump, boost, handbrake
      const hi = sim.inputs[0]; hi.clear(); hi.throttle = inp[0]; hi.steer = inp[1]; hi.pitch = inp[2]; hi.yaw = inp[3]; hi.roll = inp[4]; hi.jump = !!inp[5]; hi.boost = !!inp[6]; hi.handbrake = !!inp[7];
      boss.think(); sim.step();
      if (sim.score[0] > s0[0]) gotHuman = true;
      if (sim.score[1] > s0[1]) gotBoss = true;
      if (gotHuman || gotBoss) break;
    }
    const tag = `${dir.slice(-25, -10)} ${(g.tick / 120).toFixed(1)}s`;
    if (conceded) { cN++; if (gotHuman) cStill++; lines.push(`  ${tag} CONCEDED in the game -> now ${gotHuman ? 'conceded again' : gotBoss ? 'the BOSS scores instead' : 'no goal'}`); }
    else { sN++; if (gotBoss) sStill++; lines.push(`  ${tag} boss SCORED in the game  -> now ${gotBoss ? 'scores again' : gotHuman ? 'the HUMAN scores' : 'no goal'}`); }
  }
}
if (process.env.VERBOSE) console.log(lines.join('\n'));
console.log(`replayed lead-ups (${WINDOW} s, human driven by its recorded inputs): goals conceded in the games ${cN} -> still conceded ${cStill}; goals the boss scored ${sN} -> still scored ${sStill}`);
