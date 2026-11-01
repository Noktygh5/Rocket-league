import { BALL, CAR } from './constants';
import { BallState } from './ball';
import { CarState, applyImpulse, effectiveInvMass } from './car';
import { Vec3, vec3 } from './math/vec3';
import { curve } from './math/scalar';

const SPHERE_INERTIA = 0.4;

const n = new Vec3();
const nl = new Vec3();
const cp = new Vec3();
const rc = new Vec3();
const rb = new Vec3();
const t1 = new Vec3();
const dirV = new Vec3();
const fwd = new Vec3();

/**
 * Ball vs car hitbox. Resolves the rigid-body contact, then adds the extra hit impulse that
 * makes ball hits feel like the real thing. Returns true when the pair touched.
 */
export function collideCarBall(car: CarState, ball: BallState, tick: number): boolean {
  if (car.demolished) return false;
  const m = car.basis.m;
  const hs = CAR.hitboxSize;
  const hx = hs.x / 2, hy = hs.y / 2, hz = hs.z / 2;
  const R = BALL.radius;

  const dx = ball.pos.x - car.pos.x, dy = ball.pos.y - car.pos.y, dz = ball.pos.z - car.pos.z;
  // ball centre in car-local space
  const lx = m[0] * dx + m[3] * dy + m[6] * dz;
  const ly = m[1] * dx + m[4] * dy + m[7] * dz;
  const lz = m[2] * dx + m[5] * dy + m[8] * dz;
  const cx = lx < -hx ? -hx : lx > hx ? hx : lx;
  const cy = ly < -hy ? -hy : ly > hy ? hy : ly;
  const cz = lz < -hz ? -hz : lz > hz ? hz : lz;
  let ex = lx - cx, ey = ly - cy, ez = lz - cz;
  let dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
  if (dist >= R) return false;
  if (dist < 1e-6) {
    // centre inside the box: push out through the nearest face
    const px = hx - Math.abs(lx), py = hy - Math.abs(ly), pz = hz - Math.abs(lz);
    ex = 0; ey = 0; ez = 0;
    if (px <= py && px <= pz) ex = lx >= 0 ? 1 : -1;
    else if (py <= pz) ey = ly >= 0 ? 1 : -1;
    else ez = lz >= 0 ? 1 : -1;
    dist = 0;
  } else {
    ex /= dist; ey /= dist; ez /= dist;
  }
  vec3.set(nl, ex, ey, ez);
  // normal (car -> ball) in world space
  n.x = m[0] * ex + m[1] * ey + m[2] * ez;
  n.y = m[3] * ex + m[4] * ey + m[5] * ez;
  n.z = m[6] * ex + m[7] * ey + m[8] * ez;
  // contact point on the car (world), arms from each body centre
  cp.x = car.pos.x + m[0] * cx + m[1] * cy + m[2] * cz;
  cp.y = car.pos.y + m[3] * cx + m[4] * cy + m[5] * cz;
  cp.z = car.pos.z + m[6] * cx + m[7] * cy + m[8] * cz;
  rc.x = cp.x - car.pos.x; rc.y = cp.y - car.pos.y; rc.z = cp.z - car.pos.z;
  rb.x = -n.x * R; rb.y = -n.y * R; rb.z = -n.z * R;

  const pen = R - dist;
  ball.pos.x += n.x * pen; ball.pos.y += n.y * pen; ball.pos.z += n.z * pen;

  const bv = ball.vel, bw = ball.angVel, cv = car.vel, cw = car.angVel;
  // relative velocity of ball contact point w.r.t. car contact point
  const rvx = bv.x + (bw.y * rb.z - bw.z * rb.y) - (cv.x + (cw.y * rc.z - cw.z * rc.y));
  const rvy = bv.y + (bw.z * rb.x - bw.x * rb.z) - (cv.y + (cw.z * rc.x - cw.x * rc.z));
  const rvz = bv.z + (bw.x * rb.y - bw.y * rb.x) - (cv.z + (cw.x * rc.y - cw.y * rc.x));
  const vn = rvx * n.x + rvy * n.y + rvz * n.z;

  car.lastTouchTick = tick;
  // flip reset: the ball touched the underside of the car
  if (nl.z < -0.75 && !car.onGround) {
    car.flipUsed = false;
    car.airTime = 0;
    car.flipActive = false;
  }
  if (vn >= 0) return true;

  const ch = BALL.carHit;
  // |ball velocity - car velocity| before the impulse drives the extra impulse
  const evx = bv.x - cv.x, evy = bv.y - cv.y, evz = bv.z - cv.z;
  const relSpeed = Math.sqrt(evx * evx + evy * evy + evz * evz);

  const invMc = effectiveInvMass(car, rc, n);
  const invMb = 1 / BALL.mass;
  const J = (-(1 + ch.restitution) * vn) / (invMc + invMb);
  const jx = n.x * J, jy = n.y * J, jz = n.z * J;
  bv.x += jx * invMb; bv.y += jy * invMb; bv.z += jz * invMb;
  applyImpulse(car, rc, -jx, -jy, -jz);

  // friction (spins the ball)
  const tx = rvx - n.x * vn, ty = rvy - n.y * vn, tz = rvz - n.z * vn;
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (tl > 1e-6) {
    vec3.set(t1, tx / tl, ty / tl, tz / tl);
    const invMct = effectiveInvMass(car, rc, t1);
    const kt = invMct + invMb + 1 / (SPHERE_INERTIA * BALL.mass);
    const Jt = Math.min(tl / kt, ch.friction * J);
    const fx = -t1.x * Jt, fy = -t1.y * Jt, fz = -t1.z * Jt;
    bv.x += fx * invMb; bv.y += fy * invMb; bv.z += fz * invMb;
    const k = 1 / (SPHERE_INERTIA * BALL.mass * R * R);
    bw.x += (rb.y * fz - rb.z * fy) * k;
    bw.y += (rb.z * fx - rb.x * fz) * k;
    bw.z += (rb.x * fy - rb.y * fx) * k;
    applyImpulse(car, rc, -fx, -fy, -fz);
  }

  // Extra impulse (measured game behaviour): direction runs from the car's centre to the ball, with its
  // vertical part scaled down (flatter shots) and its component along the car's forward axis scaled by 0.65.
  const scale = curve(ch.extraImpulseCurve, relSpeed);
  vec3.set(fwd, m[0], m[3], m[6]);
  let rx = ball.pos.x - car.pos.x, ry = ball.pos.y - car.pos.y, rz = (ball.pos.z - car.pos.z) * ch.normalZScale;
  const along = rx * fwd.x + ry * fwd.y + rz * fwd.z;
  const cut = along * (1 - ch.forwardScale);
  rx -= fwd.x * cut; ry -= fwd.y * cut; rz -= fwd.z * cut;
  dirV.x = rx; dirV.y = ry; dirV.z = rz;
  vec3.normalize(dirV, dirV);
  const dv = scale * relSpeed;
  bv.x += dirV.x * dv; bv.y += dirV.y * dv; bv.z += dirV.z * dv;
  return true;
}

