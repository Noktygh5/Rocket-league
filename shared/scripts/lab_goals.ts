// Lab: why does the boss concede? Plays current vs frozen round-2 boss, and on every goal against the current boss
// prints the last 2.5 s (every 0.5 s): both cars, the ball, boost, modes. Usage: npx tsx scripts/lab_goals.ts [matches=6] [seconds=120] [seedBase=3000]
import { GameSim, Phase, createBot, defaultConfig } from '../src';
import { BossV2 } from './boss_v2';
const n = Number(process.argv[2] ?? 6), secs = Number(process.argv[3] ?? 120), seedBase = Number(process.argv[4] ?? 3000);
for (let i = 0; i < n; i++) {
  const newBlue = i % 2 === 0;
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'a' }, { team: 1, name: 'b' }], seedBase + i), matchLength: secs, skipReplay: true });
  const ni = newBlue ? 0 : 1, oi = 1 - ni;
  const nb: any = createBot('ultrahard', sim, ni, seedBase + i);
  const ob: any = new BossV2(sim, oi);
  const ring: string[] = [];
  let ticks = 0, sN = 0, sO = 0;
  while (sim.phase !== Phase.Ended && ticks < secs * 120 + 7200) {
    nb.think(); ob.think(); sim.step(); ticks++;
    if (sim.overtime) break;
    const a = sim.cars[ni], o = sim.cars[oi], b = sim.ball;
    if (sim.phase === Phase.Playing && ticks % 60 === 0) {
      ring.push(`${(ticks / 120).toFixed(1)}s NEW(${a.pos.x | 0},${a.pos.y | 0},z${a.pos.z | 0} b${a.boost | 0} m${nb.debug.mode} v${Math.hypot(a.vel.x, a.vel.y) | 0}) OLD(${o.pos.x | 0},${o.pos.y | 0},z${o.pos.z | 0} b${o.boost | 0}) ball(${b.pos.x | 0},${b.pos.y | 0},${b.pos.z | 0} v${Math.hypot(b.vel.x, b.vel.y) | 0}) lastTouch new${((ticks - a.lastTouchTick) / 120).toFixed(1)} old${((ticks - o.lastTouchTick) / 120).toFixed(1)}`);
      if (ring.length > 6) ring.shift();
    }
    if (sim.score[ni] > sN) { sN = sim.score[ni]; console.log(`--- match ${i}: NEW SCORED (${sN}-${sO})`); ring.length = 0; }
    if (sim.score[oi] > sO) { sO = sim.score[oi]; console.log(`--- match ${i}: NEW CONCEDED (${sN}-${sO}) new is ${newBlue ? 'blue(def -y)' : 'orange(def +y)'}\n  ` + ring.join('\n  ')); ring.length = 0; }
  }
}
