// Lab: where does the time go in a boss-vs-hard match? Usage: npx tsx scripts/lab_profile.ts [seconds=120]
import { GameSim, Phase, createBot, defaultConfig } from '../src';

const seconds = Number(process.argv[2] ?? 120);
const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'boss' }, { team: 1, name: 'hard' }], 501), matchLength: seconds, skipReplay: true });
const boss = createBot('ultrahard', sim, 0, 501) as ReturnType<typeof createBot> & { stats?: Record<string, number> };
const hard = createBot('hard', sim, 1, 502);
let tBoss = 0, tHard = 0, tSim = 0, ticks = 0;
let worst = 0;
const modes = [0, 0, 0, 0, 0];
while (sim.phase !== Phase.Ended && ticks < seconds * 120 + 7200) {
  let t = performance.now();
  boss.think();
  if (sim.phase === Phase.Playing) modes[boss.debug.mode]++;
  const dtBoss = performance.now() - t;
  tBoss += dtBoss; worst = Math.max(worst, dtBoss);
  t = performance.now(); hard.think(); tHard += performance.now() - t;
  t = performance.now(); sim.step(); tSim += performance.now() - t;
  ticks++;
  if (sim.overtime) break;
}
const secs = ticks / 120;
console.log(`${secs.toFixed(0)} s of game: boss ${tBoss.toFixed(0)} ms (${(tBoss / secs).toFixed(1)} ms per game second, worst single tick ${worst.toFixed(1)} ms), hard ${tHard.toFixed(0)} ms, physics ${tSim.toFixed(0)} ms`);
const tot = modes.reduce((a, b) => a + b, 0) || 1;
console.log(`time in plan: drive ${(100 * modes[0] / tot).toFixed(0)}%  strike ${(100 * modes[1] / tot).toFixed(0)}%  aerial ${(100 * modes[2] / tot).toFixed(0)}%  pad ${(100 * modes[3] / tot).toFixed(0)}%  shadow ${(100 * modes[4] / tot).toFixed(0)}%`);
console.log(`decisions: ${JSON.stringify(boss.stats)}`);
console.log(`score ${sim.score[0]}-${sim.score[1]}`);
