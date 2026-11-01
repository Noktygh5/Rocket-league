import { Vec3, arena, vec3 } from '@turboball/shared';
import { settings } from './settings';

/** Everything the camera needs from the sim, in sim space (Z up). */
export interface CamTarget {
  carPos: Vec3;
  carFwd: Vec3;
  carVel: Vec3;
  /** Surface normal while driving, ignored in the air. */
  surfaceNormal: Vec3;
  onGround: boolean;
  supersonic: boolean;
  ballPos: Vec3;
}

export interface CamPose {
  pos: Vec3;
  target: Vec3;
  up: Vec3;
  /** Vertical field of view in degrees. */
  fov: number;
}

const tmpA = new Vec3(), tmpB = new Vec3();
const rad = Math.PI / 180;

/** Chase camera with ball cam, level-in-air behaviour and smooth wall/ceiling re-orientation. */
export class ChaseCamera {
  ballCam = true;
  rearView = false;
  private pos = new Vec3(0, -600, 300);
  private dir = new Vec3(0, 1, 0);
  private up = new Vec3(0, 0, 1);
  private blend = 1;
  private fovExtra = 0;
  private shake = 0;
  private initialised = false;
  private groundW = 1;
  private upTarget = new Vec3(0, 0, 1);
  aspect = 16 / 9;

  addShake(v: number): void {
    this.shake = Math.min(1.5, this.shake + v);
  }

  /** Snap to the target (kickoff, replay start). */
  reset(): void {
    this.initialised = false;
  }

  update(dt: number, t: CamTarget, out: CamPose): CamPose {
    const s = settings.camera;
    // camera up: follow the surface while driving, return to world up in the air
    // A smoothed 0..1 "on a surface" weight stops wheel-contact flicker from jerking the horizon.
    this.groundW += ((t.onGround ? 1 : 0) - this.groundW) * (1 - Math.exp(-(t.onGround ? 5 : 2.2) * dt));
    // Tilt only part of the way toward the surface normal so wall rides stay readable.
    const surf = Math.acos(Math.max(-1, Math.min(1, vec3.dot(WORLD_UP, t.surfaceNormal))));
    const frac = surf > 1e-3 ? Math.min(1, MAX_TILT / surf) : 0;
    slerpUnit(this.upTarget, WORLD_UP, t.surfaceNormal, frac * this.groundW, this.dir);
    slerpUnit(this.up, this.up, this.upTarget, 1 - Math.exp(-3.5 * dt), this.dir);

    // car heading flattened onto the camera plane
    const f = flatten(tmpA, t.carFwd, this.up);
    if (vec3.lengthSq(f) < 1e-4) vec3.copy(f, this.dir);
    // ball direction on the same plane
    vec3.sub(tmpB, t.ballPos, t.carPos);
    const bd = flatten(tmpB, tmpB, this.up);
    const ballOk = vec3.lengthSq(bd) > 400;

    const want = this.ballCam && ballOk && !this.rearView ? 1 : 0;
    const tr = 0.6 + s.transitionSpeed * 2.4;
    this.blend += Math.sign(want - this.blend) * Math.min(Math.abs(want - this.blend), tr * dt);

    // target heading
    const h = vec3.create();
    const sign = this.rearView ? -1 : 1;
    h.x = f.x * sign * (1 - this.blend) + (ballOk ? bd.x : f.x) * this.blend;
    h.y = f.y * sign * (1 - this.blend) + (ballOk ? bd.y : f.y) * this.blend;
    h.z = f.z * sign * (1 - this.blend) + (ballOk ? bd.z : f.z) * this.blend;
    vec3.normalize(h, h);
    if (vec3.lengthSq(h) < 0.5) vec3.copy(h, this.dir);
    const sw = 1 - Math.exp(-s.swivelSpeed * (this.blend > 0.5 ? 1.6 : 1) * dt);
    vec3.lerp(this.dir, this.dir, h, this.initialised ? sw : 1);
    vec3.normalize(this.dir, this.dir);

    // desired camera position: behind the car, above it
    const dist = s.distance, height = s.height;
    const pCar = vec3.create(), pBall = vec3.create();
    pCar.x = t.carPos.x - this.dir.x * dist + this.up.x * height;
    pCar.y = t.carPos.y - this.dir.y * dist + this.up.y * height;
    pCar.z = t.carPos.z - this.dir.z * dist + this.up.z * height;
    // ball cam: sit on the ball->car line (3D) so the car is always between camera and ball
    vec3.sub(tmpB, t.ballPos, t.carPos);
    vec3.normalize(tmpB, tmpB);
    pBall.x = t.carPos.x - tmpB.x * dist + this.up.x * height;
    pBall.y = t.carPos.y - tmpB.y * dist + this.up.y * height;
    pBall.z = t.carPos.z - tmpB.z * dist + this.up.z * height;
    const b = this.blend;
    const pd = vec3.create();
    vec3.lerp(pd, pCar, pBall, b * b * (3 - 2 * b));

    const rate = 5 + 80 * Math.pow(s.stiffness, 1.3);
    vec3.lerp(this.pos, this.pos, pd, this.initialised ? 1 - Math.exp(-rate * dt) : 1);
    this.initialised = true;

    // keep the camera inside the arena
    const d = arena.sdf(this.pos.x, this.pos.y, this.pos.z);
    if (d < 45) {
      arena.normal(tmpB, this.pos.x, this.pos.y, this.pos.z);
      const push = 45 - d;
      this.pos.x += tmpB.x * push; this.pos.y += tmpB.y * push; this.pos.z += tmpB.z * push;
    }

    // look direction
    const right = vec3.cross(vec3.create(), this.dir, this.up);
    const pitch = s.angle * rad;
    const look = vec3.create();
    // rotate dir about `right` by pitch
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    look.x = this.dir.x * cp + this.up.x * sp;
    look.y = this.dir.y * cp + this.up.y * sp;
    look.z = this.dir.z * cp + this.up.z * sp;
    void right;
    // ball cam aims at the ball (pitch clamped so the car stays in frame)
    vec3.sub(tmpB, t.ballPos, this.pos);
    vec3.normalize(tmpB, tmpB);
    const el = Math.asin(Math.max(-1, Math.min(1, vec3.dot(tmpB, this.up))));
    const clamped = Math.max(-25 * rad, Math.min(32 * rad, el));
    if (clamped !== el) {
      // rebuild direction with clamped elevation, preserving azimuth
      const flatB = flatten(vec3.create(), tmpB, this.up);
      vec3.normalize(flatB, flatB);
      tmpB.x = flatB.x * Math.cos(clamped) + this.up.x * Math.sin(clamped);
      tmpB.y = flatB.y * Math.cos(clamped) + this.up.y * Math.sin(clamped);
      tmpB.z = flatB.z * Math.cos(clamped) + this.up.z * Math.sin(clamped);
    }
    const bw = this.blend * (this.rearView ? 0 : 1);
    out.target.x = this.pos.x + (look.x * (1 - bw) + tmpB.x * bw) * 1500;
    out.target.y = this.pos.y + (look.y * (1 - bw) + tmpB.y * bw) * 1500;
    out.target.z = this.pos.z + (look.z * (1 - bw) + tmpB.z * bw) * 1500;

    // shake
    if (this.shake > 0.001) {
      const a = this.shake * 9;
      out.target.x += (Math.random() - 0.5) * a * 12; out.target.y += (Math.random() - 0.5) * a * 12;
      out.target.z += (Math.random() - 0.5) * a * 12;
      this.shake *= Math.exp(-7 * dt);
    }
    vec3.copy(out.pos, this.pos);
    vec3.copy(out.up, this.up);

    // FOV: horizontal setting -> vertical, widen slightly at supersonic
    this.fovExtra += ((t.supersonic ? 6 : 0) - this.fovExtra) * (1 - Math.exp(-3 * dt));
    const hf = (s.fov + this.fovExtra) * rad;
    out.fov = (2 * Math.atan(Math.tan(hf / 2) / this.aspect)) / rad;
    return out;
  }
}

