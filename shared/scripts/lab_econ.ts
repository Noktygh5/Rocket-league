// Lab: boost economy and activity, current boss vs frozen round-2 boss. Usage: npx tsx scripts/lab_econ.ts [matches=4] [seconds=120] [seedBase=3000]
import { GameSim, Phase, createBot, defaultConfig } from '../src';
import { BossV2 } from './boss_v2';
const n = Number(process.argv[2] ?? 4), secs = Number(process.argv[3] ?? 120), seedBase = Number(process.argv[4] ?? 3000);
const st = [0, 1].map(() => ({ boost: 0, zero: 0, t: 0, pickups: 0, touches: 0, airTicks: 0, ownHalf: 0, wall: 0, idle: 0 }));
for (let i = 0; i < n; i++) {
  const newBlue = i % 2 === 0;
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'a' }, { team: 1, name: 'b' }], seedBase + i), matchLength: secs, skipReplay: true });
  const ni = newBlue ? 0 : 1, oi = 1 - ni;
  const nb: any = createBot('ultrahard', sim, ni, seedBase + i);
  const ob: any = new BossV2(sim, oi);
  const prev = [sim.cars[ni].boost, sim.cars[oi].boost];
  const lastT = [-1, -1];
  let ticks = 0;
  while (sim.phase !== Phase.Ended && ticks < secs * 120 + 7200) {
    nb.think(); ob.think(); sim.step(); ticks++;
    if (sim.overtime) break;
    if (sim.phase !== Phase.Playing) continue;
    [ni, oi].forEach((ci, k) => {
      const c = sim.cars[ci], s = st[k];
      s.t++; s.boost += c.boost; if (c.boost < 1) s.zero++;
      if (c.boost > prev[k] + 5) s.pickups++;
      prev[k] = c.boost;
      if (c.lastTouchTick !== lastT[k] && c.lastTouchTick >= 0) { s.touches++; lastT[k] = c.lastTouchTick; }
      if (!c.onGround) s.airTicks++;
      if (c.onGround && c.pos.z > 350) s.wall++;
      if (c.lastTouchTick < 0 || sim.tick - c.lastTouchTick > 8 * 120) s.idle++;
      const att = c.team === 0 ? 1 : -1;
      if (c.pos.y * att < 0) s.ownHalf++;
    });
  }
}
['NEW', 'OLD'].forEach((nm, k) => { const s = st[k]; console.log(`${nm}: avg boost ${(s.boost / s.t).toFixed(1)}, at zero ${(100 * s.zero / s.t).toFixed(0)}%, pickups/match ${(s.pickups / n).toFixed(1)}, touches/match ${(s.touches / n).toFixed(1)}, airborne ${(100 * s.airTicks / s.t).toFixed(0)}%, in own half ${(100 * s.ownHalf / s.t).toFixed(0)}%, on a wall above 350: ${(100 * s.wall / s.t).toFixed(1)}%, no touch for 8 s+: ${(100 * s.idle / s.t).toFixed(0)}%`); });
