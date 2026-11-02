import * as arena from '../arena';
import { CAR, ARENA, BALL, PHYSICS } from '../constants';
import { CarInput, CarState } from '../car';
import { clamp } from '../math/scalar';
import { Vec3 } from '../math/vec3';
import { Prng } from '../prng';
import { GameSim, Phase } from '../sim';
import { BossBot } from './boss';
import { orientCar } from './control';
import { BallPath, predictBall } from './predict';

export type BotLevel = 'easy' | 'medium' | 'hard' | 'ultrahard';

export interface BotConfig {
  /** Input lag in seconds. */
  reaction: number;
  /** Ball prediction horizon in seconds. */
  horizon: number;
  /** Fraction of top speed the bot will drive at (target speed / 2300). */
  speedFactor: number;
  /** 0 = none, 1 = limited (rare, sloppy), 2 = full. */
  aerials: 0 | 1 | 2;
  /** Probability that a good dodge opportunity is actually taken. */
  dodgeChance: number;
  /** Standard deviation of steering noise. */
  steerNoise: number;
  /** Chance of mis-timing the ball approach (adds a late/early flip or a wrong lane). */
  mistime: number;
  /** Seconds the bot idles/dithers after touching the ball. */
  recover: number;
  boostPads: boolean;
  /** Boost policy: 0 = tiny bursts, 1 = normal, 2 = disciplined (saves boost, steals big pads). */
  boostSkill: 0 | 1 | 2;
  demos: boolean;
  shotPlacement: boolean;
  /** Retreats to defend when the ball is on the own half and the opponent is closer. */
  smartDefense: boolean;
  kickoffFlip: boolean;
}

export const BOT_CONFIGS: Record<BotLevel, BotConfig> = {
  easy: {
    reaction: 0.4, horizon: 1.0, speedFactor: 0.46, aerials: 0, dodgeChance: 0.12, steerNoise: 0.35, mistime: 0.4,
    recover: 1.3, boostPads: false, boostSkill: 0, demos: false, shotPlacement: false, smartDefense: false, kickoffFlip: false,
  },
  medium: {
    reaction: 0.15, horizon: 2.5, speedFactor: 0.92, aerials: 1, dodgeChance: 0.8, steerNoise: 0.05, mistime: 0.1,
    recover: 0.3, boostPads: true, boostSkill: 1, demos: false, shotPlacement: false, smartDefense: false, kickoffFlip: true,
  },
  hard: {
    reaction: 0.06, horizon: 4.0, speedFactor: 1.0, aerials: 2, dodgeChance: 0.95, steerNoise: 0.0, mistime: 0.0,
    recover: 0, boostPads: true, boostSkill: 2, demos: true, shotPlacement: true, smartDefense: true, kickoffFlip: true,
  },
  // The Ultrahard Boss is a different controller (see boss.ts, built with `createBot`); these values only
  // describe it for code that reads the table and are never used to drive a `Bot`.
  ultrahard: {
    reaction: 0, horizon: 5.0, speedFactor: 1.0, aerials: 2, dodgeChance: 1, steerNoise: 0, mistime: 0,
    recover: 0, boostPads: true, boostSkill: 2, demos: true, shotPlacement: true, smartDefense: true, kickoffFlip: true,
  },
};

const enum Mode { Kickoff, Attack, Defend, Recover, Boost, Demo }

const GOAL_Y = ARENA.halfLength;
const TOP_THROTTLE = 1410;

/** A fair bot: same physics, same input struct as a human. */
export class Bot {
  readonly cfg: BotConfig;
  private path = new BallPath();
  private rng: Prng;
  private queue: CarInput[] = [];
  private delayTicks: number;
  private want = new CarInput();
  private tickCount = 0;
  private mode: Mode = Mode.Kickoff;
  // plan
  private tx = 0; private ty = 0; private tz = 0;
  private interceptT = 0;
  private ix = 0; private iy = 0; private iz = 0;
  private targetSpeed = 1400;
  private boostOk = false;
  private aerial = false;
  private demoTarget = -1;
  // low-level state
  private dodgeState = 0;
  private dodgeTimer = 0;
  private dodgeDX = 1; private dodgeDY = 0;
  private jumpHold = 0;
  private noise = 0;
  private stuckTime = 0;
  private reverseTime = 0;
  private lastTouchSeen = -1;
  private idleUntil = 0;
  private committed = false;
  private jumpClock = 0;
  private kickoffDone = false;
  /** Dev-mode debug: latest plan. */
  debug = { mode: 0, tx: 0, ty: 0, tz: 0 };

