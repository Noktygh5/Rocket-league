// Lab: staying in one place. Per tick of play, the boss counts as "dwelling" when its horizontal speed is under 250 uu/s and the ball is more
// than 1,500 uu away (it is not a touch or a challenge). Prints the share of time, split into on the ground / in the air, and by plan mode,
// plus the longest dwell. Usage: npx tsx scripts/lab_dwell.ts [opponent=idle|hard|newbie] [matches=4] [seconds=120] [seedBase=1]
import { GameSim, Phase, createBot, defaultConfig } from '../src';
const opp = process.argv[2] ?? 'idle', n = Number(process.argv[3] ?? 4), secs = Number(process.argv[4] ?? 120), seedBase = Number(process.argv[5] ?? 1);
let play = 0, dwellG = 0, dwellA = 0, longest = 0; const modes: Record<string, number> = {};
for (let i = 0; i < n; i++) {
  const bi = i % 2, oi = 1 - bi;
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'a' }, { team: 1, name: 'b' }], 1000 + seedBase + i), matchLength: secs, skipReplay: true });
  const boss: any = createBot('ultrahard', sim, bi, 1000 + seedBase + i);
  const other: any = opp === 'idle' ? null : createBot(opp === 'newbie' ? 'easy' : 'hard', sim, oi, 1100 + seedBase + i);
  const k = sim.cars[bi];
  let t = 0, run = 0;
  while (sim.phase !== Phase.Ended && t < secs * 120 + 7200) {
    boss.think(); other?.think(); sim.step(); t++;
    if (sim.overtime) break;
    if (sim.phase !== Phase.Playing) { run = 0; continue; }
    play++;
    const sp = Math.hypot(k.vel.x, k.vel.y), b = sim.ball, d = Math.hypot(b.pos.x - k.pos.x, b.pos.y - k.pos.y);
    if (sp < 250 && d > 1500) {
      run++; longest = Math.max(longest, run);
      if (k.onGround) dwellG++; else dwellA++;
      const key = `${k.onGround ? 'ground' : 'air'} mode${boss.debug.mode}${boss.reverseTime > 0 ? ' reversing' : ''}${boss.fakeT > 0 ? ' fake' : ''}`;
      modes[key] = (modes[key] ?? 0) + 1;
    } else run = 0;
  }
}
console.log(`boss vs ${opp}: dwelling ${(100 * (dwellG + dwellA) / play).toFixed(1)}% of play (ground ${(100 * dwellG / play).toFixed(1)}%, air ${(100 * dwellA / play).toFixed(1)}%), longest ${(longest / 120).toFixed(1)} s`);
console.log(Object.entries(modes).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `   ${(100 * v / play).toFixed(1)}% ${k}`).join('\n'));
