import type { Quat } from './quat';
import type { Vec3 } from './vec3';

// 3x3 matrix, row-major: [m00 m01 m02 / m10 m11 m12 / m20 m21 m22].
// Columns of a rotation matrix built from a quaternion are the body axes in world space.

export class Mat3 {
  m = new Float64Array(9);
  constructor() {
    this.m[0] = 1; this.m[4] = 1; this.m[8] = 1;
  }
}

export const mat3 = {
  create: (): Mat3 => new Mat3(),
  identity(out: Mat3): Mat3 {
    out.m.fill(0);
    out.m[0] = 1; out.m[4] = 1; out.m[8] = 1;
    return out;
  },
  copy(out: Mat3, a: Mat3): Mat3 {
    out.m.set(a.m);
    return out;
  },
  fromQuat(out: Mat3, q: Quat): Mat3 {
    const { x, y, z, w } = q;
    const xx = x * x, yy = y * y, zz = z * z;
    const xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
    const m = out.m;
    m[0] = 1 - 2 * (yy + zz); m[1] = 2 * (xy - wz);     m[2] = 2 * (xz + wy);
    m[3] = 2 * (xy + wz);     m[4] = 1 - 2 * (xx + zz); m[5] = 2 * (yz - wx);
    m[6] = 2 * (xz - wy);     m[7] = 2 * (yz + wx);     m[8] = 1 - 2 * (xx + yy);
    return out;
  },
  /** out = a * b. `out` must not alias a or b. */
  mul(out: Mat3, a: Mat3, b: Mat3): Mat3 {
    const A = a.m, B = b.m, O = out.m;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        O[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
      }
    }
    return out;
  },
  /** `out` must not alias `a`. */
  transpose(out: Mat3, a: Mat3): Mat3 {
    const A = a.m, O = out.m;
    O[0] = A[0]; O[1] = A[3]; O[2] = A[6];
    O[3] = A[1]; O[4] = A[4]; O[5] = A[7];
    O[6] = A[2]; O[7] = A[5]; O[8] = A[8];
    return out;
  },
  mulVec(out: Vec3, a: Mat3, v: Vec3): Vec3 {
    const m = a.m, x = v.x, y = v.y, z = v.z;
    out.x = m[0] * x + m[1] * y + m[2] * z;
    out.y = m[3] * x + m[4] * y + m[5] * z;
    out.z = m[6] * x + m[7] * y + m[8] * z;
    return out;
  },
  /** Multiplies by the transpose (world -> body for a rotation matrix). */
  mulVecTransposed(out: Vec3, a: Mat3, v: Vec3): Vec3 {
    const m = a.m, x = v.x, y = v.y, z = v.z;
    out.x = m[0] * x + m[3] * y + m[6] * z;
    out.y = m[1] * x + m[4] * y + m[7] * z;
    out.z = m[2] * x + m[5] * y + m[8] * z;
    return out;
  },
  /** Writes column `c` (a body axis for rotation matrices). */
  getColumn(out: Vec3, a: Mat3, c: number): Vec3 {
    out.x = a.m[c]; out.y = a.m[3 + c]; out.z = a.m[6 + c];
    return out;
  },
  /** Diagonal matrix, e.g. for inertia tensors. */
  diag(out: Mat3, x: number, y: number, z: number): Mat3 {
    out.m.fill(0);
    out.m[0] = x; out.m[4] = y; out.m[8] = z;
    return out;
  },
};
