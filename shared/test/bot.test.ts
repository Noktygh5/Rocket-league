import { describe, expect, it } from 'vitest';
import { ARENA, BallPath, BallState, BOT_CONFIGS, predictBall, runBotMatch } from '../src';

describe('ball prediction', () => {
  it('matches the real ball physics and detects goals', () => {
    const b = new BallState();
    b.pos.y = ARENA.halfLength - 2120; b.pos.z = 200; b.vel.y = 3000;
    const p = new BallPath();
    predictBall(p, b, 3, 2);
    expect(p.n).toBeGreaterThan(100);
    expect(p.goalSide).toBe(1);
    expect(p.goalTime).toBeGreaterThan(0.4);
    expect(p.goalTime).toBeLessThan(1.5);
    // free-fall sample: after 1 s the height has dropped by about g/2
    const q = new BallState();
    q.pos.z = 1500;
    predictBall(p, q, 1.2, 2);
    const k = Math.round(1 / p.stepDt);
    expect(p.z[k]).toBeLessThan(1500 - 0.5 * 650 * 0.9);
  });
});

describe('bot difficulty', () => {
  it('configs are ordered by reaction time and horizon', () => {
    expect(BOT_CONFIGS.easy.reaction).toBeGreaterThan(BOT_CONFIGS.medium.reaction);
    expect(BOT_CONFIGS.medium.reaction).toBeGreaterThan(BOT_CONFIGS.hard.reaction);
    expect(BOT_CONFIGS.easy.horizon).toBeLessThan(BOT_CONFIGS.medium.horizon);
    expect(BOT_CONFIGS.medium.horizon).toBeLessThan(BOT_CONFIGS.hard.horizon);
    expect(BOT_CONFIGS.easy.aerials).toBe(0);
  });

  it('hard beats easy over a batch of short matches (full ladder: npm run ladder)', () => {
    let hard = 0, easy = 0;
    for (let i = 0; i < 16; i++) {
      const hardBlue = i % 2 === 0;
      const r = hardBlue ? runBotMatch("hard", "easy", 100, 300 + i) : runBotMatch("easy", "hard", 100, 300 + i);
      hard += hardBlue ? r.goals[0] : r.goals[1];
      easy += hardBlue ? r.goals[1] : r.goals[0];
    }
    expect(hard).toBeGreaterThan(easy);
  });
});
