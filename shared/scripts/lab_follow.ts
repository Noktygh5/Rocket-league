// Lab: does the boss stay with the ball? For every boss touch: its distance to the ball 1.5 s and 3 s later, and whether it touches the
// ball again within 4 s (follow-up) before the opponent does. Also the share of time it is within 1500 uu of the ball.
// Usage: npx tsx scripts/lab_follow.ts [level=hard|v2] [matches=6] [seconds=120] [seedBase=1]
import { GameSim, Phase, createBot, defaultConfig } from '../src';
import { BossV2 } from './boss_v2';
const level = process.argv[2] ?? 'hard', n = Number(process.argv[3] ?? 6), secs = Number(process.argv[4] ?? 120), seedBase = Number(process.argv[5] ?? 1);
let touches = 0, d15 = 0, d30 = 0, follow = 0, near = 0, ticksAll = 0, gf = 0, ga = 0;
for (let i = 0; i < n; i++) {
  const bi = i % 2, oi = 1 - bi;
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'a' }, { team: 1, name: 'b' }], 300 + seedBase + i), matchLength: secs, skipReplay: true });
  const boss: any = createBot('ultrahard', sim, bi, 300 + seedBase + i);
  const other: any = level === 'v2' ? new BossV2(sim, oi) : createBot('hard', sim, oi, 500 + seedBase + i);
  const k = sim.cars[bi], o = sim.cars[oi];
  let t = 0, lastB = -1; const pend: { t: number; done15: boolean; done30: boolean; open: boolean }[] = [];
  let lastO = -1;
  while (sim.phase !== Phase.Ended && t < secs * 120 + 7200) {
    boss.think(); other.think(); sim.step(); t++;
    if (sim.overtime) break;
    if (sim.phase !== Phase.Playing) { pend.length = 0; continue; }
    ticksAll++;
    const b = sim.ball;
    if (Math.hypot(b.pos.x - k.pos.x, b.pos.y - k.pos.y) < 1500) near++;
    if (k.lastTouchTick !== lastB && k.lastTouchTick >= 0) {
      if (lastB >= 0) for (const p of pend) if (p.open && t - p.t <= 480) { follow++; p.open = false; }
      lastB = k.lastTouchTick; touches++; pend.push({ t, done15: false, done30: false, open: true });
    }
    if (o.lastTouchTick !== lastO && o.lastTouchTick >= 0) { lastO = o.lastTouchTick; for (const p of pend) p.open = false; }
    for (const p of pend) {
      const dist = Math.hypot(b.pos.x - k.pos.x, b.pos.y - k.pos.y);
      if (!p.done15 && t - p.t >= 180) { p.done15 = true; d15 += dist; }
      if (!p.done30 && t - p.t >= 360) { p.done30 = true; d30 += dist; }
    }
    while (pend.length > 0 && t - pend[0].t > 480) pend.shift();
  }
  gf += sim.score[bi]; ga += sim.score[oi];
}
console.log(`boss vs ${level}: ${touches} touches | distance to ball 1.5 s later ${(d15 / Math.max(1, touches)).toFixed(0)} uu, 3 s later ${(d30 / Math.max(1, touches)).toFixed(0)} uu | follow-up touch within 4 s (before the opponent's) ${(100 * follow / Math.max(1, touches)).toFixed(0)}% | within 1500 uu of the ball ${(100 * near / ticksAll).toFixed(0)}% of the time | goals ${gf}-${ga}`);
