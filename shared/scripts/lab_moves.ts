// Lab: what moves does the boss actually pull off? Counts its ball touches by type over several matches.
// Usage: npx tsx scripts/lab_moves.ts [matches=12] [seconds=120] [opponent=hard]
import { BotLevel, GameSim, Phase, SimEvent, createBot, defaultConfig } from '../src';

const n = Number(process.argv[2] ?? 12), secs = Number(process.argv[3] ?? 120);
const opp = (process.argv[4] ?? 'hard') as BotLevel;
const c = { touches: 0, ground: 0, flipTouch: 0, aerial: 0, highAerial: 0, goals: 0, aerialGoals: 0, maxHeight: 0, shotsOnGoal: 0 };
const ev: SimEvent[] = [];
for (let m = 0; m < n; m++) {
  const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'boss' }, { team: 1, name: opp }], 700 + m), matchLength: secs, skipReplay: true });
  const boss = createBot('ultrahard', sim, 0, 700 + m);
  const other = createBot(opp, sim, 1, 701 + m);
  let ticks = 0;
  while (sim.phase !== Phase.Ended && ticks < secs * 120 + 7200) {
    boss.think(); other.think(); sim.step(); ticks++;
    const car = sim.cars[0];
    c.maxHeight = Math.max(c.maxHeight, car.pos.z);
    ev.length = 0; sim.drainEvents(ev);
    for (const e of ev) {
      if (e.type === 'ballHit' && e.a === 0) {
        c.touches++;
        if (car.pos.z > 200) { c.aerial++; if (car.pos.z > 500) c.highAerial++; } else c.ground++;
        if (car.flipActive || car.flipUsed) c.flipTouch++;
      }
      if (e.type === 'goal' && e.a === 0) { c.goals++; if (car.pos.z > 200 || sim.ball.pos.z > 400) c.aerialGoals++; }
    }
    if (sim.overtime) break;
  }
  c.shotsOnGoal += sim.stats[0].shots;
}
console.log(`${n} matches vs ${opp}: boss touches ${c.touches} (ground ${c.ground}, aerial >200uu ${c.aerial}, high aerial >500uu ${c.highAerial}), touches during a flip ${c.flipTouch}`);
console.log(`goals ${c.goals} (scored while airborne or on a high ball: ${c.aerialGoals}), shots ${c.shotsOnGoal}, highest the boss's car flew: ${c.maxHeight.toFixed(0)} uu`);
