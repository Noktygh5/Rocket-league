// Lab: a boss against a "new player": drives slowly at the ball and pushes it, no boost, a hop now and then.
// Counts goals, boss hops (jump presses), boss touches, and the share of ticks in each plan mode. Usage: npx tsx scripts/lab_newbie.ts [boss=current|v2] [matches=6] [seconds=90] [v]
import { GameSim, Phase, createBot, defaultConfig, ARENA } from '../src';
import { BossV2 } from './boss_v2';
const which = process.argv[2] ?? 'current', n = Number(process.argv[3] ?? 6), secs = Number(process.argv[4] ?? 90);
let hg = 0, bg = 0, hops = 0, touches = 0, ticksAll = 0; const modes: Record<number, number> = {};
for (let i = 0; i < n; i++) {
  const bi = i % 2, hi = 1 - bi;
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'a' }, { team: 1, name: 'b' }], 800 + i), matchLength: secs, skipReplay: process.env.REPLAY ? false : true });
  const boss: any = which === 'v2' ? new BossV2(sim, bi) : createBot('ultrahard', sim, bi, 800 + i);
  const att = sim.cars[hi].team === 0 ? 1 : -1;
  let t = 0, prevJump = false, lastTouch = -1;
  while (sim.phase !== Phase.Ended && t < secs * 120 + 7200) {
    boss.think();
    // the "human": steer at the ball, throttle 0.6, aim it at the boss's goal by approaching from the other side
    const h = sim.cars[hi], inp = sim.inputs[hi]; inp.clear();
    if (sim.phase === Phase.Playing && !h.demolished) {
      const b = sim.ball, m = h.basis.m;
      const gx = 0, gy = att * ARENA.halfLength;
      let ux = gx - b.pos.x, uy = gy - b.pos.y; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      const tx = b.pos.x - ux * 250, ty = b.pos.y - uy * 250;
      const dx = tx - h.pos.x, dy = ty - h.pos.y;
      const ang = Math.atan2(dx * m[1] + dy * m[4], dx * m[0] + dy * m[3]);
      inp.steer = Math.max(-1, Math.min(1, -ang * 2)); inp.throttle = Math.abs(ang) > 1 ? 0.3 : 0.7;
      if (t % 500 < 6 && Math.hypot(b.pos.x - h.pos.x, b.pos.y - h.pos.y) < 700) inp.jump = true;
    }
    sim.step(); t++; ticksAll++;
    const bj = sim.inputs[bi].jump; if (bj && !prevJump && sim.phase === Phase.Playing) hops++; prevJump = bj;
    if (sim.phase === Phase.Playing) modes[boss.debug.mode] = (modes[boss.debug.mode] ?? 0) + 1;
    if (sim.overtime) break;
  }
  bg += sim.score[bi]; hg += sim.score[hi]; if (sim.cars[bi].lastTouchTick >= 0) touches++;
}
console.log(`${which} vs newbie: boss ${bg} - ${hg} human over ${n} matches, boss hops ${hops}, modes ${JSON.stringify(modes)}`);
