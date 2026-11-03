import { describe, expect, it } from 'vitest';
import {
  CarInput, ClientPredictor, GameSim, Phase, Prng, PHYSICS, RemoteState, decodeInputPacket, decodeSnapshot,
  defaultConfig, encodeInputPacket, encodeSnapshot, quantizeInput, applySnapshot, Bot,
} from '../src';

const cfg = () => ({ ...defaultConfig([{ team: 0, name: 'me' }, { team: 1, name: 'bot' }], 5), skipReplay: true });

describe('protocol', () => {
  it('round-trips inputs with quantisation', () => {
    const a = new CarInput(); a.throttle = 1; a.steer = -0.5; a.pitch = 0.25; a.jump = true; a.boost = true;
    const b = new CarInput(); b.handbrake = true; b.roll = -1;
    const p = decodeInputPacket(encodeInputPacket(77, [a, b]))!;
    expect(p.lastTick).toBe(77);
    expect(p.inputs.length).toBe(2);
    expect(p.inputs[0].steer).toBeCloseTo(-0.5, 2);
    expect(p.inputs[0].jump).toBe(true);
    expect(p.inputs[1].handbrake).toBe(true);
    expect(p.inputs[1].roll).toBe(-1);
  });
  it('rejects malformed input packets and clamps ranges', () => {
    expect(decodeInputPacket(new ArrayBuffer(3))).toBeNull();
    const buf = new ArrayBuffer(12); const v = new DataView(buf);
    v.setUint8(0, 0x10); v.setUint8(5, 9);
    expect(decodeInputPacket(buf)).toBeNull();
    const q = quantizeInput(Object.assign(new CarInput(), { throttle: 3 }));
    expect(q.throttle).toBeLessThanOrEqual(1);
  });
  it('snapshot round-trip preserves the state to within quantisation', () => {
    const s = new GameSim(cfg());
    for (let i = 0; i < 700; i++) { s.inputs[0].throttle = 1; s.inputs[0].boost = true; s.inputs[0].steer = i % 200 < 100 ? 0.5 : -0.5; s.step(); }
    const d = decodeSnapshot(encodeSnapshot(s))!;
    expect(d.tick).toBe(s.tick);
    expect(d.cars.length).toBe(2);
    expect(Math.abs(d.cars[0].px - s.cars[0].pos.x)).toBeLessThan(0.3);
    expect(Math.abs(d.cars[0].vy - s.cars[0].vel.y)).toBeLessThan(0.3);
    expect(Math.abs(d.ball.pz - s.ball.pos.z)).toBeLessThan(0.3);
    const t = new GameSim(cfg());
    applySnapshot(t, d);
    expect(t.cars[0].boost).toBeCloseTo(s.cars[0].boost, 0);
    expect(t.phase).toBe(s.phase);
    expect(encodeSnapshot(s).byteLength).toBeLessThan(400);
  });
});

/**
 * In-process server + client with latency, jitter and loss. Time advances in 1/120 s steps.
 */
function simulate(opts: {
  oneWayMs: number; jitterMs: number; loss: number; seconds: number;
  /** TCP-style stalls: every `stallEveryMs` the link freezes for `stallMs`, then delivers everything in order at once. */
  stallEveryMs?: number; stallMs?: number;
  /** Server stops queueing stale snapshots behind a stalled connection; client reconciles once per frame. */
  fixed?: boolean;
  /** Fraction of real time the server's sim actually runs (< 1 emulates a CPU-starved host). */
  serverSpeed?: number;
}) {
  const rng = new Prng(99);
  const server = new GameSim(cfg());
  const serverBot = new Bot('medium', server, 1, 3);
  const client = new ClientPredictor(cfg(), 0);
  client.deferReconcile = !!opts.fixed;
  const dtMs = 1000 * PHYSICS.dt;

  type Msg = { at: number; fn: () => void };
  const toServer: Msg[] = [], toClient: Msg[] = [];
  const lastAt = new Map<Msg[], number>();
  const stallEnd = (now: number): number => {
    if (!opts.stallMs || !opts.stallEveryMs) return 0;
    const into = (now - 1000) % opts.stallEveryMs;
    return into < opts.stallMs ? now - into + opts.stallMs : 0;
  };
  const send = (q: Msg[], now: number, fn: () => void, unreliable = true): void => {
    if (unreliable && rng.next() < opts.loss) return;
    let at = now + opts.oneWayMs + rng.next() * opts.jitterMs;
    if (opts.stallMs) { // a stalled connection holds everything back, then delivers it in order
      at = Math.max(at, stallEnd(now) + opts.oneWayMs, lastAt.get(q) ?? 0);
      lastAt.set(q, at);
    }
    q.push({ at, fn });
  };
  let pendingSnaps = 0;
  let credit = 0;
  const deliver = (q: Msg[], now: number): void => {
    for (let i = 0; i < q.length;) { if (q[i].at <= now) { q[i].fn(); q.splice(i, 1); } else i++; }
  };

  const inputByTick = new Map<number, CarInput>();
  let lastInput = new CarInput();
  const serverHist = new Map<number, { x: number; y: number; bx: number; by: number }>();
  const local = new CarInput();
  const clientHist = new Map<number, { x: number; y: number }>();
  let now = 1000;
  let nextPing = now;
  const errs: number[] = [];
  const rs: RemoteState = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, d: null as never };
  void rs;

  const ticks = Math.floor((opts.seconds * 1000) / dtMs);
  for (let n = 0; n < ticks; n++) {
    now += dtMs;
    deliver(toServer, now); deliver(toClient, now);

    // server tick (serverSpeed < 1 emulates a host that cannot keep up with real time)
    credit += opts.serverSpeed ?? 1;
    if (credit >= 1) {
      credit -= 1;
      const T = server.tick + 1;
      const inp = inputByTick.get(T);
      if (inp) lastInput = inp;
      server.inputs[0].copy(lastInput);
      serverBot.think();
      server.step();
      server.events.length = 0;
      serverHist.set(server.tick, { x: server.cars[0].pos.x, y: server.cars[0].pos.y, bx: server.ball.pos.x, by: server.ball.pos.y });
      if (server.tick % 2 === 0 && !(opts.fixed && pendingSnaps >= 7)) {
        const snap = decodeSnapshot(encodeSnapshot(server))!;
        if (opts.fixed) pendingSnaps++;
        send(toClient, now, () => { if (opts.fixed) pendingSnaps--; client.onSnapshot(snap); });
      }

    }
    // client
    if (now >= nextPing) {
      nextPing = now + 500;
      const sent = now;
      send(toServer, now, () => {
        const tick = server.tick;
        send(toClient, now, () => client.onPong(sent, tick, sent + opts.oneWayMs * 2 + opts.jitterMs / 2), false);
      }, false);
    }
    client.reconcile();
    if (client.hasSync) {
      const target = client.targetTick(now);
      let guard = 0;
      while (client.tick < target && guard++ < 5) {
        const k = client.tick + 1;
        // scripted driver: drive, boost, weave, jump sometimes
        local.throttle = 1; local.boost = k % 600 < 400;
        local.steer = Math.sin(k / 90) > 0.3 ? 1 : Math.sin(k / 90) < -0.3 ? -1 : 0; local.yaw = local.steer;
        local.jump = k % 400 > 380; local.pitch = 1;
        client.step(local);
        clientHist.set(client.tick, { x: client.sim.cars[0].pos.x, y: client.sim.cars[0].pos.y });
        if (client.tick % 2 === 0) {
          const pk = encodeInputPacket(client.tick, client.recentInputs(4));
          send(toServer, now, () => {
            const p = decodeInputPacket(pk)!;
            for (let q = 0; q < p.inputs.length; q++) inputByTick.set(p.lastTick - (p.inputs.length - 1 - q), p.inputs[q]);
          });
        }
      }
      client.decay(PHYSICS.dt);
      // prediction error: client-predicted car vs what the server had at that tick
      if (n > 120 * 6 && n % 30 === 0 && server.phase === Phase.Playing) {
        const t = server.tick - 2;
        const h = serverHist.get(t), c = clientHist.get(t);
        if (h && c) errs.push(Math.hypot(c.x - h.x, c.y - h.y));
      }
    }
  }
  return { client, server, errs };
}

