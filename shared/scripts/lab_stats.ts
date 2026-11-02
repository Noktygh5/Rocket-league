// Lab: what does a bot-vs-bot match look like? Usage: npx tsx scripts/lab_stats.ts [a=hard] [b=hard] [matches=10] [seconds=120]
import { BotLevel } from '../src/bot/bot';
import { runBotMatch } from '../src/bot/headless';

const a = (process.argv[2] ?? 'hard') as BotLevel, b = (process.argv[3] ?? 'hard') as BotLevel;
const n = Number(process.argv[4] ?? 10), secs = Number(process.argv[5] ?? 120);
const seedBase = Number(process.argv[7] ?? 500);
let ga = 0, gb = 0, ta = 0, tb = 0, wa = 0, wb = 0, d = 0;
for (let i = 0; i < n; i++) {
  const aBlue = i % 2 === 0;
  const r = aBlue ? runBotMatch(a, b, secs, seedBase + i) : runBotMatch(b, a, secs, seedBase + i);
  const sa = aBlue ? r.goals[0] : r.goals[1], sb = aBlue ? r.goals[1] : r.goals[0];
  if (process.argv[6] === 'v') console.log(`match ${i} (${a} ${aBlue ? 'blue' : 'orange'}): ${sa}-${sb}  touches ${aBlue ? r.touches[0] : r.touches[1]} vs ${aBlue ? r.touches[1] : r.touches[0]}`);
  ga += sa; gb += sb; ta += aBlue ? r.touches[0] : r.touches[1]; tb += aBlue ? r.touches[1] : r.touches[0];
  if (sa > sb) wa++; else if (sb > sa) wb++; else d++;
}
console.log(`${a} vs ${b}: W${wa} D${d} L${wb} | goals ${ga}-${gb} | touches/match ${(ta / n).toFixed(1)} vs ${(tb / n).toFixed(1)}`);
