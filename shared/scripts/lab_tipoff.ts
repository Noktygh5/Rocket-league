// Lab: who wins the tip-off (kickoff)? Plays the first N seconds of a kickoff between two bots and reports
// where the ball is and who touched it first. Positive field position = toward the first bot's attack.
// Usage: npx tsx scripts/lab_tipoff.ts [botA=ultrahard] [botB=hard] [kickoffs=40] [seconds=6]
import { BotLevel, GameSim, Phase, createBot, defaultConfig } from '../src';

const a = (process.argv[2] ?? 'ultrahard') as BotLevel, b = (process.argv[3] ?? 'hard') as BotLevel;
const n = Number(process.argv[4] ?? 40), secs = Number(process.argv[5] ?? 6);
let firstA = 0, firstB = 0, none = 0, sumField = 0, aheadA = 0, goalsA = 0, goalsB = 0;
for (let i = 0; i < n; i++) {
  const aBlue = i % 2 === 0;
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'x' }, { team: 1, name: 'y' }], 4000 + i), matchLength: 60, skipReplay: true });
  const ia = aBlue ? 0 : 1, ib = aBlue ? 1 : 0;
  const ba = createBot(a, sim, ia, 4000 + i), bb = createBot(b, sim, ib, 4001 + i);
  while (sim.phase !== Phase.Playing) sim.step();
  let first = -1;
  let tA = -1, tB = -1;
  const att = aBlue ? 1 : -1; // direction of A's attack along y
  for (let t = 0; t < secs * 120; t++) {
    ba.think(); bb.think(); sim.step();
    if (tA < 0 && sim.cars[ia].lastTouchTick >= 0) tA = t / 120;
    if (tB < 0 && sim.cars[ib].lastTouchTick >= 0) tB = t / 120;
    if (first < 0) {
      if (sim.cars[ia].lastTouchTick >= 0) first = ia; else if (sim.cars[ib].lastTouchTick >= 0) first = ib;
    }
    if (sim.phase !== Phase.Playing) break;
  }
  if (process.argv[6] === 'v') console.log(`kickoff ${i}: ${a} first touch ${tA.toFixed(2)}s, ${b} first touch ${tB.toFixed(2)}s, ball y*att at end ${(sim.ball.pos.y * att).toFixed(0)}`);
  if (first === ia) firstA++; else if (first === ib) firstB++; else none++;
  const field = sim.ball.pos.y * att;
  sumField += field;
  if (field > 0) aheadA++;
  if (sim.score[ia] > 0) goalsA++;
  if (sim.score[ib] > 0) goalsB++;
}
console.log(`${a} vs ${b}, ${n} kickoffs, ${secs}s each: first touch ${a} ${firstA} / ${b} ${firstB} / nobody ${none}; ball ends on ${a}'s attacking side ${aheadA}/${n}, mean field position ${(sumField / n).toFixed(0)} uu; goals within ${secs}s: ${a} ${goalsA}, ${b} ${goalsB}`);