describe('netcode (simulated network)', () => {
  it('stays in sync at 100 ms RTT with 2% loss and jitter', () => {
    const { client, server } = simulate({ oneWayMs: 50, jitterMs: 15, loss: 0.02, seconds: 25 });
    expect(client.hasSync).toBe(true);
    expect(server.tick).toBeGreaterThan(2900);
    // visible corrections: very few hard snaps (demos/kickoff teleports only)
    expect(client.snaps).toBeLessThan(6);
    // the local car, once reconciled, tracks the authoritative server closely
    const lastSnap = client.latest!;
    const me = client.sim.cars[0];
    const sc = lastSnap.cars[0];
    // client is ahead; compare after replaying: distance from the server's snapshot position is bounded by travel
    expect(Math.hypot(me.pos.x - sc.px, me.pos.y - sc.py)).toBeLessThan(2300 * 0.25);
    expect(client.maxBlend).toBeLessThan(350);
  });

  it('prediction error is small on a clean fast link', () => {
    const { errs, client } = simulate({ oneWayMs: 15, jitterMs: 2, loss: 0, seconds: 20 });
    const mean = errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length);
    expect(errs.length).toBeGreaterThan(5);
    expect(mean).toBeLessThan(120);
    expect(client.snaps).toBeLessThan(6);
  });

  it('survives heavy conditions (200 ms, 5% loss) without diverging', () => {
    const { client } = simulate({ oneWayMs: 100, jitterMs: 40, loss: 0.05, seconds: 20 });
    const me = client.sim.cars[0];
    expect(Number.isFinite(me.pos.x)).toBe(true);
    expect(Math.abs(me.pos.x)).toBeLessThan(4200);
    expect(client.tick - client.lastServerTick).toBeLessThan(120);
  });

  it('a TCP-style stall: the snapshot burst is reconciled once, cutting replay work, with bounded error', () => {
    const stall = { oneWayMs: 40, jitterMs: 5, loss: 0, seconds: 30, stallEveryMs: 4000, stallMs: 900 };
    const base = simulate(stall);
    const fixed = simulate({ ...stall, fixed: true });
    expect(fixed.client.replayedTicks).toBeLessThan(base.client.replayedTicks * 0.7);
    expect(fixed.client.snaps).toBeLessThan(6);
    expect(fixed.client.maxBlend).toBeLessThan(350);
  });

  it('follows a server that runs below real time instead of racing ahead of it', () => {
    const r = simulate({ oneWayMs: 40, jitterMs: 5, loss: 0, seconds: 40, serverSpeed: 0.6 });
    expect(r.client.tps).toBeGreaterThan(120 * 0.6 * 0.9);
    expect(r.client.tps).toBeLessThan(120 * 0.6 * 1.1);
    const mean = r.errs.reduce((a, b) => a + b, 0) / Math.max(1, r.errs.length);
    expect(mean).toBeLessThan(150);
    expect(r.client.snaps).toBeLessThan(6);
  });

  it('keeps the nominal tick rate on a healthy but jittery link', () => {
    const r = simulate({ oneWayMs: 60, jitterMs: 30, loss: 0.02, seconds: 30 });
    expect(r.client.tps).toBe(120);
  });
});
