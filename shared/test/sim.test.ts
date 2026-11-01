import { describe, expect, it } from 'vitest';
import { BALL, CAR, GameSim, MATCH, PADS, Phase, SPAWN, SimEvent, defaultConfig, makePads } from '../src';

function sim1v1(opts: Partial<ReturnType<typeof defaultConfig>> = {}): GameSim {
  return new GameSim({
    ...defaultConfig([{ team: 0, name: 'A' }, { team: 1, name: 'B' }], 7),
    skipReplay: true,
    ...opts,
  });
}
function runSeconds(s: GameSim, sec: number, stopWhen?: () => boolean): void {
  for (let i = 0; i < sec * 120; i++) {
    s.step();
    if (stopWhen && stopWhen()) return;
  }
}
function kickoffDone(s: GameSim): void {
  runSeconds(s, SPAWN.countdown + 0.1);
  expect(s.phase).toBe(Phase.Playing);
}

describe('pads', () => {
  it('has 18 pads: 4 large, 14 small', () => {
    const p = makePads();
    expect(p.length).toBe(18);
    expect(p.filter((x) => x.large).length).toBe(4);
    expect(p.filter((x) => !x.large).length).toBe(14);
  });
  it('a car picks up a pad and it respawns on time', () => {
    const s = sim1v1();
    kickoffDone(s);
    const pad = s.pads.find((p) => !p.large)!;
    const car = s.cars[0];
    car.boost = 10;
    car.pos.x = pad.x; car.pos.y = pad.y; car.vel.x = 0; car.vel.y = 0;
    s.step();
    expect(car.boost).toBe(10 + PADS.small.amount);
    expect(pad.active).toBe(false);
    car.pos.x = pad.x > 0 ? pad.x - 1500 : pad.x + 1500; car.pos.y = pad.y > 0 ? pad.y - 1500 : pad.y + 1500;
    runSeconds(s, PADS.small.respawn + 0.2);
    expect(pad.active).toBe(true);
  });
  it('large pad gives 100 and caps at max', () => {
    const s = sim1v1();
    kickoffDone(s);
    const pad = s.pads.find((p) => p.large)!;
    const car = s.cars[0];
    car.boost = 20;
    car.pos.x = pad.x; car.pos.y = pad.y;
    s.step();
    expect(car.boost).toBe(CAR.boost.max);
  });
});

