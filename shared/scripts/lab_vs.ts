// Lab: a boss (current | v2) against a built-in bot level. Usage: npx tsx scripts/lab_vs.ts [boss=current] [level=easy] [matches=8] [seconds=120] [seedBase=700]
import { GameSim, Phase, createBot, defaultConfig } from '../src';
import { BossV2 } from './boss_v2';
const which = process.argv[2] ?? 'current', level = (process.argv[3] ?? 'easy') as any;
const n = Number(process.argv[4] ?? 8), secs = Number(process.argv[5] ?? 120), seedBase = Number(process.argv[6] ?? 700);
let w = 0, d = 0, l = 0, g = 0, c = 0, touches = 0;
for (let i = 0; i < n; i++) {
  const bi = i % 2, oi = 1 - bi;
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'a' }, { team: 1, name: 'b' }], seedBase + i), matchLength: secs, skipReplay: true });
  const boss: any = which === 'v2' ? new BossV2(sim, bi) : createBot('ultrahard', sim, bi, seedBase + i);
  const other = createBot(level, sim, oi, seedBase + 50 + i);
  let t = 0;
  while (sim.phase !== Phase.Ended && t < secs * 120 + 7200) { boss.think(); other.think(); sim.step(); t++; if (sim.overtime) break; }
  const a = sim.score[bi], b = sim.score[oi]; g += a; c += b; if (a > b) w++; else if (b > a) l++; else d++;
  if (sim.cars[bi].lastTouchTick >= 0) touches++;
}
console.log(`${which} vs ${level}: W${w} D${d} L${l} goals ${g}-${c}`);
