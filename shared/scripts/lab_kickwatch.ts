// Lab: watch the first seconds of a kickoff from the boss's point of view.
// Usage: npx tsx scripts/lab_kickwatch.ts [opponent=hard] [seconds=5]
import { BotLevel, GameSim, Phase, createBot, defaultConfig } from '../src';

const opp = (process.argv[2] ?? 'hard') as BotLevel, secs = Number(process.argv[3] ?? 5);
const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'boss' }, { team: 1, name: 'opp' }], 4000), matchLength: 60, skipReplay: true });
const boss = createBot('ultrahard', sim, 0, 4000) as ReturnType<typeof createBot> & { stats?: Record<string, number> };
const other = createBot(opp, sim, 1, 4001);
while (sim.phase !== Phase.Playing) sim.step();
for (let t = 0; t < secs * 120; t++) {
  boss.think(); other.think(); sim.step();
  if (t % 30 === 0) {
    const c = sim.cars[0], o = sim.cars[1];
    console.log(`t=${(t / 120).toFixed(2)} mode=${boss.debug.mode} boss pos(${c.pos.x.toFixed(0)},${c.pos.y.toFixed(0)},${c.pos.z.toFixed(0)}) speed ${Math.hypot(c.vel.x, c.vel.y).toFixed(0)} boost ${c.boost.toFixed(0)} ground ${c.onGround} | opp pos(${o.pos.x.toFixed(0)},${o.pos.y.toFixed(0)}) speed ${Math.hypot(o.vel.x, o.vel.y).toFixed(0)} | ball(${sim.ball.pos.x.toFixed(0)},${sim.ball.pos.y.toFixed(0)},${sim.ball.pos.z.toFixed(0)})`);
  }
}
console.log(JSON.stringify(boss.stats));
