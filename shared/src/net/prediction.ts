import { CarInput } from '../car';
import { PHYSICS } from '../constants';
import { Vec3 } from '../math/vec3';
import { GameSim, SimConfig } from '../sim';
import { CarSnapData, SnapData, TICKS_PER_SEC, applySnapshot, quantizeInput } from './protocol';

const RING = 1024;
const SNAP_DIST = 350;
const BLEND_TIME = 0.1;

/** Interpolated state of a remote car for rendering. */
export interface RemoteState { px: number; py: number; pz: number; qx: number; qy: number; qz: number; qw: number; vx: number; vy: number; vz: number; d: CarSnapData }

/**
 * Client-side prediction, reconciliation and interpolation. Pure logic (no DOM, no sockets),
 * so it can be tested with a simulated network in Node.
 */
export class ClientPredictor {
  readonly sim: GameSim;
  /** Predicted tick (server timeline). */
  tick = 0;
  /** Smoothed round-trip time in ms. */
  rtt = 100;
  /** Latest server tick received in a snapshot. */
  lastServerTick = -1;
  /** Number of times a visible correction was snapped (not blended). */
  snaps = 0;
  /** Largest correction blended so far (diagnostics). */
  maxBlend = 0;
  readonly carOff = new Vec3();
  readonly ballOff = new Vec3();
  private inputs: CarInput[] = [];
  private inputTicks = new Int32Array(RING).fill(-1);
  private buffer: SnapData[] = [];
  private tickOffset = 0; // serverTick = nowMs * 0.12 + tickOffset
  private bestRtt = Infinity;
  private synced = false;
  private sampleCount = 0;
  private lastSnap: SnapData | null = null;
  /** When true, onSnapshot only buffers and reconcile() (called once per frame) does the rewind-and-replay. */
  deferReconcile = false;
  /** Ticks re-simulated while reconciling (diagnostics). */
  replayedTicks = 0;
  /** Server sim ticks per second, measured from pongs. Equals TICKS_PER_SEC unless the server is running slow. */
  tps = TICKS_PER_SEC;
  private pending: SnapData | null = null;
  private pongs: { t: number; tick: number }[] = [];

  constructor(config: SimConfig, readonly localIndex: number) {
    this.sim = new GameSim(config);
    for (let i = 0; i < RING; i++) this.inputs.push(new CarInput());
  }

  get hasSync(): boolean { return this.synced; }

  /** Feed a pong: `sentMs` is the client time the ping was sent. */
  onPong(sentMs: number, serverTick: number, nowMs: number): void {
    const rtt = nowMs - sentMs;
    this.rtt = this.sampleCount === 0 ? rtt : this.rtt * 0.8 + rtt * 0.2;
    this.sampleCount++;
    const rateChanged = this.noteRate(nowMs, serverTick);
    const k = this.tps / 1000;
    const est = serverTick + (rtt / 2) * k - nowMs * k;
    if (rateChanged) {
      this.tickOffset = est; // the old offset was computed at a different rate
      this.bestRtt = rtt;
      this.synced = true;
    } else if (!this.synced || rtt <= this.bestRtt * 1.15) {
      // trust the lowest-latency samples most, but let the estimate drift to follow clock skew
      this.tickOffset = this.synced ? this.tickOffset * 0.7 + est * 0.3 : est;
      this.bestRtt = Math.min(this.bestRtt * 1.02 + 0.5, rtt);
      this.synced = true;
    }
  }

  /**
   * Tracks how fast the server's sim really runs. A starved server (free hosting) can fall behind real time;
   * following its rate makes everyone slow down together instead of the client racing ahead and getting yanked back.
   * Returns true when the rate was changed. Ordinary jitter stays inside the dead band and leaves the nominal rate.
   */
  private noteRate(nowMs: number, serverTick: number): boolean {
    const p = this.pongs;
    p.push({ t: nowMs, tick: serverTick });
    if (p.length > 10) p.shift();
    const span = p[p.length - 1].t - p[0].t;
    if (span < 3000) return false;
    const measured = ((p[p.length - 1].tick - p[0].tick) / span) * 1000;
    const next = measured < TICKS_PER_SEC * 0.93 && measured > TICKS_PER_SEC * 0.2 ? measured : TICKS_PER_SEC;
    const changed = Math.abs(next - this.tps) > TICKS_PER_SEC * 0.01;
    if (changed) this.tps = next;
    return changed;
  }

  estServerTick(nowMs: number): number {
    return nowMs * (this.tps / 1000) + this.tickOffset;
  }

  /** Tick the client should be simulating now: ahead of the server by transit time plus jitter slack. */
  targetTick(nowMs: number): number {
    const lead = Math.ceil((this.rtt / 2) * (this.tps / 1000)) + 4;
    return Math.floor(this.estServerTick(nowMs)) + lead;
  }

  /** Advances the predicted sim by one tick using the local input; returns the tick number. */
  step(inp: CarInput): number {
    this.tick++;
    const slot = this.inputs[this.tick & (RING - 1)];
    slot.copy(inp);
    quantizeInput(slot);
    this.inputTicks[this.tick & (RING - 1)] = this.tick;
    this.applyInputs(this.tick);
    this.sim.step();
    this.sim.events.length = 0;
    return this.tick;
  }

