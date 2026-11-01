import type { Vec3 } from './vec3';

// Unit quaternion (x, y, z, w). Allocation-free: ops write into `out`.

export class Quat {
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
}

export const quat = {
  create: (): Quat => new Quat(),
  identity(out: Quat): Quat {
    out.x = 0; out.y = 0; out.z = 0; out.w = 1;
    return out;
  },
  set(out: Quat, x: number, y: number, z: number, w: number): Quat {
    out.x = x; out.y = y; out.z = z; out.w = w;
    return out;
  },
  copy(out: Quat, a: Quat): Quat {
    out.x = a.x; out.y = a.y; out.z = a.z; out.w = a.w;
    return out;
  },
  /** out = a * b (apply b first, then a). */
  mul(out: Quat, a: Quat, b: Quat): Quat {
    const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
    const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
    const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
    const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
    out.x = x; out.y = y; out.z = z; out.w = w;
    return out;
  },
  conjugate(out: Quat, a: Quat): Quat {
    out.x = -a.x; out.y = -a.y; out.z = -a.z; out.w = a.w;
    return out;
  },
  normalize(out: Quat, a: Quat): Quat {
    const l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z + a.w * a.w);
    if (l < 1e-12) return quat.identity(out);
    const inv = 1 / l;
    out.x = a.x * inv; out.y = a.y * inv; out.z = a.z * inv; out.w = a.w * inv;
    return out;
  },
  /** (ax, ay, az) must be unit length. */
  fromAxisAngle(out: Quat, ax: number, ay: number, az: number, angle: number): Quat {
    const s = Math.sin(angle * 0.5);
    out.x = ax * s; out.y = ay * s; out.z = az * s; out.w = Math.cos(angle * 0.5);
    return out;
  },
  /** Rotation about Z (yaw), used for spawn orientation. */
  fromYaw(out: Quat, yaw: number): Quat {
    return quat.set(out, 0, 0, Math.sin(yaw * 0.5), Math.cos(yaw * 0.5));
  },
  /** Rotates v by q into `out` (out may alias v). */
  rotate(out: Vec3, q: Quat, v: Vec3): Vec3 {
    const vx = v.x, vy = v.y, vz = v.z;
    // t = 2 * cross(q.xyz, v)
    const tx = 2 * (q.y * vz - q.z * vy);
    const ty = 2 * (q.z * vx - q.x * vz);
    const tz = 2 * (q.x * vy - q.y * vx);
    out.x = vx + q.w * tx + (q.y * tz - q.z * ty);
    out.y = vy + q.w * ty + (q.z * tx - q.x * tz);
    out.z = vz + q.w * tz + (q.x * ty - q.y * tx);
    return out;
  },
  /** Rotates by the inverse of q. */
  rotateInverse(out: Vec3, q: Quat, v: Vec3): Vec3 {
    const vx = v.x, vy = v.y, vz = v.z;
    const qx = -q.x, qy = -q.y, qz = -q.z;
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    out.x = vx + q.w * tx + (qy * tz - qz * ty);
    out.y = vy + q.w * ty + (qz * tx - qx * tz);
    out.z = vz + q.w * tz + (qx * ty - qy * tx);
    return out;
  },
  /** Integrates a world-space angular velocity over dt: q' = normalize(q + 0.5*dt*(w,0)*q). */
  integrate(out: Quat, q: Quat, wx: number, wy: number, wz: number, dt: number): Quat {
    const h = 0.5 * dt;
    const dx = h * (wx * q.w + wy * q.z - wz * q.y);
    const dy = h * (wy * q.w + wz * q.x - wx * q.z);
    const dz = h * (wz * q.w + wx * q.y - wy * q.x);
    const dw = h * (-wx * q.x - wy * q.y - wz * q.z);
    out.x = q.x + dx; out.y = q.y + dy; out.z = q.z + dz; out.w = q.w + dw;
    return quat.normalize(out, out);
  },
  dot: (a: Quat, b: Quat): number => a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w,
  /** Shortest-path spherical interpolation. */
  slerp(out: Quat, a: Quat, b: Quat, t: number): Quat {
    let d = quat.dot(a, b);
    let bx = b.x, by = b.y, bz = b.z, bw = b.w;
    if (d < 0) { d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let s0: number, s1: number;
    if (d > 0.9995) {
      s0 = 1 - t; s1 = t; // nearly parallel: lerp
    } else {
      const th = Math.acos(d);
      const sin = Math.sin(th);
      s0 = Math.sin((1 - t) * th) / sin;
      s1 = Math.sin(t * th) / sin;
    }
    out.x = a.x * s0 + bx * s1; out.y = a.y * s0 + by * s1;
    out.z = a.z * s0 + bz * s1; out.w = a.w * s0 + bw * s1;
    return quat.normalize(out, out);
  },
};
