import { CarInput, CarState } from '../car';
import { NET, PHYSICS } from '../constants';
import { mat3 } from '../math/mat3';
import { GameSim } from '../sim';

// Binary game protocol (little endian). Lobby/control traffic is small JSON text frames; the
// per-tick traffic (inputs and snapshots) is packed binary for size and speed.

export const MSG_INPUT = 0x10;
export const MSG_SNAPSHOT = 0x20;

export const PROTOCOL_VERSION = NET.protocolVersion;

const POS_SCALE = 5;
const VEL_SCALE = 5;
const ANG_SCALE = 2000;
const BALL_ANG_SCALE = 5000;
const Q_SCALE = 32767;

// ---- inputs ---------------------------------------------------------------------------------

const q8 = (v: number): number => Math.max(-127, Math.min(127, Math.round(v * 127)));

/** Rounds an input to exactly what survives the wire so client prediction matches the server. */
export function quantizeInput(i: CarInput): CarInput {
  i.throttle = q8(i.throttle) / 127; i.steer = q8(i.steer) / 127; i.pitch = q8(i.pitch) / 127;
  i.yaw = q8(i.yaw) / 127; i.roll = q8(i.roll) / 127;
  return i;
}

/** Packs up to 4 inputs; `lastTick` is the tick of the newest one. */
export function encodeInputPacket(lastTick: number, inputs: CarInput[]): ArrayBuffer {
  const n = Math.min(inputs.length, 4);
  const buf = new ArrayBuffer(6 + n * 6);
  const v = new DataView(buf);
  v.setUint8(0, MSG_INPUT);
  v.setUint32(1, lastTick >>> 0, true);
  v.setUint8(5, n);
  for (let k = 0; k < n; k++) {
    const i = inputs[inputs.length - n + k];
    const o = 6 + k * 6;
    v.setInt8(o, q8(i.throttle)); v.setInt8(o + 1, q8(i.steer)); v.setInt8(o + 2, q8(i.pitch));
    v.setInt8(o + 3, q8(i.yaw)); v.setInt8(o + 4, q8(i.roll));
    v.setUint8(o + 5, (i.jump ? 1 : 0) | (i.boost ? 2 : 0) | (i.handbrake ? 4 : 0) | (i.recover ? 8 : 0));
  }
  return buf;
}

export interface InputPacket {
  lastTick: number;
  /** Oldest first; entry k belongs to tick lastTick - (n - 1 - k). */
  inputs: CarInput[];
}

/** Validates ranges while decoding; returns null for malformed packets. */
export function decodeInputPacket(buf: ArrayBuffer): InputPacket | null {
  if (buf.byteLength < 6) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== MSG_INPUT) return null;
  const n = v.getUint8(5);
  if (n < 1 || n > 4 || buf.byteLength < 6 + n * 6) return null;
  const inputs: CarInput[] = [];
  for (let k = 0; k < n; k++) {
    const o = 6 + k * 6;
    const c = new CarInput();
    const f = (x: number): number => Math.max(-1, Math.min(1, x / 127));
    c.throttle = f(v.getInt8(o)); c.steer = f(v.getInt8(o + 1)); c.pitch = f(v.getInt8(o + 2));
    c.yaw = f(v.getInt8(o + 3)); c.roll = f(v.getInt8(o + 4));
    const fl = v.getUint8(o + 5);
    c.jump = (fl & 1) !== 0; c.boost = (fl & 2) !== 0; c.handbrake = (fl & 4) !== 0; c.recover = (fl & 8) !== 0;
    inputs.push(c);
  }
  return { lastTick: v.getUint32(1, true), inputs };
}

// ---- snapshots ------------------------------------------------------------------------------

export interface CarSnapData {
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  qx: number; qy: number; qz: number; qw: number;
  wx: number; wy: number; wz: number;
  boost: number;
  flags: number;
  jumpTimer: number; airTime: number; flipTimer: number; pitchLock: number;
  boostHold: number; groundLockout: number; respawn: number;
  flipDirX: number; flipDirY: number;
}

export interface SnapData {
  tick: number;
  phase: number;
  overtime: boolean;
  expiring: boolean;
  clock: number;
  phaseTimer: number;
  score: [number, number];
  winner: number;
  ball: { px: number; py: number; pz: number; vx: number; vy: number; vz: number; qx: number; qy: number; qz: number; qw: number; wx: number; wy: number; wz: number };
  /** 0 when active, otherwise remaining respawn seconds. */
  pads: number[];
  cars: CarSnapData[];
}

