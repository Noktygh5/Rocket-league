// Lab: pointless jumping. Counts the boss's jump presses and how many are NOT followed by a ball touch (by it) within 1.2 s, per minute of play.
// Usage: npx tsx scripts/lab_jumps.ts [opponent=hard|v2|idle|newbie] [matches=4] [seconds=120] [seedBase=1]
import { GameSim, Phase, createBot, defaultConfig } from '../src';
import { BossV2 } from './boss_v2';
const opp = process.argv[2] ?? 'hard', n = Number(process.argv[3] ?? 4), secs = Number(process.argv[4] ?? 120), seedBase = Number(process.argv[5] ?? 1);
let presses = 0, aimless = 0, play = 0, touches = 0; const why: Record<string, number> = {};
for (let i = 0; i < n; i++) {
  const bi = i % 2, oi = 1 - bi;
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'a' }, { team: 1, name: 'b' }], 600 + seedBase + i), matchLength: secs, skipReplay: true });
  const boss: any = createBot('ultrahard', sim, bi, 600 + seedBase + i);
  const other: any = opp === 'v2' ? new BossV2(sim, oi) : opp === 'idle' ? null : createBot(opp === 'newbie' ? 'easy' : 'hard', sim, oi, 700 + seedBase + i);
  const k = sim.cars[bi];
  let t = 0, prev = false, lastTouch = -1; const pend: { t: number; why: string }[] = [];
  while (sim.phase !== Phase.Ended && t < secs * 120 + 7200) {
    boss.think(); other?.think(); sim.step(); t++;
    if (sim.overtime) break;
    if (sim.phase !== Phase.Playing) { pend.length = 0; prev = false; continue; }
    play++;
    const j = sim.inputs[bi].jump;
    if (j && !prev) { presses++; const ex = boss.ex; const b = sim.ball; const d = Math.hypot(b.pos.x - k.pos.x, b.pos.y - k.pos.y); pend.push({ t, why: `${boss.fakeT > 0 ? 'fake' : k.onGround ? 'from-ground' : 'in-air'} plan${boss.plan.kind} jumpHold${boss.ex.jumpHold > 0 ? '>0' : '0'} dodge${boss.ex.dodge} inAerial${boss.ex.inAerial ? 1 : 0} planT${boss.plan.contactT - t / 120 > 0.1 ? '+' : boss.plan.contactT - t / 120 > -0.5 ? '~0' : 'stale'} z${k.pos.z > 300 ? 'high' : 'low'} b${k.boost > 10 ? 'ok' : '0'}` }); }
    prev = j;
    if (k.lastTouchTick !== lastTouch && k.lastTouchTick >= 0) { lastTouch = k.lastTouchTick; touches++; while (pend.length) pend.pop(); }
    while (pend.length && t - pend[0].t > 264) { aimless++; const w = pend.shift()!.why; why[w] = (why[w] ?? 0) + 1; }
  }
}
const mins = play / 120 / 60;
console.log(Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `   ${v} x ${k}`).join('\n'));
console.log(`boss vs ${opp}: ${(presses / mins).toFixed(1)} jump presses/min, ${(aimless / mins).toFixed(1)}/min with no touch within 2.2 s (${(100 * aimless / Math.max(1, presses)).toFixed(0)}% of presses), touches/min ${(touches / mins).toFixed(1)}`);
