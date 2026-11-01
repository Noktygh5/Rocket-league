import { describe, expect, it } from 'vitest';
import { Mat3, mat3, Quat, quat, vec3, Vec3, curve, CAR, BALL, PADS, mirrorPads } from '../src';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('vec3', () => {
  it('cross of axes is right-handed', () => {
    const o = vec3.cross(new Vec3(), new Vec3(1, 0, 0), new Vec3(0, 1, 0));
    expect(vec3.equals(o, new Vec3(0, 0, 1))).toBe(true);
  });
  it('clampLength caps length and leaves short vectors alone', () => {
    close(vec3.length(vec3.clampLength(new Vec3(), new Vec3(3000, 4000, 0), 1000)), 1000);
    expect(vec3.clampLength(new Vec3(), new Vec3(1, 2, 3), 100).z).toBe(3);
  });
  it('normalize of zero stays zero', () => {
    expect(vec3.length(vec3.normalize(new Vec3(), new Vec3()))).toBe(0);
  });
  it('supports aliasing out with an input', () => {
    const a = new Vec3(1, 2, 3);
    vec3.add(a, a, a);
    expect(vec3.equals(a, new Vec3(2, 4, 6))).toBe(true);
  });
});

describe('quat', () => {
  it('90deg yaw rotates +X to +Y', () => {
    const q = quat.fromYaw(new Quat(), Math.PI / 2);
    const v = quat.rotate(new Vec3(), q, new Vec3(1, 0, 0));
    expect(vec3.equals(v, new Vec3(0, 1, 0), 1e-9)).toBe(true);
  });
  it('rotateInverse undoes rotate', () => {
    const q = quat.normalize(new Quat(), new Quat(0.3, -0.5, 0.2, 0.8));
    const v = new Vec3(1, 2, 3);
    const r = quat.rotateInverse(new Vec3(), q, quat.rotate(new Vec3(), q, v));
    expect(vec3.equals(r, v, 1e-9)).toBe(true);
  });
  it('mul composes rotations (b first, then a)', () => {
    const a = quat.fromYaw(new Quat(), Math.PI / 2);
    const b = quat.fromAxisAngle(new Quat(), 1, 0, 0, Math.PI / 2);
    const ab = quat.mul(new Quat(), a, b);
    const v = new Vec3(0, 1, 0);
    const viaMul = quat.rotate(new Vec3(), ab, v);
    const viaSteps = quat.rotate(new Vec3(), a, quat.rotate(new Vec3(), b, v));
    expect(vec3.equals(viaMul, viaSteps, 1e-9)).toBe(true);
  });
  it('integrating constant angular velocity matches the closed-form rotation', () => {
    const q = quat.create();
    const w = 3, dt = 1 / 120, steps = 240; // 2 s about Z
    for (let i = 0; i < steps; i++) quat.integrate(q, q, 0, 0, w, dt);
    const ref = quat.fromYaw(new Quat(), w * dt * steps);
    close(Math.abs(quat.dot(q, ref)), 1, 1e-4);
  });
  it('slerp midpoint', () => {
    const a = quat.create();
    const b = quat.fromYaw(new Quat(), Math.PI / 2);
    const mid = quat.slerp(new Quat(), a, b, 0.5);
    close(Math.abs(quat.dot(mid, quat.fromYaw(new Quat(), Math.PI / 4))), 1);
  });
});

describe('mat3', () => {
  it('fromQuat matches quat.rotate and columns are body axes', () => {
    const q = quat.normalize(new Quat(), new Quat(0.1, 0.7, -0.3, 0.5));
    const m = mat3.fromQuat(new Mat3(), q);
    const v = new Vec3(4, -2, 7);
    expect(vec3.equals(mat3.mulVec(new Vec3(), m, v), quat.rotate(new Vec3(), q, v), 1e-9)).toBe(true);
    const fwd = mat3.getColumn(new Vec3(), m, 0);
    expect(vec3.equals(fwd, quat.rotate(new Vec3(), q, new Vec3(1, 0, 0)), 1e-9)).toBe(true);
  });
  it('mulVecTransposed inverts a rotation', () => {
    const q = quat.fromAxisAngle(new Quat(), 0, 0, 1, 1.1);
    const m = mat3.fromQuat(new Mat3(), q);
    const v = new Vec3(1, 2, 3);
    const back = mat3.mulVecTransposed(new Vec3(), m, mat3.mulVec(new Vec3(), m, v));
    expect(vec3.equals(back, v, 1e-9)).toBe(true);
  });
  it('mul and transpose give identity for a rotation', () => {
    const m = mat3.fromQuat(new Mat3(), quat.fromYaw(new Quat(), 0.7));
    const p = mat3.mul(new Mat3(), m, mat3.transpose(new Mat3(), m));
    for (let i = 0; i < 9; i++) close(p.m[i], i % 4 === 0 ? 1 : 0);
  });
});

describe('curve', () => {
  it('interpolates and clamps the throttle curve', () => {
    const t = CAR.drive.throttleAccelCurve;
    close(curve(t, 0), 1600);
    close(curve(t, 1400), 160);
    close(curve(t, 1410), 0);
    close(curve(t, 2300), 0);
    close(curve(t, 700), 880);
  });
  it('steer curve hits its table points', () => {
    close(curve(CAR.drive.steerCurve, 500), 0.3193);
    close(curve(CAR.drive.steerCurve, 5000), 0.0345);
  });
});

describe('constants', () => {
  it('pad layout is 4 large and 14 small', () => {
    expect(mirrorPads(PADS.largeBase)).toHaveLength(4);
    expect(mirrorPads(PADS.smallBase)).toHaveLength(14);
  });
  it('ball curve x is ascending', () => {
    const t = BALL.carHit.extraImpulseCurve;
    for (let i = 2; i < t.length; i += 2) expect(t[i]).toBeGreaterThan(t[i - 2]);
  });
});
