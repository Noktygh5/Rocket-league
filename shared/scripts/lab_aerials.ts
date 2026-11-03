// Lab: aerial execution accuracy. For every aerial take-off of the boss: plan contact point/time vs what happened - the closest the car
// got to the ball, whether it touched, the ball's error against the plan at the planned time, the car's error against the plan, and boost at take-off.
// Usage: npx tsx scripts/lab_aerials.ts [opponent=idle|hard] [matches=4] [seconds=120] [seedBase=1] [v]
import { GameSim, Phase, createBot, defaultConfig } from '../src';
const opp = process.argv[2] ?? 'idle', n = Number(process.argv[3] ?? 4), secs = Number(process.argv[4] ?? 120), seedBase = Number(process.argv[5] ?? 1);
const rows: any[] = [];
for (let i = 0; i < n; i++) {
  const bi = i % 2, oi = 1 - bi;
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'a' }, { team: 1, name: 'b' }], 800 + seedBase + i), matchLength: secs, skipReplay: true });
  const boss: any = createBot('ultrahard', sim, bi, 800 + seedBase + i);
  const other: any = opp === 'idle' ? null : createBot('hard', sim, oi, 900 + seedBase + i);
  const k = sim.cars[bi];
  let t = 0, wasAir = false; let cur: any = null;
  while (sim.phase !== Phase.Ended && t < secs * 120 + 7200) {
    boss.think(); other?.think(); sim.step(); t++;
    if (sim.overtime) break;
    if (sim.phase !== Phase.Playing) { cur = null; wasAir = false; continue; }
    const inAir = boss.ex.inAerial && !k.onGround;
    if (inAir && !wasAir) {
      const pl = boss.plan;
      cur = { cx: pl.cx, cy: pl.cy, cz: pl.cz, ct: pl.contactT, boost: k.boost, minD: 1e9, touched: false, ballErr: -1, carErr: -1, kind: pl.kind, fast: pl.fast, flip: pl.flip, t0: t / 120, tauPlan: pl.contactT - t / 120, touchTick0: k.lastTouchTick };
    }
    wasAir = inAir;
    if (cur) {
      const b = sim.ball, now = t / 120;
      cur.minD = Math.min(cur.minD, Math.hypot(b.pos.x - k.pos.x, b.pos.y - k.pos.y, b.pos.z - k.pos.z));
      if (k.lastTouchTick !== cur.touchTick0) cur.touched = true;
      if (cur.ballErr < 0 && now >= cur.ct - 0.01) { cur.ballErr = Math.hypot(b.pos.x - cur.cx, b.pos.y - cur.cy, b.pos.z - cur.cz); cur.carErr = Math.hypot(k.pos.x - cur.cx, k.pos.y - cur.cy, k.pos.z - cur.cz); }
      if (now > cur.ct + 0.6 || k.onGround && now > cur.t0 + 0.3) { rows.push(cur); cur = null; }
    }
  }
}
const all = rows.length; rows.splice(0, rows.length, ...rows.filter((r) => r.tauPlan > 0.15 && r.tauPlan < 4 && r.boost >= 10));
console.log(`(${all - rows.length} of ${all} airborne episodes were not planned aerials: bumps, wall exits, stale flag)`);
const ok = rows.filter((r) => r.touched).length;
const med = (a: number[]) => { a = a.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
console.log(`${rows.length} aerial take-offs vs ${opp}: touched ${ok} (${(100 * ok / Math.max(1, rows.length)).toFixed(0)}%)`);
const miss = rows.filter((r) => !r.touched);
console.log(`  misses: median closest approach ${med(miss.map((r) => r.minD)).toFixed(0)} uu, median ball-vs-plan error ${med(miss.filter((r) => r.ballErr >= 0).map((r) => r.ballErr)).toFixed(0)} uu, median car-vs-plan error ${med(miss.filter((r) => r.carErr >= 0).map((r) => r.carErr)).toFixed(0)} uu, median boost at take-off ${med(miss.map((r) => r.boost)).toFixed(0)}, median planned flight ${med(miss.map((r) => r.tauPlan)).toFixed(2)} s`);
console.log(`  hits:   median closest approach ${med(rows.filter((r) => r.touched).map((r) => r.minD)).toFixed(0)} uu, median car-vs-plan error ${med(rows.filter((r) => r.touched && r.carErr >= 0).map((r) => r.carErr)).toFixed(0)} uu, median boost at take-off ${med(rows.filter((r) => r.touched).map((r) => r.boost)).toFixed(0)}`);
