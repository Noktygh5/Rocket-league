import { describe, expect, it } from 'vitest';
import { ARENA, GameSim, Phase, arena, decodeSnapshot, defaultConfig, encodeSnapshot, makePads, snapshotSize } from '../src';

const six = () => defaultConfig([
  { team: 0, name: 'b1' }, { team: 0, name: 'b2' }, { team: 0, name: 'b3' },
  { team: 1, name: 'o1' }, { team: 1, name: 'o2' }, { team: 1, name: 'o3' },
], 7);

describe('3v3 on the beta map', () => {
  it('the field is 1.5x the standard 8192 x 10240 in plan view', () => {
    expect(ARENA.halfWidth * 2).toBe(12288);
    expect(ARENA.halfLength * 2).toBe(15360);
    expect(ARENA.goal.backY).toBe(ARENA.halfLength + ARENA.goal.depth);
  });

  it('every boost pad sits inside the playable volume', () => {
    // measured at mid height so the floor is not the nearest surface: this is wall clearance
    for (const p of makePads()) expect(arena.sdf(p.x, p.y, 600)).toBeGreaterThan(300);
  });

  it('six cars spawn inside the arena, apart from each other, mirrored between the teams', () => {
    const sim = new GameSim(six());
    expect(sim.cars).toHaveLength(6);
    for (const c of sim.cars) expect(arena.sdf(c.pos.x, c.pos.y, 600)).toBeGreaterThan(300);
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        const d = Math.hypot(sim.cars[i].pos.x - sim.cars[j].pos.x, sim.cars[i].pos.y - sim.cars[j].pos.y);
        expect(d).toBeGreaterThan(300);
      }
    }
    for (let k = 0; k < 3; k++) {
      expect(sim.cars[3 + k].pos.x).toBeCloseTo(-sim.cars[k].pos.x, 3);
      expect(sim.cars[3 + k].pos.y).toBeCloseTo(-sim.cars[k].pos.y, 3);
    }
  });

  it('a six-car match steps through kickoff and the ball is still in play', () => {
    const sim = new GameSim(six());
    for (let i = 0; i < 120 * 6 && sim.phase !== Phase.Ended; i++) sim.step();
    expect(sim.phase).not.toBe(Phase.Countdown);
    expect(arena.sdf(sim.ball.pos.x, sim.ball.pos.y, sim.ball.pos.z)).toBeGreaterThan(0);
    for (const c of sim.cars) expect(arena.sdf(c.pos.x, c.pos.y, c.pos.z)).toBeGreaterThan(0);
  });

  it('snapshots carry six cars and all pads across the wire', () => {
    const sim = new GameSim(six());
    for (let i = 0; i < 240; i++) sim.step();
    const buf = encodeSnapshot(sim);
    expect(buf.byteLength).toBe(snapshotSize(6, sim.pads.length));
    const snap = decodeSnapshot(buf);
    expect(snap).not.toBeNull();
    expect(snap!.cars).toHaveLength(6);
    expect(snap!.pads).toHaveLength(sim.pads.length);
  });
});