  constructor(readonly level: BotLevel, private sim: GameSim, readonly index: number, seed = 1) {
    this.cfg = BOT_CONFIGS[level];
    this.rng = new Prng(seed * 7919 + index * 104729 + 13);
    this.delayTicks = Math.max(0, Math.round(this.cfg.reaction / PHYSICS.dt));
    for (let i = 0; i <= this.delayTicks; i++) this.queue.push(new CarInput());
  }

  get predictedPath(): BallPath { return this.path; }
  get target(): Vec3 { return new Vec3(this.tx, this.ty, this.tz); }

  /** Call once per sim tick, before `sim.step()`. */
  think(): void {
    const sim = this.sim;
    const car = sim.cars[this.index];
    const out = this.want;
    out.clear();
    this.tickCount++;
    if (sim.phase !== Phase.Playing) {
      this.kickoffDone = false;
      this.dodgeState = 0;
      this.mode = Mode.Kickoff;
    } else if (!car.demolished) {
      if (car.onGround) { this.jumpClock = 0; this.committed = false; } else this.jumpClock += PHYSICS.dt;
      if (this.tickCount % 8 === 0 || this.mode === Mode.Kickoff) this.plan(car);
      this.execute(car, out);
    }
    // reaction delay
    const q = this.queue;
    const slot = q.shift() as CarInput;
    slot.copy(out);
    q.push(slot);
    sim.inputs[this.index].copy(q[0]);
  }

  // ---------------------------------------------------------------- planning
  private plan(car: CarState): void {
    const sim = this.sim, cfg = this.cfg;
    const att = car.team === 0 ? 1 : -1;
    const ball = sim.ball;
    const opp = this.nearestOpponent(car);
    predictBall(this.path, ball, cfg.horizon, 3);
    const p = this.path;

    // kickoff: ball at rest at the centre
    const atCentre = Math.abs(ball.pos.x) < 5 && Math.abs(ball.pos.y) < 5 && Math.abs(ball.vel.y) < 5;
    if (atCentre && !this.kickoffDone) {
      this.mode = Mode.Kickoff;
      this.tx = 0; this.ty = -att * 20; this.tz = 0;
      this.targetSpeed = 2300; this.boostOk = true;
      this.setDebug();
      return;
    }
    this.kickoffDone = true;

    // intercept: first sample the car can reach before the ball gets there
    const avgSpeed = Math.max(900, cfg.speedFactor * 2300 * 0.75);
    let k = -1;
    for (let i = 1; i < p.n; i++) {
      const dx = p.x[i] - car.pos.x, dy = p.y[i] - car.pos.y;
      const flat = Math.hypot(dx, dy);
      const high = p.z[i] > 240;
      if (high && cfg.aerials === 0) continue;
      if (high && p.z[i] > (cfg.aerials === 2 ? 1500 : 650)) continue;
      const fwd = car.basis.m;
      const turn = Math.abs(Math.atan2(-(dx * fwd[1] + dy * fwd[4]), dx * fwd[0] + dy * fwd[3])) / 3.2;
      const need = flat / avgSpeed + turn + (high ? 0.5 + p.z[i] / 1800 : 0);
      if (need <= p.t[i]) { k = i; break; }
    }
    if (k < 0) k = Math.min(p.n - 1, Math.max(1, Math.floor(0.9 / p.stepDt)));
    this.ix = p.x[k]; this.iy = p.y[k]; this.iz = p.z[k]; this.interceptT = p.t[k];

    if (!car.onGround && this.committed) {
      this.aerial = true; this.mode = Mode.Attack;
      this.tx = this.ix; this.ty = this.iy; this.tz = this.iz;
      this.setDebug();
      return;
    }
    const ownGoalY = -att * GOAL_Y;
    const ballOwnSide = ball.pos.y * att < -300;
    const threat = p.goalSide === -att && p.goalTime >= 0;
    const myDistBall = Math.hypot(ball.pos.x - car.pos.x, ball.pos.y - car.pos.y);
    const oppDistBall = opp ? Math.hypot(ball.pos.x - opp.pos.x, ball.pos.y - opp.pos.y) : 99999;

    // post-touch dithering for weaker bots
    if (car.lastTouchTick >= 0 && car.lastTouchTick !== this.lastTouchSeen) {
      this.lastTouchSeen = car.lastTouchTick;
      this.idleUntil = sim.tick + Math.round(cfg.recover / PHYSICS.dt);
    }

    this.aerial = false;
    this.boostOk = cfg.boostSkill === 1 || (cfg.boostSkill === 2 && car.boost > 8);
    this.targetSpeed = Math.min(2300, cfg.speedFactor * 2300);

    // ---- mode choice
    if (cfg.smartDefense && ball.pos.y * att < -2600 && oppDistBall < myDistBall * 0.7 && !threat && Math.abs(this.iy - ownGoalY) > 2200) {
      // opponent is first to the ball in our half: shadow between ball and goal
      this.mode = Mode.Defend;
      const f = 0.3;
      this.tx = clamp(ball.pos.x * 0.5, -1500, 1500);
      this.ty = ownGoalY + (ball.pos.y - ownGoalY) * f;
      this.tz = 0;
      this.targetSpeed = 1800;
      this.boostOk = false;
    } else if (cfg.boostPads && car.boost < (cfg.boostSkill === 2 ? 18 : 30) && !threat && this.padWorthIt(car, ball.pos, att)) {
      this.mode = Mode.Boost;
      this.boostOk = false;
    } else if (cfg.demos && opp && !opp.demolished && car.boost > 25 && this.demoWorthIt(car, opp, ball.pos, att)) {
      this.mode = Mode.Demo;
      this.tx = opp.pos.x + opp.vel.x * 0.25; this.ty = opp.pos.y + opp.vel.y * 0.25; this.tz = 0;
      this.targetSpeed = 2300; this.boostOk = true;
    } else if (sim.tick < this.idleUntil && !threat) {
      this.mode = Mode.Recover;
      this.tx = 0; this.ty = ownGoalY * 0.55; this.tz = 0;
      this.targetSpeed = Math.min(this.targetSpeed, 1200);
      this.boostOk = false;
    } else {
      this.mode = threat || ballOwnSide ? Mode.Defend : Mode.Attack;
      this.planStrike(car, opp, att, threat);
    }
    this.setDebug();
  }

