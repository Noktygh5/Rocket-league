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

  it('never takes off on a stale aerial plan (the boss used to hop in place every time it landed)', () => {
    const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'boss' }, { team: 1, name: 'idle' }], 601), matchLength: 60, skipReplay: true });
    const boss: any = createBot('ultrahard', sim, 0, 601);
    while (sim.phase !== Phase.Playing) sim.step();
    const car = sim.cars[0];
    // a quiet ball far away, the car on the ground facing it, and an Aerial plan whose take-off and contact times are long past
    placeCar(car, -3000, -3000, Math.atan2(3000, 3000));
    sim.ball.pos.x = 0; sim.ball.pos.y = 0; sim.ball.pos.z = 92; sim.ball.vel.x = 0; sim.ball.vel.y = 0; sim.ball.vel.z = 0;
    sim.cars[1].pos.x = 3500; sim.cars[1].pos.y = 6500;
    boss.think(); // let it build its first plan
    const now = sim.tick / 120;
    const pl = boss.plan;
    pl.kind = 2; pl.jumpAt = now - 3; pl.contactT = now - 2; pl.cx = 0; pl.cy = 0; pl.cz = 700; pl.flip = true;
    boss.hasPlan = true; boss.searching = false;
    let presses = 0, prev = false;
    for (let i = 0; i < 90; i++) { boss.think(); sim.step(); const j = sim.inputs[0].jump; if (j && !prev && car.pos.z < 60) presses++; prev = j; }
    expect(presses).toBe(0);
  }, 30_000);

  it('gets down from a wall instead of riding it for seconds (recorded games: it rode its own back wall and the ceiling while the human scored)', () => {
    const sim = new GameSim({ ...defaultConfig([{ team: 0, name: 'human' }, { team: 1, name: 'boss' }], 300), matchLength: 60, skipReplay: true });
    const boss = createBot('ultrahard', sim, 1, 300);
    while (sim.phase !== Phase.Playing) sim.step();
    const car = sim.cars[1];
    placeCar(car, 5000, 0, 0); car.vel.x = 1800; car.boost = 100;
    sim.cars[0].pos.x = -3000; sim.cars[0].pos.y = -7000;
    sim.ball.pos.x = -1500; sim.ball.pos.y = 500; sim.ball.pos.z = 92; sim.ball.vel.x = 0; sim.ball.vel.y = 0; sim.ball.vel.z = 0;
    let up = false;
    for (let t = 0; t < 600 && !up; t++) { const i = sim.inputs[1]; i.clear(); i.throttle = 1; i.boost = true; sim.step(); if (car.onGround && car.pos.z > 700 && Math.abs(car.surfaceNormal.z) < 0.4) up = true; }
    expect(up).toBe(true);                                         // the script really put the car up the wall
    let down = -1;
    for (let t = 0; t < 120 * 6 && down < 0; t++) { boss.think(); sim.step(); if (car.onGround && car.pos.z < 120) down = t / 120; }
    expect(down).toBeGreaterThanOrEqual(0);
    expect(down).toBeLessThan(5);                                   // before the fix it was still up there after 8 s in 12 of 20 tries
  }, 30_000);
});
