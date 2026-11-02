import { CAR, PHYSICS } from './constants';
import * as arena from './arena';
import { Mat3, mat3 } from './math/mat3';
import { Quat, quat } from './math/quat';
import { Vec3, vec3 } from './math/vec3';
import { clamp, curve } from './math/scalar';

/** One tick of player input. Axes in [-1, 1]. pitch>0 = nose down (W), yaw>0 / steer>0 / roll>0 = right. */
export class CarInput {
  throttle = 0;
  steer = 0;
  pitch = 0;
  yaw = 0;
  roll = 0;
  jump = false;
  boost = false;
  handbrake = false;
  copy(o: CarInput): this {
    this.throttle = o.throttle; this.steer = o.steer; this.pitch = o.pitch; this.yaw = o.yaw;
    this.roll = o.roll; this.jump = o.jump; this.boost = o.boost; this.handbrake = o.handbrake;
    return this;
  }
  clear(): this {
    this.throttle = 0; this.steer = 0; this.pitch = 0; this.yaw = 0; this.roll = 0;
    this.jump = false; this.boost = false; this.handbrake = false;
    return this;
  }
}

export class CarState {
  id = 0;
  /** 0 = Blue, 1 = Orange */
  team = 0;
  /** Position of the hitbox centre = centre of mass. */
  pos = new Vec3(0, 0, CAR.restHeight);
  vel = new Vec3();
  angVel = new Vec3();
  rot = new Quat();
  /** Columns: forward, left, up. Refreshed at the start of every step. */
  basis = new Mat3();

  boost: number = CAR.boost.start;
  boosting = false;
  boostHold = 0;
  prevBoost = false;
  supersonic = false;

  wheelContacts = 0;
  onGround = false;
  surfaceNormal = new Vec3(0, 0, 1);

  jumped = false;
  jumpTimer = 0;
  jumpHeld = false;
  flipUsed = false;
  airTime = 0;
  groundLockout = 0;
  prevJump = false;

  flipActive = false;
  flipTimer = 0;
  flipDirX = 0;
  flipDirY = 0;
  flipCancel = false;
  pitchLock = 0;

  demolished = false;
  respawnTimer = 0;

  /** Sim tick of the last ball touch, -1 if none. */
  lastTouchTick = -1;
  /** Wheel contact flags for rendering. */
  wheelHit = [false, false, false, false];
  /** Hitbox is touching (or within 2 uu of) the arena, e.g. resting on its roof. */
  roofRest = false;
  /** 0..1 powerslide amount (ramps up at 5/s, down at 2/s). */
  slide = 0;
  /** Seconds spent resting tipped over; at the auto-right delay the car rights itself. */
  tippedTime = 0;
  autoRight = false;
  hitboxContact = false;
  hitboxNormal = new Vec3(0, 0, 1);
}

export function copyCar(o: CarState, a: CarState): void {
  o.id = a.id; o.team = a.team;
  vec3.copy(o.pos, a.pos); vec3.copy(o.vel, a.vel); vec3.copy(o.angVel, a.angVel);
  quat.copy(o.rot, a.rot); mat3.copy(o.basis, a.basis);
  o.boost = a.boost; o.boosting = a.boosting; o.boostHold = a.boostHold; o.prevBoost = a.prevBoost;
  o.supersonic = a.supersonic; o.wheelContacts = a.wheelContacts; o.onGround = a.onGround;
  vec3.copy(o.surfaceNormal, a.surfaceNormal);
  o.jumped = a.jumped; o.jumpTimer = a.jumpTimer; o.jumpHeld = a.jumpHeld; o.flipUsed = a.flipUsed;
  o.airTime = a.airTime; o.groundLockout = a.groundLockout; o.prevJump = a.prevJump;
  o.flipActive = a.flipActive; o.flipTimer = a.flipTimer; o.flipDirX = a.flipDirX; o.flipDirY = a.flipDirY;
  o.flipCancel = a.flipCancel; o.pitchLock = a.pitchLock;
  o.demolished = a.demolished; o.respawnTimer = a.respawnTimer; o.lastTouchTick = a.lastTouchTick;
  for (let i = 0; i < 4; i++) o.wheelHit[i] = a.wheelHit[i];
  o.slide = a.slide; o.tippedTime = a.tippedTime; o.autoRight = a.autoRight; o.roofRest = a.roofRest;
  o.hitboxContact = a.hitboxContact; vec3.copy(o.hitboxNormal, a.hitboxNormal);
}

