// Allocation-free vector math. Every op writes into `out` (which may alias an input) and returns it.

export class Vec3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
}

export const vec3 = {
  create: (x = 0, y = 0, z = 0): Vec3 => new Vec3(x, y, z),
  set(out: Vec3, x: number, y: number, z: number): Vec3 {
    out.x = x; out.y = y; out.z = z;
    return out;
  },
  copy(out: Vec3, a: Vec3): Vec3 {
    out.x = a.x; out.y = a.y; out.z = a.z;
    return out;
  },
  clone: (a: Vec3): Vec3 => new Vec3(a.x, a.y, a.z),
  add(out: Vec3, a: Vec3, b: Vec3): Vec3 {
    out.x = a.x + b.x; out.y = a.y + b.y; out.z = a.z + b.z;
    return out;
  },
  sub(out: Vec3, a: Vec3, b: Vec3): Vec3 {
    out.x = a.x - b.x; out.y = a.y - b.y; out.z = a.z - b.z;
    return out;
  },
  scale(out: Vec3, a: Vec3, s: number): Vec3 {
    out.x = a.x * s; out.y = a.y * s; out.z = a.z * s;
    return out;
  },
  /** out = a + b * s */
  addScaled(out: Vec3, a: Vec3, b: Vec3, s: number): Vec3 {
    out.x = a.x + b.x * s; out.y = a.y + b.y * s; out.z = a.z + b.z * s;
    return out;
  },
  dot: (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z,
  cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
    const x = a.y * b.z - a.z * b.y;
    const y = a.z * b.x - a.x * b.z;
    const z = a.x * b.y - a.y * b.x;
    out.x = x; out.y = y; out.z = z;
    return out;
  },
  lengthSq: (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z,
  length: (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z),
  distance(a: Vec3, b: Vec3): number {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  },
  /** Normalizes; a zero vector stays zero. */
  normalize(out: Vec3, a: Vec3): Vec3 {
    const l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    const inv = l > 1e-12 ? 1 / l : 0;
    out.x = a.x * inv; out.y = a.y * inv; out.z = a.z * inv;
    return out;
  },
  /** Scales `a` down so its length does not exceed `max`. */
  clampLength(out: Vec3, a: Vec3, max: number): Vec3 {
    const l2 = a.x * a.x + a.y * a.y + a.z * a.z;
    if (l2 > max * max) {
      const s = max / Math.sqrt(l2);
      out.x = a.x * s; out.y = a.y * s; out.z = a.z * s;
    } else if (out !== a) {
      out.x = a.x; out.y = a.y; out.z = a.z;
    }
    return out;
  },
  lerp(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    return out;
  },
  equals(a: Vec3, b: Vec3, eps = 1e-9): boolean {
    return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps && Math.abs(a.z - b.z) <= eps;
  },
};