// ---- car vs car (OBB SAT) --------------------------------------------------------------------

const axes: Vec3[] = [];
for (let i = 0; i < 15; i++) axes.push(new Vec3());
const dd = new Vec3();
const best = new Vec3();
const pA = new Vec3();
const pB = new Vec3();
const rA = new Vec3();
const rB = new Vec3();

function axisOf(c: CarState, i: number, out: Vec3): Vec3 {
  const m = c.basis.m;
  out.x = m[i]; out.y = m[3 + i]; out.z = m[6 + i];
  return out;
}

function radius(c: CarState, a: Vec3): number {
  const m = c.basis.m, hs = CAR.hitboxSize;
  return (
    (hs.x / 2) * Math.abs(a.x * m[0] + a.y * m[3] + a.z * m[6]) +
    (hs.y / 2) * Math.abs(a.x * m[1] + a.y * m[4] + a.z * m[7]) +
    (hs.z / 2) * Math.abs(a.x * m[2] + a.y * m[5] + a.z * m[8])
  );
}

/** Closest point on a car's box to world point p. */
function closestOnBox(c: CarState, p: Vec3, out: Vec3): Vec3 {
  const m = c.basis.m, hs = CAR.hitboxSize;
  const dx = p.x - c.pos.x, dy = p.y - c.pos.y, dz = p.z - c.pos.z;
  let lx = m[0] * dx + m[3] * dy + m[6] * dz;
  let ly = m[1] * dx + m[4] * dy + m[7] * dz;
  let lz = m[2] * dx + m[5] * dy + m[8] * dz;
  const hx = hs.x / 2, hy = hs.y / 2, hz = hs.z / 2;
  lx = lx < -hx ? -hx : lx > hx ? hx : lx;
  ly = ly < -hy ? -hy : ly > hy ? hy : ly;
  lz = lz < -hz ? -hz : lz > hz ? hz : lz;
  out.x = c.pos.x + m[0] * lx + m[1] * ly + m[2] * lz;
  out.y = c.pos.y + m[3] * lx + m[4] * ly + m[5] * lz;
  out.z = c.pos.z + m[6] * lx + m[7] * ly + m[8] * lz;
  return out;
}

export const CarCarResult = {
  None: 0,
  Bumped: 1,
  /** `a` demolished `b` */
  ADemoedB: 2,
  /** `b` demolished `a` */
  BDemoedA: 3,
} as const;
export type CarCarResult = (typeof CarCarResult)[keyof typeof CarCarResult];