const F_ONGROUND = 1, F_JUMPED = 2, F_JUMPHELD = 4, F_FLIPUSED = 8, F_FLIPACTIVE = 16, F_FLIPCANCEL = 32,
  F_SUPERSONIC = 64, F_BOOSTING = 128, F_DEMOLISHED = 256, F_PREVJUMP = 512, F_PREVBOOST = 1024, F_PREVRECOVER = 2048, F_AUTORIGHT = 4096;

const i16 = (x: number): number => Math.max(-32767, Math.min(32767, Math.round(x)));
const u16ms = (s: number): number => Math.max(0, Math.min(65535, Math.round(s * 1000)));

export function snapshotSize(nCars: number, nPads: number): number {
  return 1 + 4 + 1 + 1 + 1 + 4 + 4 + 3 + 26 + nPads + nCars * 43;
}

export function encodeSnapshot(sim: GameSim): ArrayBuffer {
  const nc = sim.cars.length, np = sim.pads.length;
  const buf = new ArrayBuffer(snapshotSize(nc, np));
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o++, MSG_SNAPSHOT);
  v.setUint32(o, sim.tick >>> 0, true); o += 4;
  v.setUint8(o++, sim.phase);
  v.setUint8(o++, (sim.overtime ? 1 : 0) | (sim.expiring ? 2 : 0));
  v.setUint8(o++, nc);
  v.setFloat32(o, sim.clock, true); o += 4;
  v.setFloat32(o, Math.max(0, sim.phaseTimer), true); o += 4;
  v.setUint8(o++, sim.score[0]); v.setUint8(o++, sim.score[1]); v.setInt8(o++, sim.winner);
  const b = sim.ball;
  const w16 = (x: number): void => { v.setInt16(o, i16(x), true); o += 2; };
  w16(b.pos.x * POS_SCALE); w16(b.pos.y * POS_SCALE); w16(b.pos.z * POS_SCALE);
  w16(b.vel.x * VEL_SCALE); w16(b.vel.y * VEL_SCALE); w16(b.vel.z * VEL_SCALE);
  w16(b.rot.x * Q_SCALE); w16(b.rot.y * Q_SCALE); w16(b.rot.z * Q_SCALE); w16(b.rot.w * Q_SCALE);
  w16(b.angVel.x * BALL_ANG_SCALE); w16(b.angVel.y * BALL_ANG_SCALE); w16(b.angVel.z * BALL_ANG_SCALE);
  for (let i = 0; i < np; i++) {
    const p = sim.pads[i];
    v.setUint8(o++, p.active ? 0 : Math.max(1, Math.min(255, Math.ceil(p.timer * 10))));
  }
  for (const c of sim.cars) {
    w16(c.pos.x * POS_SCALE); w16(c.pos.y * POS_SCALE); w16(c.pos.z * POS_SCALE);
    w16(c.vel.x * VEL_SCALE); w16(c.vel.y * VEL_SCALE); w16(c.vel.z * VEL_SCALE);
    w16(c.rot.x * Q_SCALE); w16(c.rot.y * Q_SCALE); w16(c.rot.z * Q_SCALE); w16(c.rot.w * Q_SCALE);
    w16(c.angVel.x * ANG_SCALE); w16(c.angVel.y * ANG_SCALE); w16(c.angVel.z * ANG_SCALE);
    v.setUint8(o++, Math.max(0, Math.min(255, Math.round(c.boost * 2.55))));
    const flags =
      (c.onGround ? F_ONGROUND : 0) | (c.jumped ? F_JUMPED : 0) | (c.jumpHeld ? F_JUMPHELD : 0) | (c.flipUsed ? F_FLIPUSED : 0) |
      (c.flipActive ? F_FLIPACTIVE : 0) | (c.flipCancel ? F_FLIPCANCEL : 0) | (c.supersonic ? F_SUPERSONIC : 0) |
      (c.boosting ? F_BOOSTING : 0) | (c.demolished ? F_DEMOLISHED : 0) | (c.prevJump ? F_PREVJUMP : 0) | (c.prevBoost ? F_PREVBOOST : 0) | (c.prevRecover ? F_PREVRECOVER : 0) | (c.autoRight ? F_AUTORIGHT : 0);
    v.setUint16(o, flags, true); o += 2;
    v.setUint16(o, u16ms(c.jumpTimer), true); o += 2;
    v.setUint16(o, u16ms(c.airTime), true); o += 2;
    v.setUint16(o, u16ms(c.flipTimer), true); o += 2;
    v.setUint16(o, u16ms(c.pitchLock), true); o += 2;
    v.setUint8(o++, Math.max(0, Math.min(255, Math.round(c.boostHold * 500))));
    v.setUint8(o++, Math.max(0, Math.min(255, Math.round(c.groundLockout * 500))));
    v.setUint16(o, u16ms(c.respawnTimer), true); o += 2;
    v.setInt8(o++, q8(c.flipDirX)); v.setInt8(o++, q8(c.flipDirY));
  }
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): SnapData | null {
  if (buf.byteLength < 30) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== MSG_SNAPSHOT) return null;
  let o = 1;
  const tick = v.getUint32(o, true); o += 4;
  const phase = v.getUint8(o++);
  const fl = v.getUint8(o++);
  const nc = v.getUint8(o++);
  const np = 34;
  if (buf.byteLength < snapshotSize(nc, np)) return null;
  const clock = v.getFloat32(o, true); o += 4;
  const phaseTimer = v.getFloat32(o, true); o += 4;
  const score: [number, number] = [v.getUint8(o++), v.getUint8(o++)];
  const winner = v.getInt8(o++);
  const r16 = (): number => { const x = v.getInt16(o, true); o += 2; return x; };
  const ball = {
    px: r16() / POS_SCALE, py: r16() / POS_SCALE, pz: r16() / POS_SCALE,
    vx: r16() / VEL_SCALE, vy: r16() / VEL_SCALE, vz: r16() / VEL_SCALE,
    qx: r16() / Q_SCALE, qy: r16() / Q_SCALE, qz: r16() / Q_SCALE, qw: r16() / Q_SCALE,
    wx: r16() / BALL_ANG_SCALE, wy: r16() / BALL_ANG_SCALE, wz: r16() / BALL_ANG_SCALE,
  };
  const pads: number[] = [];
  for (let i = 0; i < np; i++) pads.push(v.getUint8(o++) / 10);
  const cars: CarSnapData[] = [];
  for (let i = 0; i < nc; i++) {
    const c: CarSnapData = {
      px: r16() / POS_SCALE, py: r16() / POS_SCALE, pz: r16() / POS_SCALE,
      vx: r16() / VEL_SCALE, vy: r16() / VEL_SCALE, vz: r16() / VEL_SCALE,
      qx: r16() / Q_SCALE, qy: r16() / Q_SCALE, qz: r16() / Q_SCALE, qw: r16() / Q_SCALE,
      wx: r16() / ANG_SCALE, wy: r16() / ANG_SCALE, wz: r16() / ANG_SCALE,
      boost: v.getUint8(o++) / 2.55, flags: 0, jumpTimer: 0, airTime: 0, flipTimer: 0, pitchLock: 0,
      boostHold: 0, groundLockout: 0, respawn: 0, flipDirX: 0, flipDirY: 0,
    };
    c.flags = v.getUint16(o, true); o += 2;
    c.jumpTimer = v.getUint16(o, true) / 1000; o += 2;
    c.airTime = v.getUint16(o, true) / 1000; o += 2;
    c.flipTimer = v.getUint16(o, true) / 1000; o += 2;
    c.pitchLock = v.getUint16(o, true) / 1000; o += 2;
    c.boostHold = v.getUint8(o++) / 500;
    c.groundLockout = v.getUint8(o++) / 500;
    c.respawn = v.getUint16(o, true) / 1000; o += 2;
    c.flipDirX = v.getInt8(o++) / 127; c.flipDirY = v.getInt8(o++) / 127;
    cars.push(c);
  }
  return { tick, phase, overtime: (fl & 1) !== 0, expiring: (fl & 2) !== 0, clock, phaseTimer, score, winner, ball, pads, cars };
}

