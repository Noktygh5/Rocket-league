// Lab: how good is a bot as the goalkeeper? Fires shots at its goal from random spots and counts saves.
// The shooter does nothing else (the other car is parked far away). A "save" = the ball does not cross
// the line within 6 seconds of the shot. Usage: npx tsx scripts/lab_saves.ts [bot=ultrahard] [shots=60] [seedBase=1]
import { BotLevel, GameSim, Phase, createBot, defaultConfig, placeCar, ARENA } from '../src';
import { Prng } from '../src/prng';

const level = (process.argv[2] ?? 'ultrahard') as BotLevel;
const shots = Number(process.argv[3] ?? 60);
const seedBase = Number(process.argv[4] ?? 1);
let saved = 0, scored = 0, touches = 0, easy = 0, easySaved = 0;
for (let s = 0; s < shots; s++) {
  const rng = new Prng(seedBase * 1000 + s);
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'keeper' }, { team: 1, name: 'shooter' }], 31 + s), matchLength: 120, skipReplay: true });
  const keeper = createBot(level, sim, 0, 31 + s);
  while (sim.phase !== Phase.Playing) sim.step();
  // keeper (blue) defends the goal at -y; the ball is struck from the other half toward it
  const k = sim.cars[0];
  // a keeper waiting in its usual spot: in front of the goal, facing the field
  placeCar(k, (rng.next() - 0.5) * 1200, -ARENA.halfLength + 900 + rng.next() * 1600, Math.PI / 2);
  sim.cars[1].pos.x = 3500; sim.cars[1].pos.y = ARENA.halfLength - 600; // parked, out of the way
  const sx = (rng.next() - 0.5) * 4000, sy = -300 - rng.next() * 2500;
  const tx = (rng.next() - 0.5) * 2 * (ARENA.goal.halfWidth - 150), tz = 90 + rng.next() * 380;
  const dx = tx - sx, dy = -ARENA.halfLength - sy, dz = tz - 100;
  const dl = Math.hypot(dx, dy, dz);
  const sp = 1800 + rng.next() * 2200;
  sim.ball.pos.x = sx; sim.ball.pos.y = sy; sim.ball.pos.z = 100;
  sim.ball.vel.x = dx / dl * sp; sim.ball.vel.y = dy / dl * sp; sim.ball.vel.z = dz / dl * sp;
  const slow = sp < 2600;
  let goal = false;
  const s0 = sim.score[1];
  const modes: number[] = [];
  const startX = k.pos.x, startY = k.pos.y;
  let tGoal = 0, zGoal = 0;
  for (let i = 0; i < 120 * 6; i++) {
    keeper.think(); sim.step();
    if (i % 24 === 0) modes.push(keeper.debug.mode);
    if (sim.score[1] > s0) { goal = true; tGoal = i / 120; zGoal = sim.ball.pos.z; break; }
  }
  if (goal && process.argv[5] === 'v') {
    console.log(`MISS shot ${s}: speed ${sp.toFixed(0)} target z ${tz.toFixed(0)} | keeper started (${startX.toFixed(0)},${startY.toFixed(0)}) ball started (${sx.toFixed(0)},${sy.toFixed(0)}) | goal at ${tGoal.toFixed(2)}s, ball z at the line ${zGoal.toFixed(0)} | modes ${modes.join('')}`);
  }
  if (sim.cars[0].lastTouchTick >= 0) touches++;
  if (goal) scored++; else saved++;
  if (slow) { easy++; if (!goal) easySaved++; }
}
console.log(`${level} as keeper: saved ${saved}/${shots} (${(100 * saved / shots).toFixed(0)}%), touched the ball ${touches} times | slower shots (<2600): ${easySaved}/${easy}`);
console.log(`RESULT ${saved} ${shots}`);