  private setDebug(): void {
    this.debug.mode = this.mode; this.debug.tx = this.tx; this.debug.ty = this.ty; this.debug.tz = this.tz;
  }

  private planStrike(car: CarState, opp: CarState | null, att: number, threat: boolean): void {
    const cfg = this.cfg;
    const bx = this.ix, by = this.iy;
    // where to send the ball
    let ax: number, ay: number;
    if (threat || this.mode === Mode.Defend) {
      // clear to the side, away from our goal
      ax = (bx >= 0 ? 1 : -1) * 3000; ay = by + att * 1800;
    } else {
      ay = att * GOAL_Y;
      ax = 0;
      if (cfg.shotPlacement) {
        const gx = 420;
        ax = opp && opp.pos.x > 0 ? -gx : gx;
        if (!opp) ax = bx > 0 ? -gx : gx;
      } else if (this.level === 'medium') {
        ax = bx > 0 ? -300 : 300;
      }
    }
    let dx = ax - bx, dy = ay - by;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;
    const dist = Math.hypot(bx - car.pos.x, by - car.pos.y);
    // approach point shifts from a line-up behind the ball to the contact point as we close in
    const back = BALL.radius + clamp((dist - 350) * 0.45, 40, 650);
    this.tx = bx - dx * back;
    this.ty = by - dy * back;
    this.tz = 0;
    this.dodgeDX = dx; this.dodgeDY = dy;
    // mistimed approaches: weaker bots aim at the wrong lane sometimes
    if (this.rng.next() < cfg.mistime * 0.25) { this.tx += (this.rng.next() - 0.5) * 500; this.ty += (this.rng.next() - 0.5) * 500; }
    this.aerial = this.iz > 300 && cfg.aerials > 0 && !(cfg.aerials === 1 && this.rng.next() > 0.35);
    if (this.aerial) { this.tx = this.ix; this.ty = this.iy; this.tz = this.iz; }
    if (this.aerial && cfg.aerials === 1) this.targetSpeed = Math.min(this.targetSpeed, 1700);
  }

