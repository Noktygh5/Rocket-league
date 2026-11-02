import { GameSim, Phase, defaultConfig } from '../sim';
import { BotLevel, createBot } from './bot';

export interface MatchResult {
  goals: [number, number];
  ticks: number;
  /** Total ball touches per side. */
  touches: [number, number];
}

/** Runs a bot-vs-bot match headlessly (blue = levelA, orange = levelB). */
export function runBotMatch(levelA: BotLevel, levelB: BotLevel, seconds: number, seed: number): MatchResult {
  const sim = new GameSim({
    ...defaultConfig([{ team: 0, name: levelA }, { team: 1, name: levelB }], seed),
    matchLength: seconds,
    skipReplay: true,
  });
  const bots = [createBot(levelA, sim, 0, seed), createBot(levelB, sim, 1, seed + 1)];
  const touches: [number, number] = [0, 0];
  const last = [-1, -1];
  const maxTicks = Math.ceil(seconds * 120 + 120 * 60);
  let ticks = 0;
  while (sim.phase !== Phase.Ended && ticks < maxTicks) {
    for (const b of bots) b.think();
    sim.step();
    ticks++;
    for (let i = 0; i < 2; i++) {
      const t = sim.cars[i].lastTouchTick;
      if (t >= 0 && t !== last[i]) { last[i] = t; touches[i]++; }
    }
    // headless matches never go to sudden-death overtime; tied games just end
    if (sim.overtime) break;
  }
  return { goals: [sim.score[0], sim.score[1]], ticks, touches };
}