/** Overwrites the sim's dynamic state with a decoded snapshot. */
export function applySnapshot(sim: GameSim, s: SnapData): void {
  sim.tick = s.tick;
  sim.phase = s.phase as GameSim['phase'];
  sim.overtime = s.overtime; sim.expiring = s.expiring; sim.clock = s.clock; sim.phaseTimer = s.phaseTimer;
  sim.score[0] = s.score[0]; sim.score[1] = s.score[1]; sim.winner = s.winner;
  const b = sim.ball, sb = s.ball;
  b.pos.x = sb.px; b.pos.y = sb.py; b.pos.z = sb.pz;
  b.vel.x = sb.vx; b.vel.y = sb.vy; b.vel.z = sb.vz;
  b.rot.x = sb.qx; b.rot.y = sb.qy; b.rot.z = sb.qz; b.rot.w = sb.qw;
  b.angVel.x = sb.wx; b.angVel.y = sb.wy; b.angVel.z = sb.wz;
  for (let i = 0; i < sim.pads.length; i++) {
    sim.pads[i].active = s.pads[i] === 0;
    sim.pads[i].timer = s.pads[i];
  }
  for (let i = 0; i < sim.cars.length && i < s.cars.length; i++) applyCar(sim.cars[i], s.cars[i]);
}

