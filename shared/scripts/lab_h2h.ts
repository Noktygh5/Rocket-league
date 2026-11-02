// Lab: current boss vs the frozen first version (boss_v1.ts), sides swapped each match.
// Usage: npx tsx scripts/lab_h2h.ts [matches=20] [seconds=120] [v]
import { GameSim, Phase, createBot, defaultConfig } from '../src';
import { BossV1 } from './boss_v1';

const n = Number(process.argv[2] ?? 20), secs = Number(process.argv[3] ?? 120);
const seedBase = Number(process.argv[5] ?? 900);
let gn = 0, go = 0, wn = 0, wo = 0, d = 0;
for (let i = 0; i < n; i++) {
  const newBlue = i % 2 === 0;
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'a' }, { team: 1, name: 'b' }], seedBase + i), matchLength: secs, skipReplay: true });
  const newIdx = newBlue ? 0 : 1, oldIdx = newBlue ? 1 : 0;
  const nb = createBot('ultrahard', sim, newIdx, seedBase + i);
  const ob = new BossV1(sim, oldIdx);
  let ticks = 0;
  while (sim.phase !== Phase.Ended && ticks < secs * 120 + 7200) {
    if (i % 4 < 2) { nb.think(); ob.think(); } else { ob.think(); nb.think(); } // alternate who thinks first
    sim.step(); ticks++;
    if (sim.overtime) break;
  }
  const sn = sim.score[newIdx], so = sim.score[oldIdx];
  gn += sn; go += so;
  if (sn > so) wn++; else if (so > sn) wo++; else d++;
  if (process.argv[4] === 'v') console.log(`match ${i}: new ${sn} - old ${so}`);
}
console.log(`new boss vs first boss: W${wn} D${d} L${wo} | goals ${gn}-${go}`);
console.log(`RESULT ${wn} ${d} ${wo} ${gn} ${go}`);