/** Places a car at rest on the floor facing `yaw` (radians from +X). */
export function placeCar(c: CarState, x: number, y: number, yaw: number): void {
  vec3.set(c.pos, x, y, CAR.restHeight);
  vec3.set(c.vel, 0, 0, 0);
  vec3.set(c.angVel, 0, 0, 0);
  quat.fromYaw(c.rot, yaw);
  mat3.fromQuat(c.basis, c.rot);
  c.boost = CAR.boost.start; c.boosting = false; c.boostHold = 0; c.prevBoost = false;
  c.supersonic = false; c.wheelContacts = 4; c.onGround = true;
  vec3.set(c.surfaceNormal, 0, 0, 1);
  c.jumped = false; c.jumpTimer = 0; c.jumpHeld = false; c.flipUsed = false; c.airTime = 0;
  c.groundLockout = 0; c.prevJump = false;
  c.flipActive = false; c.flipTimer = 0; c.flipCancel = false; c.pitchLock = 0;
  c.demolished = false; c.respawnTimer = 0;
  c.hitboxContact = false; vec3.set(c.hitboxNormal, 0, 0, 1);
  c.tippedTime = 0; c.autoRight = false;
}

/** Inertia of the hitbox as a uniform box: [roll(x), pitch(y), yaw(z)]. */
export function carInertia(out: Vec3): Vec3 {
  const s = CAR.hitboxSize, k = CAR.mass / 12;
  out.x = k * (s.y * s.y + s.z * s.z);
  out.y = k * (s.x * s.x + s.z * s.z);
  out.z = k * (s.x * s.x + s.y * s.y);
  return out;
}

// ---- scratch (module-level, no per-tick allocation) -------------------------------------------
const I = new Vec3();
const tmp = new Vec3();
const tmp2 = new Vec3();
const rr = new Vec3();
const nn = new Vec3();
const sN = new Vec3(); // surface the car is resting against while not on four wheels
const fwdV = new Vec3();
const leftV = new Vec3();
const upV = new Vec3();
const fF = new Vec3(); // forward projected on the surface
const lF = new Vec3(); // left on the surface
const wN = [new Vec3(), new Vec3(), new Vec3(), new Vec3()];
const wP = [new Vec3(), new Vec3(), new Vec3(), new Vec3()];
const wD = [0, 0, 0, 0];
const wHit = [false, false, false, false];

/** out = I^-1 * v  (world frame, using the car basis). */
function invInertiaMul(out: Vec3, c: CarState, v: Vec3): Vec3 {
  const m = c.basis.m;
  const lx = (m[0] * v.x + m[3] * v.y + m[6] * v.z) / I.x;
  const ly = (m[1] * v.x + m[4] * v.y + m[7] * v.z) / I.y;
  const lz = (m[2] * v.x + m[5] * v.y + m[8] * v.z) / I.z;
  out.x = m[0] * lx + m[1] * ly + m[2] * lz;
  out.y = m[3] * lx + m[4] * ly + m[5] * lz;
  out.z = m[6] * lx + m[7] * ly + m[8] * lz;
  return out;
}

/** Applies impulse J at world offset r from the centre of mass. */
export function applyImpulse(c: CarState, r: Vec3, jx: number, jy: number, jz: number): void {
  const inv = 1 / CAR.mass;
  c.vel.x += jx * inv; c.vel.y += jy * inv; c.vel.z += jz * inv;
  tmp.x = r.y * jz - r.z * jy;
  tmp.y = r.z * jx - r.x * jz;
  tmp.z = r.x * jy - r.y * jx;
  invInertiaMul(tmp2, c, tmp);
  c.angVel.x += tmp2.x; c.angVel.y += tmp2.y; c.angVel.z += tmp2.z;
}

/** Inverse effective mass along unit direction d at offset r. */
export function effectiveInvMass(c: CarState, r: Vec3, d: Vec3): number {
  tmp.x = r.y * d.z - r.z * d.y;
  tmp.y = r.z * d.x - r.x * d.z;
  tmp.z = r.x * d.y - r.y * d.x;
  invInertiaMul(tmp2, c, tmp);
  const cx = tmp2.y * r.z - tmp2.z * r.y;
  const cy = tmp2.z * r.x - tmp2.x * r.z;
  const cz = tmp2.x * r.y - tmp2.y * r.x;
  return 1 / CAR.mass + d.x * cx + d.y * cy + d.z * cz;
}