/** Contact point lies in the front part of the attacking car's hitbox. */
function frontContact(c: CarState, p: Vec3): boolean {
  const m = c.basis.m;
  const lx = m[0] * (p.x - c.pos.x) + m[3] * (p.y - c.pos.y) + m[6] * (p.z - c.pos.z);
  return lx > CAR.hitboxSize.x * 0.15;
}

export function collideCarCar(a: CarState, b: CarState): CarCarResult {
  if (a.demolished || b.demolished) return CarCarResult.None;
  dd.x = b.pos.x - a.pos.x; dd.y = b.pos.y - a.pos.y; dd.z = b.pos.z - a.pos.z;
  if (dd.x * dd.x + dd.y * dd.y + dd.z * dd.z > 160 * 160) return CarCarResult.None;

  let k = 0;
  for (let i = 0; i < 3; i++) axisOf(a, i, axes[k++]);
  for (let i = 0; i < 3; i++) axisOf(b, i, axes[k++]);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      vec3.cross(axes[k], axes[i], axes[3 + j]);
      const l = vec3.length(axes[k]);
      if (l < 1e-4) { vec3.set(axes[k], 0, 0, 0); } else vec3.scale(axes[k], axes[k], 1 / l);
      k++;
    }
  }
  let minPen = Infinity;
  let bestPen = 0;
  for (let i = 0; i < 15; i++) {
    const ax = axes[i];
    if (ax.x === 0 && ax.y === 0 && ax.z === 0) continue;
    const pen = radius(a, ax) + radius(b, ax) - Math.abs(dd.x * ax.x + dd.y * ax.y + dd.z * ax.z);
    if (pen <= 0) return CarCarResult.None;
    const weighted = i < 6 ? pen : pen * 1.05 + 0.5;
    if (weighted < minPen) {
      minPen = weighted;
      vec3.copy(best, ax);
      bestPen = pen;
    }
  }
  const pen = bestPen;
  // orient best (normal) from a to b
  if (best.x * dd.x + best.y * dd.y + best.z * dd.z < 0) vec3.scale(best, best, -1);

  // contact point: midpoint of each box's closest point to the other box's centre
  closestOnBox(a, b.pos, pA);
  closestOnBox(b, a.pos, pB);
  const cpx = (pA.x + pB.x) * 0.5, cpy = (pA.y + pB.y) * 0.5, cpz = (pA.z + pB.z) * 0.5;
  vec3.set(cp, cpx, cpy, cpz);
  rA.x = cpx - a.pos.x; rA.y = cpy - a.pos.y; rA.z = cpz - a.pos.z;
  rB.x = cpx - b.pos.x; rB.y = cpy - b.pos.y; rB.z = cpz - b.pos.z;

  // separate
  const half = pen * 0.5;
  a.pos.x -= best.x * half; a.pos.y -= best.y * half; a.pos.z -= best.z * half;
  b.pos.x += best.x * half; b.pos.y += best.y * half; b.pos.z += best.z * half;

  // closing speed along the normal
  const vax = a.vel.x + (a.angVel.y * rA.z - a.angVel.z * rA.y);
  const vay = a.vel.y + (a.angVel.z * rA.x - a.angVel.x * rA.z);
  const vaz = a.vel.z + (a.angVel.x * rA.y - a.angVel.y * rA.x);
  const vbx = b.vel.x + (b.angVel.y * rB.z - b.angVel.z * rB.y);
  const vby = b.vel.y + (b.angVel.z * rB.x - b.angVel.x * rB.z);
  const vbz = b.vel.z + (b.angVel.x * rB.y - b.angVel.y * rB.x);
  const vn = (vbx - vax) * best.x + (vby - vay) * best.y + (vbz - vaz) * best.z;
  if (vn >= 0) return CarCarResult.Bumped;

  // demolition: supersonic car whose nose hits the other car. The faster car wins.
  const dm = CAR.demo;
  const sa = vec3.length(a.vel), sb = vec3.length(b.vel);
  const aHits = sa >= dm.minSpeed && a.supersonic && frontContact(a, cp);
  const bHits = sb >= dm.minSpeed && b.supersonic && frontContact(b, cp);
  if (aHits && (!bHits || sa >= sb)) {
    b.demolished = true; b.respawnTimer = dm.respawnTime;
    return CarCarResult.ADemoedB;
  }
  if (bHits) {
    a.demolished = true; a.respawnTimer = dm.respawnTime;
    return CarCarResult.BDemoedA;
  }

  const e = CAR.collision.carRestitution;
  const invA = effectiveInvMass(a, rA, best);
  const invB = effectiveInvMass(b, rB, best);
  const J = (-(1 + e) * vn) / (invA + invB);
  applyImpulse(a, rA, -best.x * J, -best.y * J, -best.z * J);
  applyImpulse(b, rB, best.x * J, best.y * J, best.z * J);
  return CarCarResult.Bumped;
}
