// Usage: npx tsx scripts/botladder.ts [matches=50] [seconds=120]
// Plays every pairing headlessly, swapping sides each match, and prints goals per minute.
import { BotLevel } from '../src/bot/bot';
import { runBotMatch } from '../src/bot/headless';

const matches = Number(process.argv[2] ?? 50);
const seconds = Number(process.argv[3] ?? 120);
const pairs: [BotLevel, BotLevel][] = [['medium', 'easy'], ['hard', 'medium'], ['hard', 'easy']];

let ok = true;
for (const [strong, weak] of pairs) {
  let gs = 0, gw = 0, wins = 0, losses = 0, draws = 0;
  const t0 = Date.now();
  for (let i = 0; i < matches; i++) {
    const strongBlue = i % 2 === 0;
    const r = strongBlue ? runBotMatch(strong, weak, seconds, 100 + i) : runBotMatch(weak, strong, seconds, 100 + i);
    const s = strongBlue ? r.goals[0] : r.goals[1], w = strongBlue ? r.goals[1] : r.goals[0];
    gs += s; gw += w;
    if (s > w) wins++; else if (s < w) losses++; else draws++;
  }
  const mins = (matches * seconds) / 60;
  console.log(
    `${strong.padEnd(6)} vs ${weak.padEnd(6)} | W${wins} D${draws} L${losses} | goals ${gs}-${gw} | ${(gs / mins).toFixed(2)} vs ${(gw / mins).toFixed(2)} goals/min | ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  if (wins <= losses) ok = false;
}
console.log(ok ? 'LADDER OK: hard > medium > easy' : 'LADDER FAILED');
process.exit(ok ? 0 : 1);