/** Collision response of the car against an immovable surface point. */
function surfaceImpulse(c: CarState, n: Vec3, r: Vec3, e: number, mu: number): void {
  const v = c.vel, w = c.angVel;
  let px = v.x + (w.y * r.z - w.z * r.y);
  let py = v.y + (w.z * r.x - w.x * r.z);
  let pz = v.z + (w.x * r.y - w.y * r.x);
  const vn = px * n.x + py * n.y + pz * n.z;
  if (vn >= 0) return;
  const k = effectiveInvMass(c, r, n);
  const eff = -vn < CAR.collision.restitutionSpeedThreshold ? 0 : e;
  const J = (-(1 + eff) * vn) / k;
  applyImpulse(c, r, n.x * J, n.y * J, n.z * J);

  px = v.x + (w.y * r.z - w.z * r.y);
  py = v.y + (w.z * r.x - w.x * r.z);
  pz = v.z + (w.x * r.y - w.y * r.x);
  const pn = px * n.x + py * n.y + pz * n.z;
  const tx = px - n.x * pn, ty = py - n.y * pn, tz = pz - n.z * pn;
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (tl < 1e-6) return;
  rr.x = tx / tl; rr.y = ty / tl; rr.z = tz / tl;
  const kt = effectiveInvMass(c, r, rr);
  const Jt = Math.min(tl / kt, mu * J);
  applyImpulse(c, r, -rr.x * Jt, -rr.y * Jt, -rr.z * Jt);
}

/** Hitbox (8 corners + 6 face centres) vs arena. */
export function collideCarArena(c: CarState): void {
  const hs = CAR.hitboxSize;
  const hx = hs.x / 2, hy = hs.y / 2, hz = hs.z / 2;
  const tol = CAR.collision.arenaTolerance;
  const m = c.basis.m;
  c.hitboxContact = false;
  let nx = 0, ny = 0, nz = 0;
  for (let iter = 0; iter < 2; iter++) {
    let maxPen = 0;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < 14; i++) {
      let lx: number, ly: number, lz: number;
      if (i < 8) {
        lx = i & 1 ? hx : -hx; ly = i & 2 ? hy : -hy; lz = i & 4 ? hz : -hz;
      } else {
        lx = 0; ly = 0; lz = 0;
        const a = i - 8;
        const s = a & 1 ? 1 : -1;
        if (a < 2) lx = s * hx; else if (a < 4) ly = s * hy; else lz = s * hz;
      }
      const rx = m[0] * lx + m[1] * ly + m[2] * lz;
      const ry = m[3] * lx + m[4] * ly + m[5] * lz;
      const rz = m[6] * lx + m[7] * ly + m[8] * lz;
      const px = c.pos.x + rx, py = c.pos.y + ry, pz = c.pos.z + rz;
      const pen = -arena.sdf(px, py, pz) - tol;
      if (pen <= -2) continue;
      arena.normal(nn, px, py, pz);
      if (iter === 0) { c.hitboxContact = true; nx += nn.x; ny += nn.y; nz += nn.z; }
      if (pen <= 0) continue;
      surfaceImpulseAt(c, nn, rx, ry, rz);
      if (pen > maxPen) { maxPen = pen; cx = nn.x; cy = nn.y; cz = nn.z; }
    }
    if (maxPen <= 0) break;
    c.pos.x += cx * maxPen; c.pos.y += cy * maxPen; c.pos.z += cz * maxPen;
  }
  if (c.hitboxContact) { vec3.set(c.hitboxNormal, nx, ny, nz); vec3.normalize(c.hitboxNormal, c.hitboxNormal); }
}

const rArm = new Vec3();
const nArm = new Vec3();
function surfaceImpulseAt(c: CarState, n: Vec3, rx: number, ry: number, rz: number): void {
  vec3.set(rArm, rx, ry, rz);
  vec3.copy(nArm, n);
  surfaceImpulse(c, nArm, rArm, CAR.collision.restitution, CAR.collision.friction);
}

