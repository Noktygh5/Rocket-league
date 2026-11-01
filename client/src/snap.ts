import type { PlayerStats, SimEvent } from '@turboball/shared';

/** Everything the presentation layer (camera, world, HUD, audio) needs for one displayed frame. */
export interface CarSnap {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number;
  team: 0 | 1;
  boost: number;
  boosting: boolean;
  supersonic: boolean;
  demolished: boolean;
  onGround: boolean;
  /** Surface normal while driving. */
  nx: number; ny: number; nz: number;
  /** Forward axis in world space. */
  fx: number; fy: number; fz: number;
  steer: number;
  throttle: number;
}

export interface BallSnap {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number;
}

export interface RenderSnap {
  cars: CarSnap[];
  ball: BallSnap;
  padActive: boolean[];
  padTimer: number[];
  score: [number, number];
  clock: number;
  overtime: boolean;
  /** 0 countdown, 1 playing, 2 goal, 3 ended */
  phase: number;
  countdown: number;
  localIndex: number;
  stats: PlayerStats[];
  events: SimEvent[];
  winner: number;
  /** Seconds since the current phase began (goal celebration / replay timing). */
  phaseElapsed: number;
}

function carSnap(): CarSnap {
  return {
    x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, team: 0, boost: 33, boosting: false,
    supersonic: false, demolished: false, onGround: true, nx: 0, ny: 0, nz: 1, fx: 1, fy: 0, fz: 0, steer: 0, throttle: 0,
  };
}

export function makeSnap(nCars: number): RenderSnap {
  return {
    cars: Array.from({ length: nCars }, carSnap),
    ball: { x: 0, y: 0, z: 92, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0 },
    padActive: new Array(34).fill(true),
    padTimer: new Array(34).fill(0),
    score: [0, 0],
    clock: 300, overtime: false, phase: 0, countdown: 3, localIndex: 0,
    stats: Array.from({ length: nCars }, () => ({ goals: 0, saves: 0, shots: 0, demos: 0, score: 0 })),
    events: [], winner: -1, phaseElapsed: 0,
  };
}

/** Shortest-path normalised lerp between two quaternions into (out). */
export function nlerpQuat(
  out: { qx: number; qy: number; qz: number; qw: number },
  ax: number, ay: number, az: number, aw: number,
  bx: number, by: number, bz: number, bw: number, t: number,
): void {
  const d = ax * bx + ay * by + az * bz + aw * bw;
  const s = d < 0 ? -1 : 1;
  let x = ax + (bx * s - ax) * t, y = ay + (by * s - ay) * t, z = az + (bz * s - az) * t, w = aw + (bw * s - aw) * t;
  const l = Math.hypot(x, y, z, w) || 1;
  x /= l; y /= l; z /= l; w /= l;
  out.qx = x; out.qy = y; out.qz = z; out.qw = w;
}
