import { describe, expect, it } from 'vitest';
import { BOT_CONFIGS, GameSim, Phase, createBot, defaultConfig, runBotMatch } from '../src';

describe('ultrahard boss', () => {
  it('is built by createBot and has the same surface as the other bots', () => {
    const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'a' }, { team: 1, name: 'b' }], 1), skipReplay: true });
    const boss = createBot('ultrahard', sim, 1, 1);
    expect(typeof boss.think).toBe('function');
    expect(boss.predictedPath).toBeDefined();
    expect(boss.target).toBeDefined();
    expect(BOT_CONFIGS.ultrahard).toBeDefined();
  });

  it('plays a whole match without ever producing a non-finite input or car state', () => {
    const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'boss' }, { team: 1, name: 'hard' }], 21), matchLength: 40, skipReplay: true });
    const boss = createBot('ultrahard', sim, 0, 21);
    const hard = createBot('hard', sim, 1, 22);
    let ticks = 0;
    while (sim.phase !== Phase.Ended && ticks < 40 * 120 + 3000) {
      boss.think(); hard.think(); sim.step(); ticks++;
      const i = sim.inputs[0], c = sim.cars[0];
      if (!(Number.isFinite(i.throttle) && Number.isFinite(i.steer) && Number.isFinite(i.pitch) && Number.isFinite(i.yaw) && Number.isFinite(i.roll))) throw new Error('bad input');
      if (!(Number.isFinite(c.pos.x) && Number.isFinite(c.pos.y) && Number.isFinite(c.pos.z))) throw new Error('bad car state');
      if (sim.overtime) break;
    }
    expect(ticks).toBeGreaterThan(40 * 120 - 1);
  }, 60_000);

  it('beats the Hard bot over a batch of short matches (the full comparison is scripts/lab_stats.ts)', () => {
    let boss = 0, hard = 0;
    for (let i = 0; i < 4; i++) {
      const bossBlue = i % 2 === 0;
      const r = bossBlue ? runBotMatch('ultrahard', 'hard', 80, 500 + i) : runBotMatch('hard', 'ultrahard', 80, 500 + i);
      boss += bossBlue ? r.goals[0] : r.goals[1];
      hard += bossBlue ? r.goals[1] : r.goals[0];
    }
    expect(boss).toBeGreaterThan(hard);
  }, 120_000);

  it('takes off for a ball hanging high above it and touches it', () => {
    const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'boss' }, { team: 1, name: 'idle' }], 9), matchLength: 60, skipReplay: true });
    const boss = createBot('ultrahard', sim, 0, 9);
    while (sim.phase !== Phase.Playing) sim.step();
    const car = sim.cars[0];
    car.pos.x = 0; car.pos.y = -2500; car.vel.y = 800;
    sim.ball.pos.x = 400; sim.ball.pos.y = -300; sim.ball.pos.z = 900;
    sim.ball.vel.x = 0; sim.ball.vel.y = 400; sim.ball.vel.z = 700;
    sim.cars[1].pos.x = 3000; sim.cars[1].pos.y = 6500;
    let maxZ = 0;
    for (let i = 0; i < 120 * 5; i++) { boss.think(); sim.step(); maxZ = Math.max(maxZ, car.pos.z); }
    expect(car.lastTouchTick).toBeGreaterThanOrEqual(0);
    expect(maxZ).toBeGreaterThan(300); // it actually left the ground, not just a ground hit
  }, 60_000);
});