function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Advances one car by dt. Arena collision included; car-car / car-ball are handled by the caller. */
export function stepCar(c: CarState, inp: CarInput, dt: number = PHYSICS.dt): void {
  if (c.demolished) return;
  carInertia(I);
  mat3.fromQuat(c.basis, c.rot);
  const m = c.basis.m;
  vec3.set(fwdV, m[0], m[3], m[6]);
  vec3.set(leftV, m[1], m[4], m[7]);
  vec3.set(upV, m[2], m[5], m[8]);

  const g = PHYSICS.gravity;
  const jumpPressed = inp.jump && !c.prevJump;
  const boostPressed = inp.boost && !c.prevBoost;
  c.prevJump = inp.jump;
  c.prevBoost = inp.boost;

  // ---- wheel raycasts -------------------------------------------------------------------------
  let contacts = 0;
  const reach = CAR.restHeight + CAR.wheels.maxTravel;
  const lockout = c.groundLockout > 0;
  if (lockout) c.groundLockout -= dt;
  const wh = CAR.wheels;
  const ho = CAR.hitboxOffset;
  nn.x = 0; nn.y = 0; nn.z = 0;
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const w = front ? wh.front : wh.rear;
    const lx = w.connection.x - ho.x;
    const ly = (i & 1 ? -1 : 1) * w.connection.y;
    wHit[i] = false;
    c.wheelHit[i] = false;
    if (lockout) continue;
    const ox = c.pos.x + fwdV.x * lx + leftV.x * ly;
    const oy = c.pos.y + fwdV.y * lx + leftV.y * ly;
    const oz = c.pos.z + fwdV.z * lx + leftV.z * ly;
    const d = arena.raycast(ox, oy, oz, -upV.x, -upV.y, -upV.z, reach, wN[i]);
    if (d < 0) continue;
    wHit[i] = true;
    c.wheelHit[i] = true;
    wD[i] = d;
    wP[i].x = ox - upV.x * d; wP[i].y = oy - upV.y * d; wP[i].z = oz - upV.z * d;
    nn.x += wN[i].x; nn.y += wN[i].y; nn.z += wN[i].z;
    contacts++;
  }
  c.wheelContacts = contacts;
  c.onGround = contacts >= CAR.drive.minWheelsForSticky;
  if (c.onGround) {
    vec3.normalize(c.surfaceNormal, nn);
    c.jumped = false; c.flipUsed = false; c.airTime = 0; c.flipActive = false;
    c.flipCancel = false; c.pitchLock = 0; c.jumpHeld = false;
  } else {
    c.airTime += dt;
    // resting on the roof (or any non-wheel surface): jumps and flip come back so the car can recover
    if (c.hitboxContact && contacts < 3 && vec3.dot(upV, c.hitboxNormal) < -0.4 && c.vel.x * c.vel.x + c.vel.y * c.vel.y + c.vel.z * c.vel.z < 400 * 400) {
      c.jumped = false; c.flipUsed = false; c.airTime = 0; c.flipActive = false; c.pitchLock = 0; c.jumpHeld = false;
      c.roofRest = true;
    } else c.roofRest = false;
  }

  // ---- auto-right: a car left resting tipped over hops and rolls back onto its wheels -------------
  {
    const tipped = m[8] < 0.3 && c.hitboxContact && contacts < 3 && vec3.dot(upV, c.hitboxNormal) < 0.35;
    if (tipped && !c.autoRight) {
      c.tippedTime += dt;
      if (c.tippedTime >= CAR.recovery.autoRightDelay) {
        c.autoRight = true;
        const hop = CAR.recovery.autoRightHop;
        c.vel.x += c.hitboxNormal.x * hop; c.vel.y += c.hitboxNormal.y * hop; c.vel.z += c.hitboxNormal.z * hop;
        c.jumped = false; c.flipUsed = false; c.flipActive = false; c.pitchLock = 0;
      }
    } else if (!tipped && !c.autoRight) c.tippedTime = 0;
    if (c.autoRight && (c.onGround || m[8] > 0.96)) { c.autoRight = false; c.tippedTime = 0; c.angVel.x *= 0.3; c.angVel.y *= 0.3; c.angVel.z *= 0.3; }
  }

  // ---- settle: slow, touching a surface on fewer than three wheels (nose-down, leaning on two wheels) -------
  // The car counts as airborne there, so W would pitch it further forward. Instead it rights itself onto its wheels.
  let settle = false;
  if (CAR.recovery.settle > 0 && !c.onGround && !c.autoRight && !c.flipActive && c.pitchLock <= 0 && !c.jumpHeld &&
      c.groundLockout <= 0 && (contacts > 0 || c.hitboxContact) &&
      c.vel.x * c.vel.x + c.vel.y * c.vel.y + c.vel.z * c.vel.z < CAR.recovery.settleMaxSpeed * CAR.recovery.settleMaxSpeed) {
    if (c.hitboxContact) vec3.copy(sN, c.hitboxNormal); else vec3.normalize(sN, nn);
    const facing = upV.x * sN.x + upV.y * sN.y + upV.z * sN.z;
    settle = facing > 0.1 && facing < 0.995;
  }

  // ---- gravity --------------------------------------------------------------------------------
  c.vel.z += g * dt;

  // ---- suspension -----------------------------------------------------------------------------
  if (contacts > 0) {
    for (let i = 0; i < 4; i++) {
      if (!wHit[i]) continue;
      const w = i < 2 ? wh.front : wh.rear;
      const restEff = CAR.restHeight - w.radius;
      const len = wD[i] - w.radius;
      const compression = clamp(restEff - len, 0, wh.maxTravel);
      if (compression <= 0 && len > restEff + wh.maxTravel) continue;
      const n = wN[i];
      rr.x = wP[i].x - c.pos.x; rr.y = wP[i].y - c.pos.y; rr.z = wP[i].z - c.pos.z;
      const vpn =
        (c.vel.x + (c.angVel.y * rr.z - c.angVel.z * rr.y)) * n.x +
        (c.vel.y + (c.angVel.z * rr.x - c.angVel.x * rr.z)) * n.y +
        (c.vel.z + (c.angVel.x * rr.y - c.angVel.y * rr.x)) * n.z;
      const damp = vpn < 0 ? wh.dampingCompression : wh.dampingRelaxation;
      const a = wh.suspensionStiffness * compression - damp * vpn;
      if (a <= 0) continue;
      const J = CAR.mass * a * dt;
      const jx = n.x * J, jy = n.y * J, jz = n.z * J;
      vec3.set(rArm, rr.x, rr.y, rr.z);
      applyImpulse(c, rArm, jx, jy, jz);
    }
  }

  // ---- boost state ----------------------------------------------------------------------------
  if (boostPressed && c.boost > 0) c.boostHold = CAR.boost.minHoldTime;
  c.boosting = c.boost > 0 && (inp.boost || c.boostHold > 0);
  if (c.boostHold > 0) c.boostHold -= dt;

  // ---- jumping --------------------------------------------------------------------------------
  let justJumped = false;
  if (jumpPressed && c.onGround) {
    justJumped = true;
    const J = CAR.jump.impulse;
    c.vel.x += upV.x * J; c.vel.y += upV.y * J; c.vel.z += upV.z * J;
    c.jumped = true; c.jumpTimer = 0; c.jumpHeld = true;
    c.groundLockout = CAR.drive.jumpGroundLockout;
    c.onGround = false; c.wheelContacts = 0; c.airTime = 0;
    contacts = 0;
  } else if (jumpPressed && c.roofRest) {
    // jump off the roof: push away from the surface, then a flip is available to roll over
    justJumped = true;
    const J = CAR.jump.impulse * CAR.recovery.roofJumpScale;
    c.vel.x += c.hitboxNormal.x * J; c.vel.y += c.hitboxNormal.y * J; c.vel.z += c.hitboxNormal.z * J;
    c.jumped = true; c.jumpTimer = 0; c.jumpHeld = false; c.airTime = 0; c.roofRest = false;
    c.groundLockout = 0.0;
  } else if (c.jumpHeld) {
    if (c.jumpTimer < CAR.jump.holdMaxTime && (inp.jump || c.jumpTimer < CAR.jump.holdMinTime)) {
      const a = CAR.jump.holdAccel * dt;
      c.vel.x += upV.x * a; c.vel.y += upV.y * a; c.vel.z += upV.z * a;
      c.jumpTimer += dt;
    } else {
      c.jumpHeld = false;
    }
  }

  if (jumpPressed && !justJumped && !c.onGround && !c.flipUsed && c.airTime <= CAR.jump.secondJumpWindow) {
    startSecondJump(c, inp);
  }

  // ---- flip dynamics --------------------------------------------------------------------------
  if (c.flipActive) {
    c.flipTimer += dt;
    const fl = CAR.flip;
    // hang: damp vertical velocity in a short window
    if (c.flipTimer >= fl.zDampStart && c.flipTimer <= fl.zDampEnd) {
      c.vel.z *= Math.max(0, 1 - fl.zDampFactor * dt * PHYSICS.tickRate);
    }
    // cancel: opposite pitch input stops the rotation
    if (!c.flipCancel && c.flipDirX !== 0 && inp.pitch * c.flipDirX < -fl.cancelThreshold) c.flipCancel = true;
    if (c.flipTimer >= fl.duration) c.flipActive = false;
  }
  if (c.pitchLock > 0) c.pitchLock -= dt;

  // ---- ground driving -------------------------------------------------------------------------
  const D = CAR.drive;
  if (c.onGround) {
    const n = c.surfaceNormal;
    const fd = fwdV.x * n.x + fwdV.y * n.y + fwdV.z * n.z;
    fF.x = fwdV.x - n.x * fd; fF.y = fwdV.y - n.y * fd; fF.z = fwdV.z - n.z * fd;
    vec3.normalize(fF, fF);
    lF.x = n.y * fF.z - n.z * fF.y;
    lF.y = n.z * fF.x - n.x * fF.z;
    lF.z = n.x * fF.y - n.y * fF.x;
    const vf = c.vel.x * fF.x + c.vel.y * fF.y + c.vel.z * fF.z;
    const thr = inp.throttle;
    const speedAbs = vf < 0 ? -vf : vf;

    if (thr !== 0) {
      if (vf * thr >= 0 || speedAbs < 1) {
        const a = curve(D.throttleAccelCurve, speedAbs) * thr * dt;
        c.vel.x += fF.x * a; c.vel.y += fF.y * a; c.vel.z += fF.z * a;
      } else {
        const dv = Math.min(speedAbs, D.brakeDecel * Math.abs(thr) * dt) * -sign(vf);
        c.vel.x += fF.x * dv; c.vel.y += fF.y * dv; c.vel.z += fF.z * dv;
      }
    } else if (!c.boosting) {
      const dv = Math.min(speedAbs, D.coastDecel * (1 - 0.5 * c.slide) * dt) * -sign(vf);
      c.vel.x += fF.x * dv; c.vel.y += fF.y * dv; c.vel.z += fF.z * dv;
    }

    // lateral grip
    const lv = c.vel.x * lF.x + c.vel.y * lF.y + c.vel.z * lF.z;
    c.slide = inp.handbrake ? Math.min(1, c.slide + D.powerslideRise * dt) : Math.max(0, c.slide - D.powerslideFall * dt);
    const gripRate = D.lateralGripRate + (D.handbrakeGripRate - D.lateralGripRate) * c.slide;
    const grip = 1 - Math.exp(-gripRate * dt);
    const capDv = D.lateralMaxDecel * (1 - c.slide * (1 - D.powerslideGripFactor)) * dt;
    let dLat = lv * grip;
    if (dLat > capDv) dLat = capDv; else if (dLat < -capDv) dLat = -capDv;
    c.vel.x -= lF.x * dLat; c.vel.y -= lF.y * dLat; c.vel.z -= lF.z * dLat;

    // steering: yaw rate about the surface normal = v * tan(angle) / wheelbase
    const vSteer = c.slide > 0.05 ? Math.sqrt(vf * vf + lv * lv) * (vf < -1 ? -1 : 1) : vf;
    const normalAngle = curve(D.steerCurve, Math.abs(vSteer));
    const angle = normalAngle + (curve(D.powerslideSteerCurve, Math.abs(vSteer)) - normalAngle) * c.slide;
    const wTarget = (-inp.steer * vSteer * Math.tan(angle)) / D.wheelbase;
    const wn = c.angVel.x * n.x + c.angVel.y * n.y + c.angVel.z * n.z;
    // cornering costs speed (full-lock turning settles around 1234 uu/s)
    if (D.turnDrag > 0 && c.slide < 0.5) {
      const loss = Math.min(speedAbs, D.turnDrag * Math.abs(wTarget * vf) * dt) * -sign(vf);
      c.vel.x += fF.x * loss; c.vel.y += fF.y * loss; c.vel.z += fF.z * loss;
    }
    const k = Math.min(1, D.steerResponse * dt) * (wTarget - wn);
    c.angVel.x += n.x * k; c.angVel.y += n.y * k; c.angVel.z += n.z * k;

    // roll levelling: a car resting on a surface settles square to it instead of leaning on three wheels
    if (D.rollLevel > 0) {
      const tilt = leftV.x * n.x + leftV.y * n.y + leftV.z * n.z; // sin(roll relative to the surface)
      const lvl = -tilt * D.rollLevel * dt;
      c.angVel.x += fF.x * lvl; c.angVel.y += fF.y * lvl; c.angVel.z += fF.z * lvl;
      const roll = c.angVel.x * fF.x + c.angVel.y * fF.y + c.angVel.z * fF.z;
      const damp = roll * Math.min(1, D.rollDamping * dt);
      c.angVel.x -= fF.x * damp; c.angVel.y -= fF.y * damp; c.angVel.z -= fF.z * damp;
    }

    // planting: pull the car square onto the surface and kill any tilt spin, so landings settle at once
    if (D.plantLevel > 0) {
      const ex = upV.y * n.z - upV.z * n.y, ey = upV.z * n.x - upV.x * n.z, ez = upV.x * n.y - upV.y * n.x;
      c.angVel.x += ex * D.plantLevel * dt; c.angVel.y += ey * D.plantLevel * dt; c.angVel.z += ez * D.plantLevel * dt;
      const wn2 = c.angVel.x * n.x + c.angVel.y * n.y + c.angVel.z * n.z; // spin about the normal (steering) is kept
      const k2 = Math.min(1, D.plantDamping * dt);
      c.angVel.x -= (c.angVel.x - n.x * wn2) * k2; c.angVel.y -= (c.angVel.y - n.y * wn2) * k2; c.angVel.z -= (c.angVel.z - n.z * wn2) * k2;
    }

    // sticky force holds the car to whatever it is driving on
    const t = clamp(1 - n.z, 0, 1);
    const scale = D.stickyBase + (D.stickyMax - D.stickyBase) * t;
    const s = -g * scale * dt; // g is negative -> s positive magnitude along -n
    c.vel.x -= n.x * s; c.vel.y -= n.y * s; c.vel.z -= n.z * s;
  }

  // ---- boost thrust ---------------------------------------------------------------------------
  if (c.boosting) {
    const a = CAR.boost.accel * dt;
    if (c.onGround) {
      c.vel.x += fF.x * a; c.vel.y += fF.y * a; c.vel.z += fF.z * a;
    } else {
      const aa = CAR.boost.airAccel * dt;
      c.vel.x += fwdV.x * aa; c.vel.y += fwdV.y * aa; c.vel.z += fwdV.z * aa;
    }
    c.boost = Math.max(0, c.boost - CAR.boost.useRate * dt);
  }

  // ---- air control ----------------------------------------------------------------------------
  if (!c.onGround) {
    const A = CAR.air;
    if (contacts === 0) {
      const ta = A.throttleAccel * inp.throttle * dt;
      c.vel.x += fwdV.x * ta; c.vel.y += fwdV.y * ta; c.vel.z += fwdV.z * ta;
    }
    // world -> local angular velocity
    const wx = c.angVel.x, wy = c.angVel.y, wz = c.angVel.z;
    let lx = m[0] * wx + m[3] * wy + m[6] * wz; // roll axis (forward)
    let ly = m[1] * wx + m[4] * wy + m[7] * wz; // pitch axis (left)
    let lz = m[2] * wx + m[5] * wy + m[8] * wz; // yaw axis (up)

    const flipping = c.flipActive;
    const pIn = c.pitchLock > 0 || flipping || settle ? 0 : inp.pitch;
    const rIn = flipping || settle ? 0 : inp.roll;
    const yIn = inp.yaw !== 0 ? inp.yaw : inp.steer;

    // after a flip the rotation is allowed to coast so the car completes one full turn
    const coast = c.flipActive || c.pitchLock > 0;
    lx += (A.torque.roll * rIn - lx * (coast ? CAR.flip.rotationDamping : A.damping.roll)) * dt;
    ly += (A.torque.pitch * pIn - ly * (coast ? CAR.flip.rotationDamping : A.damping.pitch * (1 - Math.abs(pIn)))) * dt;
    lz += (-A.torque.yaw * yIn - lz * A.damping.yaw * (1 - Math.abs(yIn))) * dt;

    if (flipping) {
      const fl = CAR.flip;
      if (c.flipCancel) {
        const k = Math.exp(-30 * dt);
        lx *= k; ly *= k;
      } else if (c.flipTimer < fl.minTorqueTime) {
        lx += fl.torqueRoll * c.flipDirY * dt;
        ly += fl.torquePitch * c.flipDirX * dt;
      }
    }
    c.angVel.x = m[0] * lx + m[1] * ly + m[2] * lz;
    c.angVel.y = m[3] * lx + m[4] * ly + m[5] * lz;
    c.angVel.z = m[6] * lx + m[7] * ly + m[8] * lz;
  }

  // ---- auto-right roll: rotate the roof toward world-up (about the forward axis when exactly inverted) ----
  if (c.autoRight) {
    const ex = upV.y * 1 - upV.z * 0, ey = upV.z * 0 - upV.x * 1, ez = 0; // up x worldUp = (uy, -ux, 0)
    const sin = Math.sqrt(ex * ex + ey * ey);
    const rate = CAR.recovery.autoRightRate;
    if (sin > 0.25) {
      const k = Math.min(rate, 2.5 + 3 * Math.asin(Math.min(1, sin))) / sin;
      c.angVel.x = ex * k; c.angVel.y = ey * k; c.angVel.z = ez * k;
    } else {
      const sgn = leftV.z >= 0 ? -1 : 1; // roll about +forward moves the roof toward -left
      c.angVel.x = fwdV.x * sgn * rate; c.angVel.y = fwdV.y * sgn * rate; c.angVel.z = fwdV.z * sgn * rate;
    }
  }

  // ---- air self-levelling: with no steering input the car settles wheels-down toward where it will land ----
  if (CAR.recovery.airLevel > 0 && !c.onGround && !c.autoRight && contacts === 0 && !c.flipActive && c.pitchLock <= 0 &&
      Math.abs(inp.pitch) + Math.abs(inp.yaw) + Math.abs(inp.roll) + Math.abs(inp.steer) < 0.05) {
    const px = c.pos.x + c.vel.x * 0.3, py = c.pos.y + c.vel.y * 0.3, pz = c.pos.z + c.vel.z * 0.3;
    if (arena.sdf(px, py, pz) < 450) arena.normal(nn, px, py, pz); else vec3.set(nn, 0, 0, 1);
    let ex = upV.y * nn.z - upV.z * nn.y, ey = upV.z * nn.x - upV.x * nn.z, ez = upV.x * nn.y - upV.y * nn.x;
    const sin = Math.sqrt(ex * ex + ey * ey + ez * ez);
    const cos = Math.max(-1, Math.min(1, upV.x * nn.x + upV.y * nn.y + upV.z * nn.z));
    const theta = Math.acos(cos);
    if (theta > 0.03) {
      if (sin > 0.15 || cos > 0) { ex /= sin || 1; ey /= sin || 1; ez /= sin || 1; }
      else { const sgn = leftV.z >= 0 ? -1 : 1; ex = fwdV.x * sgn; ey = fwdV.y * sgn; ez = fwdV.z * sgn; } // inverted: roll about forward
      // aim for an angular velocity proportional to the remaining tilt and blend toward it quickly
      const rate = Math.min(CAR.recovery.airLevelRate, 1.2 + 2.0 * theta);
      const k = Math.min(1, CAR.recovery.airLevel * dt);
      c.angVel.x += (ex * rate - c.angVel.x) * k; c.angVel.y += (ey * rate - c.angVel.y) * k; c.angVel.z += (ez * rate - c.angVel.z) * k;
    }
  }

  // ---- settle: swing the roof toward the surface normal, pivoting on whatever is touching ------------
  if (settle) {
    const ex = upV.y * sN.z - upV.z * sN.y, ey = upV.z * sN.x - upV.x * sN.z, ez = upV.x * sN.y - upV.y * sN.x;
    const sin = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
    const theta = Math.acos(Math.max(-1, Math.min(1, upV.x * sN.x + upV.y * sN.y + upV.z * sN.z)));
    const rate = Math.min(CAR.recovery.settleRate, 1.2 + 3.0 * theta);
    const k = Math.min(1, CAR.recovery.settle * dt);
    c.angVel.x += (ex / sin * rate - c.angVel.x) * k;
    c.angVel.y += (ey / sin * rate - c.angVel.y) * k;
    c.angVel.z += (ez / sin * rate - c.angVel.z) * k;
  }

  // ---- limits + integration -------------------------------------------------------------------
  vec3.clampLength(c.vel, c.vel, CAR.maxSpeed);
  vec3.clampLength(c.angVel, c.angVel, c.onGround || contacts > 0 ? CAR.maxAngularSpeedGround : c.flipActive || c.pitchLock > 0 ? CAR.flip.maxAngularSpeed : CAR.maxAngularSpeed);
  c.pos.x += c.vel.x * dt; c.pos.y += c.vel.y * dt; c.pos.z += c.vel.z * dt;
  quat.integrate(c.rot, c.rot, c.angVel.x, c.angVel.y, c.angVel.z, dt);
  mat3.fromQuat(c.basis, c.rot);

  collideCarArena(c);
  vec3.clampLength(c.vel, c.vel, CAR.maxSpeed);

  const sp = vec3.length(c.vel);
  if (c.supersonic) {
    if (sp < CAR.supersonicOff) c.supersonic = false;
  } else if (sp >= CAR.supersonicOn) c.supersonic = true;
}