  private applyInputs(tick: number): void {
    const sim = this.sim;
    for (let i = 0; i < sim.inputs.length; i++) {
      if (i === this.localIndex) sim.inputs[i].copy(this.inputs[tick & (RING - 1)]);
      else sim.inputs[i].clear();
    }
  }

  /** Newest `n` inputs ending at the current tick (oldest first), for redundancy. */
  recentInputs(n: number): CarInput[] {
    const out: CarInput[] = [];
    for (let k = n - 1; k >= 0; k--) {
      const t = this.tick - k;
      if (t >= 1 && this.inputTicks[t & (RING - 1)] === t) out.push(this.inputs[t & (RING - 1)]);
    }
    return out;
  }

  /** Authoritative snapshot arrived: rewind to it and replay unacknowledged inputs. */
  onSnapshot(s: SnapData): void {
    if (s.tick <= this.lastServerTick) return;
    this.lastServerTick = s.tick;
    this.lastSnap = s;
    this.buffer.push(s);
    if (this.buffer.length > 24) this.buffer.shift();
    this.pending = s;
    if (!this.deferReconcile) this.reconcile();
  }

  /**
   * Rewinds to the newest snapshot received and replays the inputs it has not acknowledged. After a network stall a
   * burst of snapshots arrives at once; with deferReconcile this runs once for the burst instead of once per snapshot.
   */
  reconcile(): void {
    const s = this.pending;
    if (!s) return;
    this.pending = null;
    const sim = this.sim;
    const me = sim.cars[this.localIndex];
    const oldCar = new Vec3(me.pos.x + this.carOff.x, me.pos.y + this.carOff.y, me.pos.z + this.carOff.z);
    const oldBall = new Vec3(sim.ball.pos.x + this.ballOff.x, sim.ball.pos.y + this.ballOff.y, sim.ball.pos.z + this.ballOff.z);

    applySnapshot(sim, s);
    if (this.tick < s.tick) this.tick = s.tick; // we fell behind the server; resume from its state
    for (let t = s.tick + 1; t <= this.tick; t++) {
      this.applyInputs(t);
      sim.step();
      sim.events.length = 0;
      this.replayedTicks++;
    }
    sim.tick = this.tick;

    this.blend(this.carOff, oldCar, me.pos);
    this.blend(this.ballOff, oldBall, sim.ball.pos);
  }

  private blend(off: Vec3, old: Vec3, now: Vec3): void {
    const dx = old.x - now.x, dy = old.y - now.y, dz = old.z - now.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > SNAP_DIST) { off.x = 0; off.y = 0; off.z = 0; this.snaps++; return; }
    if (d > this.maxBlend) this.maxBlend = d;
    off.x = dx; off.y = dy; off.z = dz;
  }

  /** Exponentially decays the visual error offsets (~100 ms blend). */
  decay(dt: number): void {
    const k = Math.exp(-dt / (BLEND_TIME / 3));
    this.carOff.x *= k; this.carOff.y *= k; this.carOff.z *= k;
    this.ballOff.x *= k; this.ballOff.y *= k; this.ballOff.z *= k;
  }

  /** Interpolated remote car state ~2 snapshots in the past; extrapolates briefly if snapshots are late. */
  remote(i: number, nowMs: number, out: RemoteState): boolean {
    const buf = this.buffer;
    if (buf.length === 0) return false;
    const rt = this.estServerTick(nowMs) - 4; // 2 snapshots at 60 Hz = 4 ticks (~33 ms)
    let a = buf[0], b = buf[0];
    let found = false;
    for (let k = buf.length - 1; k >= 0; k--) {
      if (buf[k].tick <= rt) { a = buf[k]; b = buf[Math.min(buf.length - 1, k + 1)]; found = true; break; }
    }
    if (!found) { a = buf[0]; b = buf[0]; }
    const ca = a.cars[i], cb = b.cars[i];
    if (!ca || !cb) return false;
    let t = b.tick === a.tick ? 0 : (rt - a.tick) / (b.tick - a.tick);
    let extrap = 0;
    if (t > 1) { extrap = Math.min(0.15, (rt - b.tick) * PHYSICS.dt); t = 1; }
    if (t < 0) t = 0;
    out.px = ca.px + (cb.px - ca.px) * t + cb.vx * extrap;
    out.py = ca.py + (cb.py - ca.py) * t + cb.vy * extrap;
    out.pz = ca.pz + (cb.pz - ca.pz) * t + cb.vz * extrap;
    const s = ca.qx * cb.qx + ca.qy * cb.qy + ca.qz * cb.qz + ca.qw * cb.qw < 0 ? -1 : 1;
    let qx = ca.qx + (cb.qx * s - ca.qx) * t, qy = ca.qy + (cb.qy * s - ca.qy) * t;
    let qz = ca.qz + (cb.qz * s - ca.qz) * t, qw = ca.qw + (cb.qw * s - ca.qw) * t;
    const l = Math.hypot(qx, qy, qz, qw) || 1;
    out.qx = qx / l; out.qy = qy / l; out.qz = qz / l; out.qw = qw / l;
    out.vx = cb.vx; out.vy = cb.vy; out.vz = cb.vz;
    out.d = cb;
    return true;
  }

  get latest(): SnapData | null { return this.lastSnap; }
}