const WORLD_UP = new Vec3(0, 0, 1);

/** Projects `v` onto the plane perpendicular to unit `n`, normalised. */
function flatten(out: Vec3, v: Vec3, n: Vec3): Vec3 {
  const d = vec3.dot(v, n);
  out.x = v.x - n.x * d; out.y = v.y - n.y * d; out.z = v.z - n.z * d;
  return vec3.normalize(out, out);
}

/** The camera horizon never tilts more than this far from upright, even on walls and ceilings. */
const MAX_TILT = (65 * Math.PI) / 180;

/** Spherical interpolation between unit vectors; `hint` supplies a rotation axis when they are opposite. */
function slerpUnit(out: Vec3, a: Vec3, b: Vec3, t: number, hint: Vec3): Vec3 {
  let d = vec3.dot(a, b);
  d = Math.max(-1, Math.min(1, d));
  const ang = Math.acos(d);
  if (ang < 1e-4 || t <= 0) return t >= 1 ? vec3.copy(out, b) : vec3.copy(out, a);
  const ax = a.x, ay = a.y, az = a.z;
  if (Math.PI - ang < 1e-3) {
    // opposite vectors: rotate about the heading axis
    const axis = vec3.cross(vec3.create(), a, hint);
    if (vec3.lengthSq(axis) < 1e-6) vec3.set(axis, 1, 0, 0);
    vec3.normalize(axis, axis);
    const th = Math.PI * t, c = Math.cos(th), s = Math.sin(th);
    const cr = vec3.cross(vec3.create(), axis, a);
    out.x = ax * c + cr.x * s; out.y = ay * c + cr.y * s; out.z = az * c + cr.z * s;
    return vec3.normalize(out, out);
  }
  const s0 = Math.sin((1 - t) * ang) / Math.sin(ang), s1 = Math.sin(t * ang) / Math.sin(ang);
  out.x = ax * s0 + b.x * s1; out.y = ay * s0 + b.y * s1; out.z = az * s0 + b.z * s1;
  return vec3.normalize(out, out);
}
