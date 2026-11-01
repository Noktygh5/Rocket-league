import { BALL, PHYSICS } from './constants';
import * as arena from './arena';
import { Quat, quat } from './math/quat';
import { Vec3, vec3 } from './math/vec3';

export class BallState {
  pos = new Vec3(BALL.spawn.x, BALL.spawn.y, BALL.spawn.z);
  vel = new Vec3();
  angVel = new Vec3();
  rot = new Quat();
  /** Set when the ball touched the arena this tick (used for overtime-end logic and audio). */
  hitSurface = false;
  /** Largest normal speed of an arena impact this tick (audio). */
  impactSpeed = 0;
}

export function resetBall(b: BallState): void {
  vec3.set(b.pos, BALL.spawn.x, BALL.spawn.y, BALL.spawn.z);
  vec3.set(b.vel, 0, 0, 0);
  vec3.set(b.angVel, 0, 0, 0);
  quat.identity(b.rot);
  b.hitSurface = false;
  b.impactSpeed = 0;
}

export function copyBall(out: BallState, a: BallState): void {
  vec3.copy(out.pos, a.pos);
  vec3.copy(out.vel, a.vel);
  vec3.copy(out.angVel, a.angVel);
  quat.copy(out.rot, a.rot);
  out.hitSurface = a.hitSurface;
  out.impactSpeed = a.impactSpeed;
}

const n = new Vec3();
const SPHERE_INERTIA = 0.4; // I = 0.4 m r^2

/** Resolves the ball against the arena by position projection + impulse (restitution and friction). */
export function collideBallArena(b: BallState): void {
  const R = BALL.radius;
  const p = b.pos;
  const d = arena.sdf(p.x, p.y, p.z);
  if (d >= R) return;
  arena.normal(n, p.x, p.y, p.z);
  const pen = R - d;
  p.x += n.x * pen; p.y += n.y * pen; p.z += n.z * pen;

  const v = b.vel;
  const vn = v.x * n.x + v.y * n.y + v.z * n.z;
  b.hitSurface = true;
  if (vn >= 0) return;
  // Low-speed contacts get no bounce (prevents resting jitter).
  const e = -vn < 40 ? 0 : BALL.restitution;
  const jn = -(1 + e) * vn; // per unit mass
  v.x += n.x * jn; v.y += n.y * jn; v.z += n.z * jn;
  if (-vn > b.impactSpeed) b.impactSpeed = -vn;

  // Friction at contact point r = -n R.  v_c = v + w x r
  const w = b.angVel;
  const rx = -n.x * R, ry = -n.y * R, rz = -n.z * R;
  const cx = v.x + (w.y * rz - w.z * ry);
  const cy = v.y + (w.z * rx - w.x * rz);
  const cz = v.z + (w.x * ry - w.y * rx);
  const cn = cx * n.x + cy * n.y + cz * n.z;
  const tx = cx - n.x * cn, ty = cy - n.y * cn, tz = cz - n.z * cn;
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (tl < 1e-6) return;
  const ux = tx / tl, uy = ty / tl, uz = tz / tl;
  // Effective inverse mass along the tangent (per unit mass): 1 + 1/0.4
  const need = tl / (1 + 1 / SPHERE_INERTIA);
  const jt = Math.min(need, BALL.friction * jn);
  v.x -= ux * jt; v.y -= uy * jt; v.z -= uz * jt;
  // torque: dw = (r x F) / (0.4 R^2) in per-unit-mass terms
  const fx = -ux * jt, fy = -uy * jt, fz = -uz * jt;
  const k = 1 / (SPHERE_INERTIA * R * R);
  w.x += (ry * fz - rz * fy) * k;
  w.y += (rz * fx - rx * fz) * k;
  w.z += (rx * fy - ry * fx) * k;
}

export function clampBall(b: BallState): void {
  vec3.clampLength(b.vel, b.vel, BALL.maxSpeed);
  vec3.clampLength(b.angVel, b.angVel, BALL.maxAngularSpeed);
}

/** Advances the ball by dt: gravity, drag, integration, arena collision. */
export function stepBall(b: BallState, dt: number = PHYSICS.dt): void {
  b.hitSurface = false;
  b.impactSpeed = 0;
  const v = b.vel;
  const oldX = v.x, oldY = v.y, oldZ = v.z;
  v.z += PHYSICS.gravity * dt;
  const drag = 1 - BALL.drag * dt;
  v.x *= drag; v.y *= drag; v.z *= drag;
  clampBall(b);
  // trapezoidal position update: exact under constant acceleration
  b.pos.x += (oldX + v.x) * 0.5 * dt;
  b.pos.y += (oldY + v.y) * 0.5 * dt;
  b.pos.z += (oldZ + v.z) * 0.5 * dt;
  quat.integrate(b.rot, b.rot, b.angVel.x, b.angVel.y, b.angVel.z, dt);
  collideBallArena(b);
  clampBall(b);
}
