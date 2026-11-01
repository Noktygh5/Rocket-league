import { describe, expect, it } from 'vitest';
import { FixedStepper, PHYSICS, Prng } from '../src';

describe('FixedStepper', () => {
  it('runs the right number of steps for a given frame time', () => {
    const s = new FixedStepper();
    let n = 0;
    s.advance(PHYSICS.dt * 3 + 1e-6, () => n++);
    expect(n).toBe(3);
    expect(s.alpha).toBeLessThan(0.01);
  });
  it('accumulates fractional time across frames and exposes alpha', () => {
    const s = new FixedStepper();
    let n = 0;
    s.advance(PHYSICS.dt * 0.5, () => n++);
    expect(n).toBe(0);
    expect(s.alpha).toBeCloseTo(0.5, 6);
    s.advance(PHYSICS.dt * 0.75, () => n++);
    expect(n).toBe(1);
    expect(s.alpha).toBeCloseTo(0.25, 6);
  });
  it('caps sub-steps and drops the backlog', () => {
    const s = new FixedStepper();
    let n = 0;
    s.advance(10, () => n++);
    expect(n).toBe(PHYSICS.maxSubSteps);
    n = 0;
    s.advance(0, () => n++);
    expect(n).toBe(0);
  });
  it('tick counter is monotonic and passed to the callback', () => {
    const s = new FixedStepper();
    const seen: number[] = [];
    s.advance(PHYSICS.dt * 2.01, (t) => seen.push(t));
    s.advance(PHYSICS.dt * 1.01, (t) => seen.push(t));
    expect(seen).toEqual([0, 1, 2]);
  });
});

describe('Prng', () => {
  it('is deterministic per seed and restorable', () => {
    const a = new Prng(42), b = new Prng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    const st = a.getState();
    const x = a.next();
    a.setState(st);
    expect(a.next()).toBe(x);
  });
  it('stays in range', () => {
    const p = new Prng(7);
    for (let i = 0; i < 1000; i++) {
      const v = p.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(p.int(5)).toBeLessThan(5);
    }
  });
});