  private nearestOpponent(car: CarState): CarState | null {
    let best: CarState | null = null, bd = Infinity;
    for (const c of this.sim.cars) {
      if (c.team === car.team) continue;
      const d = Math.hypot(c.pos.x - car.pos.x, c.pos.y - car.pos.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  private padWorthIt(car: CarState, ballPos: Vec3, att: number): boolean {
    const cfg = this.cfg;
    const ballDist = Math.hypot(ballPos.x - car.pos.x, ballPos.y - car.pos.y);
    if (cfg.boostSkill >= 1 && ballDist < 1400 && car.boost > 10) return false;
    if (cfg.boostSkill === 2 && ballDist < 3200) return false;
    if (cfg.boostSkill === 1 && ballDist < 2200) return false;
    let best = -1, bs = Infinity;
    const pads = this.sim.pads;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p.active) continue;
      if (cfg.boostSkill < 2 && p.large && false) continue;
      const d = Math.hypot(p.x - car.pos.x, p.y - car.pos.y);
      // prefer big pads and pads on our side of the field
      let score = d - (p.large ? 900 : 0);
      if (p.y * att > 1500) score += 800;
      if (d > 3200) continue;
      if (score < bs) { bs = score; best = i; }
    }
    if (best < 0) return false;
    this.tx = pads[best].x; this.ty = pads[best].y; this.tz = 0;
    this.targetSpeed = 1800;
    return true;
  }

  private demoWorthIt(car: CarState, opp: CarState, ballPos: Vec3, att: number): boolean {
    const d = Math.hypot(opp.pos.x - car.pos.x, opp.pos.y - car.pos.y);
    if (d > 2600 || d < 500) return false;
    const ballDist = Math.hypot(ballPos.x - car.pos.x, ballPos.y - car.pos.y);
    if (ballDist < d * 0.8) return false; // ball is closer than the demo target
    if (ballPos.y * att < -2500) return false; // keep defending
    const m = car.basis.m;
    const lx = (opp.pos.x - car.pos.x) * m[0] + (opp.pos.y - car.pos.y) * m[3];
    return lx > 0 && Math.abs(Math.atan2((opp.pos.x - car.pos.x) * m[1] + (opp.pos.y - car.pos.y) * m[4], lx)) < 0.5;
  }

  // ---------------------------------------------------------------- execution
  private execute(car: CarState, out: CarInput): void {
    const cfg = this.cfg;
    const m = car.basis.m;
    const sim = this.sim;
    const ball = sim.ball;

    // stuck handling
    const sp = Math.hypot(car.vel.x, car.vel.y, car.vel.z);
    if (car.onGround && sp < 60 && sim.phase === Phase.Playing) this.stuckTime += PHYSICS.dt; else this.stuckTime = 0;
    if (this.stuckTime > 1.0 && this.reverseTime <= 0) { this.reverseTime = 0.7; this.stuckTime = 0; }
    if (this.reverseTime > 0) {
      this.reverseTime -= PHYSICS.dt;
      out.throttle = -1; out.steer = this.rng.next() < 0.5 ? -1 : 1;
      return;
    }

    // dodge sequence in progress
    if (this.dodgeState > 0) { this.runDodge(car, out); if (this.dodgeState > 0) return; }

    if (!car.onGround) { this.airControl(car, out, ball.pos); return; }

    // aerial launch
    if (this.aerial && this.mode !== Mode.Kickoff) {
      const dx = this.ix - car.pos.x, dy = this.iy - car.pos.y;
      const flat = Math.hypot(dx, dy);
      const lx = dx * m[0] + dy * m[3];
      const need = this.interceptT;
      const ready = lx > 0 && flat < 2200 && need < 1.5 && need > 0.45 && Math.abs(Math.atan2(dx * m[1] + dy * m[4], lx)) < 0.5;
      if (ready) { this.startJump(); this.committed = true; out.jump = true; this.jumpHold = 0.25; out.boost = false; return; }
    }

    this.driveTo(car, out, this.tx, this.ty);

    // ground dodge into the ball
    const bdx = ball.pos.x - car.pos.x, bdy = ball.pos.y - car.pos.y;
    const bd = Math.hypot(bdx, bdy);
    if (this.dodgeState === 0 && ball.pos.z < 260 && sp > 600) {
      const lx = bdx * m[0] + bdy * m[3], ly = bdx * m[1] + bdy * m[4];
      const ang = Math.atan2(ly, lx);
      const tt = bd / Math.max(300, sp);
      const kick = this.mode === Mode.Kickoff;
      const window = kick ? 680 : 420;
      if (bd < window && bd > 180 && Math.abs(ang) < 0.6 && tt < 0.55 && (kick ? cfg.kickoffFlip : this.mode === Mode.Attack || this.mode === Mode.Defend)) {
        if (this.rng.next() < (kick ? 1 : cfg.dodgeChance * 0.35)) {
          this.startJump();
          this.dodgeDX = Math.cos(ang); this.dodgeDY = -Math.sin(ang);
          out.jump = true;
        }
      }
    }
  }

  private startJump(): void {
    this.dodgeState = 1;
    this.dodgeTimer = 0;
  }

  /** 1: first jump held briefly, 2: gap, 3: second press with direction. */
  private runDodge(car: CarState, out: CarInput): void {
    const dt = PHYSICS.dt;
    this.dodgeTimer += dt;
    const late = this.rng.next() < this.cfg.mistime * 0.02 ? 0.04 : 0;
    if (this.dodgeState === 1) {
      out.jump = true;
      if (this.dodgeTimer > Math.max(0.05, this.jumpHold)) { this.dodgeState = 2; this.dodgeTimer = 0; this.jumpHold = 0; }
      out.throttle = 1; out.boost = this.mode === Mode.Kickoff || this.boostOk;
    } else if (this.dodgeState === 2) {
      out.throttle = 1; out.boost = false;
      if (this.aerial) { this.dodgeState = 0; return; }
      if (this.dodgeTimer > 0.07 + late) { this.dodgeState = 3; this.dodgeTimer = 0; }
    } else if (this.dodgeState === 3) {
      out.jump = true;
      out.pitch = this.dodgeDX; out.yaw = this.dodgeDY; out.steer = this.dodgeDY;
      out.boost = this.mode === Mode.Kickoff;
      if (this.dodgeTimer > 0.04) { this.dodgeState = 0; this.jumpHold = 0; }
    }
    void car;
  }

  private driveTo(car: CarState, out: CarInput, tx: number, ty: number): void {
    const cfg = this.cfg;
    const m = car.basis.m;
    const dx = tx - car.pos.x, dy = ty - car.pos.y;
    const dist = Math.hypot(dx, dy);
    const lx = dx * m[0] + dy * m[3] + 0 * m[6];
    const ly = dx * m[1] + dy * m[4];
    const ang = Math.atan2(ly, lx);
    const abs = Math.abs(ang);
    const fwdSpeed = car.vel.x * m[0] + car.vel.y * m[3] + car.vel.z * m[6];
    // steering noise (smoothed random walk)
    this.noise += (this.rng.next() - 0.5) * 0.3 - this.noise * 0.05;
    out.steer = clamp(-ang * 2.6, -1, 1) + this.noise * cfg.steerNoise * 3;
    out.steer = clamp(out.steer, -1, 1);
    out.yaw = out.steer;

    let wantSpeed = this.targetSpeed;
    // approach control: slow down when the target is off to the side and close, commit when lined up
    if (this.mode !== Mode.Kickoff && abs > 0.45 && dist < 1600) wantSpeed = Math.min(wantSpeed, 450 + dist * 0.9);
    if (abs > 2.3 && fwdSpeed < 300 && dist < 1800) {
      // target behind us: back up while turning
      out.throttle = -1; out.steer = -out.steer; out.yaw = out.steer;
      return;
    }
    out.throttle = fwdSpeed < wantSpeed ? 1 : fwdSpeed > wantSpeed + 250 ? -0.3 : 0;
    if (dist < 350 && this.mode !== Mode.Attack && this.mode !== Mode.Kickoff) out.throttle = clamp((dist - 150) / 300, 0, 1) * (fwdSpeed > 400 ? 0 : 1);
    // powerslide for tight turns
    if (cfg.boostSkill >= 1 && abs > 1.15 && fwdSpeed > 700 && dist > 500) out.handbrake = true;
    // boost
    const aligned = abs < 0.22;
    if (this.boostOk && aligned && car.boost > 0 && fwdSpeed < Math.min(2290, wantSpeed + 100) && dist > 700) {
      if (cfg.boostSkill === 0) out.boost = (this.tickCount >> 5) % 5 === 0; // short bursts
      else out.boost = true;
    }
    if (this.mode === Mode.Kickoff) { out.boost = car.boost > 0 && aligned; out.throttle = 1; }
  }

  /** Aerial / recovery controller (PD on orientation). */
  private airControl(car: CarState, out: CarInput, ballPos: Vec3): void {
    const m = car.basis.m;
    let fx: number, fy: number, fz: number;
    let boost = false;
    const dt = this.interceptT;
    if (this.aerial && this.mode !== Mode.Recover) {
      // required velocity to meet the intercept point
      const t = Math.max(0.15, dt);
      const vnx = (this.ix - car.pos.x) / t, vny = (this.iy - car.pos.y) / t, vnz = (this.iz - car.pos.z) / t - 0.5 * PHYSICS.gravity * t;
      let ax = vnx - car.vel.x, ay = vny - car.vel.y, az = vnz - car.vel.z;
      const al = Math.hypot(ax, ay, az) || 1;
      const sloppy = this.cfg.aerials === 1 ? 0.35 : 0;
      ax += (this.rng.next() - 0.5) * sloppy * al; ay += (this.rng.next() - 0.5) * sloppy * al;
      const l2 = Math.hypot(ax, ay, az) || 1;
      fx = ax / l2; fy = ay / l2; fz = az / l2;
      const facing = fx * m[0] + fy * m[3] + fz * m[6];
      boost = al > 140 && facing > 0.93 && car.boost > 0;
      // flip into the ball when close
      const bd = Math.hypot(ballPos.x - car.pos.x, ballPos.y - car.pos.y, ballPos.z - car.pos.z);
      if (bd < 260 && !car.flipUsed && car.airTime < 1.2) {
        const lx = (ballPos.x - car.pos.x) * m[0] + (ballPos.y - car.pos.y) * m[3] + (ballPos.z - car.pos.z) * m[6];
        const ly = (ballPos.x - car.pos.x) * m[1] + (ballPos.y - car.pos.y) * m[4] + (ballPos.z - car.pos.z) * m[7];
        this.dodgeDX = lx > 0 ? 1 : -1; this.dodgeDY = clamp(-ly / 90, -1, 1);
        this.dodgeState = 3; this.dodgeTimer = 0; this.aerial = false;
        out.jump = true; out.pitch = this.dodgeDX; out.yaw = this.dodgeDY;
        return;
      }
    } else if (this.jumpHold > 0 || this.dodgeState === 2) {
      // keep the nose toward travel direction while the jump ends
      fx = car.vel.x; fy = car.vel.y; fz = Math.max(0, car.vel.z * 0.2);
      const l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
    } else {
      // recovery: face travel direction, wheels toward the nearest surface
      fx = car.vel.x; fy = car.vel.y; fz = 0;
      const l = Math.hypot(fx, fy) || 1; fx /= l; fy /= l;
      if (l < 1e-6 || Math.hypot(car.vel.x, car.vel.y) < 50) { fx = m[0]; fy = m[3]; }
    }
    // upright target: world up, or the nearest surface when close to one
    let ux = 0, uy = 0, uz = 1;
    if (!this.aerial) {
      const px = car.pos.x + car.vel.x * 0.25, py = car.pos.y + car.vel.y * 0.25, pz = car.pos.z + car.vel.z * 0.25;
      if (arena.sdf(px, py, pz) < 260) {
        const n = new Vec3();
        arena.normal(n, px, py, pz);
        ux = n.x; uy = n.y; uz = n.z;
      }
    }
    this.orient(car, out, fx, fy, fz, ux, uy, uz, this.aerial);
    out.boost = boost;
    if (this.jumpHold > 0) { out.jump = true; this.jumpHold -= PHYSICS.dt; }
  }


  /** PD attitude control: rotate the nose toward (fx,fy,fz) with the roof toward (ux,uy,uz). */
  private orient(car: CarState, out: CarInput, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number, noRoll: boolean): void {
    orientCar(car, out, fx, fy, fz, ux, uy, uz, noRoll);
  }
}

/** The pieces of a bot that the game loop and the dev tools use. */
export interface BotAgent {
  think(): void;
  readonly predictedPath: BallPath;
  readonly target: Vec3;
  debug: { mode: number; tx: number; ty: number; tz: number };
}

/** Builds the right controller for a difficulty: the Ultrahard Boss is its own simulation-planning bot. */
export function createBot(level: BotLevel, sim: GameSim, index: number, seed = 1): BotAgent {
  if (level === 'ultrahard') return new BossBot(sim, index);
  return new Bot(level, sim, index, seed);
}

// keep unused imports honest for tree-shaking consumers
void CAR; void TOP_THROTTLE;
