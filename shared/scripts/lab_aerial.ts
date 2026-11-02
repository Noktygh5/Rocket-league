// Lab: does the boss take aerials? Drops a high ball in front of the boss with nobody else around.
// Usage: npx tsx scripts/lab_aerial.ts [height=700] [distance=1500]
import { GameSim, Phase, createBot, defaultConfig } from '../src';

const height = Number(process.argv[2] ?? 700), dist = Number(process.argv[3] ?? 1500);
const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'boss' }, { team: 1, name: 'idle' }], 9), matchLength: 60, skipReplay: true });
const boss = createBot('ultrahard', sim, 0, 9) as ReturnType<typeof createBot> & { stats?: Record<string, number>; bestAerial?: number; bestGround?: number };
while (sim.phase !== Phase.Playing) sim.step();
const car = sim.cars[0];
// boss on the ground in its half, ball hanging above the middle, opponent parked far away
car.pos.x = 0; car.pos.y = -2500; car.vel.y = 800;
sim.ball.pos.x = 400; sim.ball.pos.y = -2500 + dist; sim.ball.pos.z = height;
sim.ball.vel.x = 0; sim.ball.vel.y = 400; sim.ball.vel.z = Number(process.argv[4] ?? 200);
sim.cars[1].pos.x = 3000; sim.cars[1].pos.y = 6500;
let touched = false, tTouch = 0, maxZ = 0;
for (let i = 0; i < 120 * 5; i++) {
  boss.think();
  sim.step();
  maxZ = Math.max(maxZ, car.pos.z);
  if (!touched && car.lastTouchTick >= 0) { touched = true; tTouch = i / 120; }
  if (i % 60 === 0) console.log(`t=${(i / 120).toFixed(2)} mode=${boss.debug.mode} car z=${car.pos.z.toFixed(0)} ball z=${sim.ball.pos.z.toFixed(0)} boost=${car.boost.toFixed(0)} best ground ${boss.bestGround?.toFixed(0)} aerial ${boss.bestAerial?.toFixed(0)}`);
}
console.log(`touched ${touched} at ${tTouch.toFixed(2)}s, car peak height ${maxZ.toFixed(0)}, stats ${JSON.stringify(boss.stats)}`);