describe('match flow', () => {
  it('starts with a 3 second countdown and 33 boost, cars frozen', () => {
    const s = sim1v1();
    expect(s.phase).toBe(Phase.Countdown);
    s.inputs[0].throttle = 1;
    const y0 = s.cars[0].pos.y;
    runSeconds(s, 2);
    expect(Math.abs(s.cars[0].pos.y - y0)).toBeLessThan(2);
    expect(s.cars[0].boost).toBe(CAR.boost.start);
    runSeconds(s, 1.2);
    expect(s.phase).toBe(Phase.Playing);
    const ev: SimEvent[] = [];
    s.drainEvents(ev);
    expect(ev.filter((e) => e.type === 'countdown').map((e) => e.a)).toEqual([3, 2, 1]);
    expect(ev.some((e) => e.type === 'kickoff')).toBe(true);
  });

  it('blue and orange spawn mirrored on opposite sides', () => {
    const s = sim1v1();
    const a = s.cars[0], b = s.cars[1];
    expect(a.pos.y).toBeLessThan(0);
    expect(b.pos.y).toBeGreaterThan(0);
    expect(a.pos.x).toBeCloseTo(-b.pos.x, 5);
    expect(a.pos.y).toBeCloseTo(-b.pos.y, 5);
  });

  it('clock counts down only while playing', () => {
    const s = sim1v1();
    runSeconds(s, 2);
    expect(s.clock).toBe(MATCH.length);
    runSeconds(s, 1.1 + 10);
    expect(s.clock).toBeGreaterThan(MATCH.length - 10.5);
    expect(s.clock).toBeLessThan(MATCH.length - 9.5);
  });

  it('a goal scores for the attacking team, then returns to kickoff', () => {
    const s = sim1v1();
    kickoffDone(s);
    s.cars[0].lastTouchTick = 1;
    s.lastTouchCar = 0;
    s.ball.pos.x = 0; s.ball.pos.y = 4800; s.ball.pos.z = 200;
    s.ball.vel.y = 3500; s.ball.vel.x = 0; s.ball.vel.z = 0;
    runSeconds(s, 2, () => s.phase === Phase.Goal);
    expect(s.phase).toBe(Phase.Goal);
    expect(s.score).toEqual([1, 0]);
    expect(s.stats[0].goals).toBe(1);
    runSeconds(s, 2);
    expect(s.phase).toBe(Phase.Countdown);
    expect(s.ball.pos.y).toBe(0);
    expect(s.pads.every((p) => p.active)).toBe(true);
  });

  it('a goal blasts the cars away from the goal that was scored in', () => {
    const s = sim1v1();
    kickoffDone(s);
    s.cars[0].pos.x = 0; s.cars[0].pos.y = 3500; s.cars[0].vel.x = 0; s.cars[0].vel.y = 0;
    s.ball.pos.x = 0; s.ball.pos.y = 4800; s.ball.pos.z = 200;
    s.ball.vel.y = 3500; s.ball.vel.x = 0; s.ball.vel.z = 0;
    runSeconds(s, 2, () => s.phase === Phase.Goal);
    expect(s.phase).toBe(Phase.Goal);
    runSeconds(s, 0.5);
    expect(s.cars[0].vel.y).toBeLessThan(-400); // thrown back toward midfield
    expect(s.cars[0].pos.z).toBeGreaterThan(100); // and into the air
  });

  it('orange scores in the blue goal', () => {
    const s = sim1v1();
    kickoffDone(s);
    s.ball.pos.x = 0; s.ball.pos.y = -4800; s.ball.pos.z = 200;
    s.ball.vel.y = -3500;
    runSeconds(s, 2, () => s.phase === Phase.Goal);
    expect(s.score).toEqual([0, 1]);
  });

  it('tied game goes to sudden-death overtime and the next goal wins', () => {
    const s = sim1v1();
    kickoffDone(s);
    s.clock = 0.05;
    runSeconds(s, 1);
    expect(s.overtime).toBe(true);
    expect(s.phase).toBe(Phase.Playing);
    s.ball.pos.x = 0; s.ball.pos.y = 4800; s.ball.pos.z = 200; s.ball.vel.y = 3500;
    runSeconds(s, 5, () => s.phase === Phase.Ended);
    expect(s.phase).toBe(Phase.Ended);
    expect(s.winner).toBe(0);
  });

  it('with a lead and the ball on the ground, time up ends the match', () => {
    const s = sim1v1();
    kickoffDone(s);
    s.score[0] = 1;
    s.clock = 0.02;
    runSeconds(s, 1);
    expect(s.phase).toBe(Phase.Ended);
    expect(s.winner).toBe(0);
  });

  it('time up with the ball airborne plays on until it touches down', () => {
    const s = sim1v1();
    kickoffDone(s);
    s.score[0] = 1;
    s.ball.pos.z = 1200; s.ball.vel.z = 0;
    s.clock = 0.02;
    runSeconds(s, 0.5);
    expect(s.phase).toBe(Phase.Playing);
    expect(s.expiring).toBe(true);
    runSeconds(s, 6, () => s.phase === Phase.Ended);
    expect(s.phase).toBe(Phase.Ended);
  });

  it('copyFrom reproduces state exactly and stepping stays deterministic', () => {
    const a = sim1v1(), b = sim1v1();
    for (let i = 0; i < 120 * 5; i++) { a.inputs[0].throttle = 1; a.inputs[0].boost = true; a.step(); }
    b.copyFrom(a);
    for (let i = 0; i < 300; i++) {
      a.inputs[0].throttle = 1; b.inputs[0].throttle = 1;
      a.inputs[0].boost = true; b.inputs[0].boost = true;
      a.step(); b.step();
    }
    expect(b.cars[0].pos.y).toBe(a.cars[0].pos.y);
    expect(b.ball.pos.x).toBe(a.ball.pos.x);
    expect(b.clock).toBe(a.clock);
  });

  it('is bit-deterministic for identical input streams', () => {
    const run = () => {
      const s = sim1v1();
      for (let i = 0; i < 120 * 8; i++) {
        const k = i % 240;
        s.inputs[0].throttle = 1; s.inputs[0].boost = true;
        s.inputs[0].steer = k < 60 ? 1 : k < 120 ? -1 : 0;
        s.inputs[0].jump = k === 130 || k === 150;
        s.inputs[1].throttle = 1; s.inputs[1].steer = k < 100 ? -0.5 : 0;
        s.step();
      }
      return [s.cars[0].pos.x, s.cars[0].pos.y, s.cars[1].pos.x, s.ball.pos.y, s.ball.vel.x];
    };
    expect(run()).toEqual(run());
  });

  it('physics step costs well under 1 ms for 4 cars + ball', () => {
    const s = new GameSim({
      ...defaultConfig([{ team: 0, name: 'a' }, { team: 0, name: 'b' }, { team: 1, name: 'c' }, { team: 1, name: 'd' }]),
      skipReplay: true,
    });
    runSeconds(s, 3.2);
    for (const i of s.inputs) { i.throttle = 1; i.boost = true; i.steer = 0.3; }
    const n = 2000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) s.step();
    const per = (performance.now() - t0) / n;
    expect(per).toBeLessThan(1);
    expect(BALL.radius).toBeGreaterThan(0);
  });
});