export function applyCar(c: CarState, d: CarSnapData): void {
  c.pos.x = d.px; c.pos.y = d.py; c.pos.z = d.pz;
  c.vel.x = d.vx; c.vel.y = d.vy; c.vel.z = d.vz;
  c.angVel.x = d.wx; c.angVel.y = d.wy; c.angVel.z = d.wz;
  const l = Math.hypot(d.qx, d.qy, d.qz, d.qw) || 1;
  c.rot.x = d.qx / l; c.rot.y = d.qy / l; c.rot.z = d.qz / l; c.rot.w = d.qw / l;
  mat3.fromQuat(c.basis, c.rot);
  c.boost = d.boost;
  const f = d.flags;
  c.onGround = (f & F_ONGROUND) !== 0; c.jumped = (f & F_JUMPED) !== 0; c.jumpHeld = (f & F_JUMPHELD) !== 0;
  c.flipUsed = (f & F_FLIPUSED) !== 0; c.flipActive = (f & F_FLIPACTIVE) !== 0; c.flipCancel = (f & F_FLIPCANCEL) !== 0;
  c.supersonic = (f & F_SUPERSONIC) !== 0; c.boosting = (f & F_BOOSTING) !== 0; c.demolished = (f & F_DEMOLISHED) !== 0;
  c.prevJump = (f & F_PREVJUMP) !== 0; c.prevBoost = (f & F_PREVBOOST) !== 0; c.prevRecover = (f & F_PREVRECOVER) !== 0; c.autoRight = (f & F_AUTORIGHT) !== 0;
  c.jumpTimer = d.jumpTimer; c.airTime = d.airTime; c.flipTimer = d.flipTimer; c.pitchLock = d.pitchLock;
  c.boostHold = d.boostHold; c.groundLockout = d.groundLockout; c.respawnTimer = d.respawn;
  c.flipDirX = d.flipDirX; c.flipDirY = d.flipDirY;
  c.wheelContacts = c.onGround ? 4 : 0;
}

/** Ticks per second as a convenience for clock-sync maths. */
export const TICKS_PER_SEC = PHYSICS.tickRate;

// ---- lobby / control messages (JSON) --------------------------------------------------------

export interface LobbyPlayer { id: number; name: string; team: 0 | 1; ready: boolean; host: boolean }

export type ClientMsg =
  | { t: 'create'; name: string; mode: 1 | 2; v: number }
  | { t: 'join'; name: string; code: string; v: number }
  | { t: 'team'; team: 0 | 1 }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'rematch' }
  | { t: 'leave' }
  | { t: 'ping'; c: number };

export type ServerMsg =
  | { t: 'welcome'; id: number; code: string; v: number }
  | { t: 'lobby'; code: string; mode: 1 | 2; hostId: number; state: 'lobby' | 'playing' | 'ended'; players: LobbyPlayer[] }
  | { t: 'start'; you: number; players: { name: string; team: 0 | 1 }[]; seed: number; matchLength: number; tick: number }
  | { t: 'ev'; type: string; a: number; b: number; v: number }
  | { t: 'stats'; stats: { goals: number; saves: number; shots: number; demos: number; score: number }[] }
  | { t: 'pong'; c: number; tick: number }
  | { t: 'left'; name: string }
  | { t: 'err'; msg: string };