function startSecondJump(c: CarState, inp: CarInput): void {
  const fl = CAR.flip;
  const m = c.basis.m;
  const dx = inp.pitch;
  const dy = inp.yaw !== 0 ? inp.yaw : inp.roll !== 0 ? inp.roll : inp.steer;
  const mag = Math.sqrt(dx * dx + dy * dy);
  c.flipUsed = true;
  c.jumpHeld = false;
  if (mag < fl.deadzone) {
    const J = CAR.jump.impulse;
    c.vel.x += m[2] * J; c.vel.y += m[5] * J; c.vel.z += m[8] * J;
    return;
  }
  const ux = dx / mag, uy = dy / mag;
  // horizontal frame from the car's forward axis
  let fx = m[0], fy = m[3];
  let fl2 = Math.sqrt(fx * fx + fy * fy);
  if (fl2 < 0.05) { fx = m[2]; fy = m[5]; fl2 = Math.sqrt(fx * fx + fy * fy); }
  if (fl2 < 1e-6) { fx = 1; fy = 0; fl2 = 1; }
  fx /= fl2; fy /= fl2;
  const rx = fy, ry = -fx; // right
  const vf = c.vel.x * fx + c.vel.y * fy;
  const ratio = Math.min(1, Math.abs(vf) / CAR.maxSpeed);
  // forward flips are constant; side and backward flips grow with speed (measured game behaviour)
  let along = ux;
  if (ux > 0) along *= 1 + (fl.forwardMaxSpeedScale - 1) * ratio;
  else along *= (1 + (fl.backwardMaxSpeedScale - 1) * ratio) * fl.backwardScaleX;
  const side = uy * (1 + (fl.sideMaxSpeedScale - 1) * ratio);
  c.vel.x += (fx * along + rx * side) * fl.impulse;
  c.vel.y += (fy * along + ry * side) * fl.impulse;
  c.flipActive = true;
  c.flipTimer = 0;
  c.flipDirX = ux;
  c.flipDirY = uy;
  c.flipCancel = false;
  c.pitchLock = fl.pitchLockTime + fl.pitchLockExtra;
}
