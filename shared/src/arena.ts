import { ARENA } from './constants';
import type { Vec3 } from './math/vec3';

// Analytic arena. `sdf` is the signed distance to the playable-volume boundary, POSITIVE inside.
// Playable volume = rounded box (plan corners radius cornerRadius, floor/ceiling ramps radius
// rampRadius) unioned with a goal box behind each back wall. Symmetric in x and y.

const GOAL_Y_MIN = ARENA.halfLength - 300; // goal box overlaps the main volume so the union has no seam

/** Plan-view inside distance to the side/back walls (positive inside). */
function planInside(ax: number, ay: number): number {
  const rc = ARENA.cornerRadius;
  const qx = ax - (ARENA.halfWidth - rc);
  const qy = ay - (ARENA.halfLength - rc);
  const ox = qx > 0 ? qx : 0;
  const oy = qy > 0 ? qy : 0;
  const m = qx > qy ? qx : qy;
  return -(Math.sqrt(ox * ox + oy * oy) + (m < 0 ? m : 0) - rc);
}

function mainInside(ax: number, ay: number, z: number): number {
  const r = ARENA.rampRadius;
  const q1 = r - planInside(ax, ay);
  const q2 = r - z;
  const q3 = r - (ARENA.ceilingHeight - z);
  const m1 = q1 > 0 ? q1 : 0;
  const m2 = q2 > 0 ? q2 : 0;
  const m3 = q3 > 0 ? q3 : 0;
  let mx = q1 > q2 ? q1 : q2;
  if (q3 > mx) mx = q3;
  return -(Math.sqrt(m1 * m1 + m2 * m2 + m3 * m3) + (mx < 0 ? mx : 0) - r);
}

function goalInside(ax: number, ay: number, z: number): number {
  const g = ARENA.goal;
  const q1 = ax - g.halfWidth; // outside if > 0
  const q2 = ay < (GOAL_Y_MIN + g.backY) / 2 ? GOAL_Y_MIN - ay : ay - g.backY;
  const dzLo = -z, dzHi = z - g.height;
  const q3 = dzLo > dzHi ? dzLo : dzHi;
  const m1 = q1 > 0 ? q1 : 0;
  const m2 = q2 > 0 ? q2 : 0;
  const m3 = q3 > 0 ? q3 : 0;
  let mx = q1 > q2 ? q1 : q2;
  if (q3 > mx) mx = q3;
  return -(Math.sqrt(m1 * m1 + m2 * m2 + m3 * m3) + (mx < 0 ? mx : 0));
}

export function sdf(x: number, y: number, z: number): number {
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  const a = mainInside(ax, ay, z);
  // The goal box only matters near the back walls and low down; skip it elsewhere.
  if (ay < GOAL_Y_MIN - 400 || z > ARENA.goal.height + 400) return a;
  const b = goalInside(ax, ay, z);
  return a > b ? a : b;
}

/** Unit normal pointing into the playable volume (gradient of sdf), central differences. */
export function normal(out: Vec3, x: number, y: number, z: number): Vec3 {
  const e = 0.5;
  const nx = sdf(x + e, y, z) - sdf(x - e, y, z);
  const ny = sdf(x, y + e, z) - sdf(x, y - e, z);
  const nz = sdf(x, y, z + e) - sdf(x, y, z - e);
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (l < 1e-9) {
    out.x = 0; out.y = 0; out.z = 1;
  } else {
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
  }
  return out;
}

/**
 * Sphere-traces from an interior origin along a unit direction. Returns the hit distance
 * (writing the surface normal to outN) or -1 if nothing is hit within maxLen.
 */
export function raycast(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxLen: number, outN: Vec3,
): number {
  let t = 0;
  for (let i = 0; i < 48; i++) {
    const d = sdf(ox + dx * t, oy + dy * t, oz + dz * t);
    if (d < 0.02) {
      normal(outN, ox + dx * t, oy + dy * t, oz + dz * t);
      return t;
    }
    t += d;
    if (t > maxLen) return -1;
  }
  normal(outN, ox + dx * t, oy + dy * t, oz + dz * t);
  return t <= maxLen ? t : -1;
}

/** +1 when a ball of radius r at y is fully past the Orange goal line, -1 for the Blue goal line, else 0. */
export function goalSide(y: number, r: number): number {
  if (y > ARENA.halfLength + r) return 1;
  if (y < -ARENA.halfLength - r) return -1;
  return 0;
}
