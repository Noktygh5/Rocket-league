import { describe, expect, it } from 'vitest';
import { ARENA, BOT_CONFIGS, GameSim, Phase, Prng, createBot, defaultConfig, placeCar, runBotMatch } from '../src';

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

  it('wins the tip-off against Hard: first to the ball and the ball ends up on its attacking side', () => {
    let first = 0, ahead = 0;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const bossBlue = i % 2 === 0;
      const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'x' }, { team: 1, name: 'y' }], 4000 + i), matchLength: 60, skipReplay: true });
      const bi = bossBlue ? 0 : 1, hi = bossBlue ? 1 : 0;
      const boss = createBot('ultrahard', sim, bi, 4000 + i), hard = createBot('hard', sim, hi, 4001 + i);
      while (sim.phase !== Phase.Playing) sim.step();
      let bossFirst = false, decided = false;
      for (let t = 0; t < 6 * 120 && sim.phase === Phase.Playing; t++) {
        boss.think(); hard.think(); sim.step();
        if (!decided) {
          if (sim.cars[bi].lastTouchTick >= 0) { bossFirst = true; decided = true; }
          else if (sim.cars[hi].lastTouchTick >= 0) decided = true;
        }
      }
      if (bossFirst) first++;
      if (sim.ball.pos.y * (bossBlue ? 1 : -1) > 0) ahead++;
    }
    expect(first).toBeGreaterThanOrEqual(5);
    expect(ahead).toBeGreaterThanOrEqual(5);
  }, 120_000);

  it('saves most shots when it is standing in goal', () => {
    let saved = 0;
    const n = 20;
    for (let s = 0; s < n; s++) {
      const rng = new Prng(7000 + s);
      const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'keeper' }, { team: 1, name: 'shooter' }], 31 + s), matchLength: 120, skipReplay: true });
      const keeper = createBot('ultrahard', sim, 0, 31 + s);
      while (sim.phase !== Phase.Playing) sim.step();
      placeCar(sim.cars[0], (rng.next() - 0.5) * 1200, -ARENA.halfLength + 900 + rng.next() * 1600, Math.PI / 2);
      sim.cars[1].pos.x = 3500; sim.cars[1].pos.y = ARENA.halfLength - 600;
      const sx = (rng.next() - 0.5) * 4000, sy = -300 - rng.next() * 2500;
      const tx = (rng.next() - 0.5) * 2 * (ARENA.goal.halfWidth - 150), tz = 90 + rng.next() * 380;
      const dx = tx - sx, dy = -ARENA.halfLength - sy, dz = tz - 100;
      const dl = Math.hypot(dx, dy, dz), sp = 1800 + rng.next() * 2200;
      sim.ball.pos.x = sx; sim.ball.pos.y = sy; sim.ball.pos.z = 100;
      sim.ball.vel.x = dx / dl * sp; sim.ball.vel.y = dy / dl * sp; sim.ball.vel.z = dz / dl * sp;
      const before = sim.score[1];
      for (let i = 0; i < 120 * 6 && sim.score[1] === before; i++) { keeper.think(); sim.step(); }
      if (sim.score[1] === before) saved++;
    }
    expect(saved).toBeGreaterThanOrEqual(14); // 70 percent; it stops about 87 percent in the lab
  }, 120_000);

  it('does not hop around without a plan: nearly every jump is followed by a touch', () => {
    // regression: an aerial plan whose contact time had passed sent the car up again every time it landed
    const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'boss' }, { team: 1, name: 'idle' }], 601), matchLength: 90, skipReplay: true });
    const boss = createBot('ultrahard', sim, 0, 601);
    let ticks = 0, prev = false, presses = 0, aimless = 0, lastTouch = -1;
    const pending: number[] = [];
    while (sim.phase !== Phase.Ended && ticks < 90 * 120 + 3000) {
      boss.think(); sim.step(); ticks++;
      if (sim.phase !== Phase.Playing) { pending.length = 0; prev = false; continue; }
      const j = sim.inputs[0].jump;
      if (j && !prev) { presses++; pending.push(ticks); }
      prev = j;
      const c = sim.cars[0];
      if (c.lastTouchTick !== lastTouch && c.lastTouchTick >= 0) { lastTouch = c.lastTouchTick; pending.length = 0; }
      while (pending.length && ticks - pending[0] > 264) { aimless++; pending.shift(); }
    }
    expect(presses).toBeGreaterThan(5);
    expect(aimless / presses).toBeLessThan(0.12); // before the fix: about a third
  }, 90_000);
});
