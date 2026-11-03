import * as arena from '../arena';
import { BallState, copyBall, stepBall } from '../ball';
import { CarInput, CarState, copyCar, stepCar } from '../car';
import { CarCarResult, collideCarBall, collideCarCar } from '../collide';
import { ARENA, BALL, PADS, PHYSICS } from '../constants';
import { clamp } from '../math/scalar';
import { Vec3 } from '../math/vec3';
import { GameSim, Phase } from '../sim';
import { Prng } from '../prng';
import { orientCar } from './control';
import { BallPath, predictBall } from './predict';

/**
 * The Ultrahard Boss.
 *
 * It plays the same physics and the same input struct as a human, but it thinks like a pro: before it
 * commits to a play it simulates the car and the ball forward with the real physics, tries several
 * approach angles, aim points and flip timings, scores what each one does to the ball, and executes
 * the best. The executor that drives the car is the same code used inside those simulations, so what
 * it predicts is what it does. A decision is spread over a few ticks so the cost stays smooth.
 */

const DT = PHYSICS.dt;
const L = ARENA.halfLength;
const W = ARENA.halfWidth;
const R = BALL.radius;
const GOAL_HALF = ARENA.goal.halfWidth;
const HORIZON = 5;
const PLAN_PERIOD = 8; // ticks between decisions when the touch is near (15 Hz); half as often otherwise
const FULL_EVERY = 40; // ticks between full candidate searches; in between the current play is refined
const BUDGET = 3; // rollouts per tick
const STRIKE_MIN = -600; // a play scoring below this is not worth leaving position for
const TIME_COST = 140; // score lost per second until the touch: earlier touches win possession
const AERIAL_BONUS = 260; // a viable aerial is preferred to waiting for the ball to drop (earlier, harder to defend)
const PAD_BOOST = 70; // detour for a pad on the way to a play below this boost
const PAD_SLACK = 2.0; // ... when there are at least this many seconds before the touch
const FAKE_TIME = 0.5; // seconds a fake lasts at most
const NOISE = 22; // bias per aim point, redrawn each full search: near-equal shot corners are picked at random so the boss is not readable
const DEMO_MAX = 1.6; // seconds a demolition run lasts at most
const DEMO_COOLDOWN = 3.5; // seconds between demolition runs

const K = { Drive: 0, Strike: 1, Aerial: 2, Pad: 3, Shadow: 4 } as const;
type Kind = (typeof K)[keyof typeof K];

/** One decision: where to be, when, and how to hit the ball. */
class Plan {
  kind: Kind = K.Drive;
  /** Drive target (Drive / Pad / Shadow). */
  tx = 0; ty = 0;
  speed = 1500;
  boost = true;
  /** Strike / Aerial: ball centre at the planned touch, and when (executor clock, seconds). */
  cx = 0; cy = 0; cz = 0;
  contactT = 0;
  /** Direction (horizontal, unit) the ball should be pushed, and the world point it is aimed at. */
  aimX = 0; aimY = 1;
  aimPX = 0; aimPY = 0;
  flip = true;
  /** Seconds before contact at which the jump for the dodge starts. */
  flipLead = 0.3;
  /** Aerial: absolute time of take-off. */
  jumpAt = 0;
  /** Aerial: use the second jump for height (fast aerial) instead of keeping it for a flip into the ball. */
  fast = false;
  /** Strike: go flat out instead of pacing the run so we arrive exactly at `contactT` (tip-off, 50/50s). */
  rush = false;
  score = 0;
  copy(o: Plan): this {
    this.kind = o.kind; this.tx = o.tx; this.ty = o.ty; this.speed = o.speed; this.boost = o.boost;
    this.cx = o.cx; this.cy = o.cy; this.cz = o.cz; this.contactT = o.contactT; this.aimX = o.aimX; this.aimY = o.aimY;
    this.aimPX = o.aimPX; this.aimPY = o.aimPY;
    this.flip = o.flip; this.flipLead = o.flipLead; this.jumpAt = o.jumpAt; this.fast = o.fast; this.rush = o.rush; this.score = o.score;
    return this;
  }
}

/** Low-level state the executor carries between ticks (dodge sequence, aerial commitment). */
class Exec {
  now = 0;
  dodge = 0; // 1 jump held, 2 gap, 3 flip press
  dodgeT = 0;
  hold = 0.05;
  gap = 0.06;
  dX = 1; dY = 0;
  jumpHold = 0;
  inAerial = false;
  /** Fast aerial: 0 waiting, 1 releasing the jump, 2 done. */
  fastStage = 0;
  fastT = 0;
  copy(o: Exec): this {
    this.now = o.now; this.dodge = o.dodge; this.dodgeT = o.dodgeT; this.hold = o.hold; this.gap = o.gap;
    this.dX = o.dX; this.dY = o.dY; this.jumpHold = o.jumpHold; this.inAerial = o.inAerial;
    this.fastStage = o.fastStage; this.fastT = o.fastT;
    return this;
  }
}

const upN = new Vec3();

// ------------------------------------------------------------------------------------------------
// Executor: turns a Plan into inputs for this tick. Pure function of (car, ball, plan, exec).
// ------------------------------------------------------------------------------------------------

function driveTo(car: CarState, out: CarInput, tx: number, ty: number, want: number, boostOk: boolean): void {
  const m = car.basis.m;
  const dx = tx - car.pos.x, dy = ty - car.pos.y;
  const dist = Math.hypot(dx, dy);
  const lx = dx * m[0] + dy * m[3];
  const ly = dx * m[1] + dy * m[4];
  const ang = Math.atan2(ly, lx);
  const abs = Math.abs(ang);
  const fwd = car.vel.x * m[0] + car.vel.y * m[3] + car.vel.z * m[6];
  out.steer = clamp(-ang * 3.0, -1, 1);
  out.yaw = out.steer;
  if (abs > 2.3 && fwd < 300 && dist < 1800) {
    out.throttle = -1; out.steer = -out.steer; out.yaw = out.steer;
    return;
  }
  let w = want;
  if (abs > 0.5 && dist < 1500) w = Math.min(w, 500 + dist * 0.9);
  out.throttle = fwd < w ? 1 : fwd > w + 250 ? -0.3 : 0;
  if (abs > 1.15 && fwd > 700 && dist > 500) out.handbrake = true;
  if (boostOk && abs < 0.22 && car.boost > 0 && fwd < Math.min(2290, w + 100)) out.boost = true;
}

/** Nose along the direction of travel, wheels toward the nearest surface (or the sky's opposite). */
function recover(car: CarState, out: CarInput): void {
  const m = car.basis.m;
  let fx = car.vel.x, fy = car.vel.y;
  let l = Math.hypot(fx, fy);
  if (l < 50) { fx = m[0]; fy = m[3]; l = Math.hypot(fx, fy) || 1; }
  fx /= l; fy /= l;
  let ux = 0, uy = 0, uz = 1;
  const px = car.pos.x + car.vel.x * 0.25, py = car.pos.y + car.vel.y * 0.25, pz = car.pos.z + car.vel.z * 0.25;
  if (arena.sdf(px, py, pz) < 260) {
    arena.normal(upN, px, py, pz);
    ux = upN.x; uy = upN.y; uz = upN.z;
  }
  orientCar(car, out, fx, fy, 0, ux, uy, uz, false);
}

function startDodge(car: CarState, ex: Exec, ax: number, ay: number, stage: 1 | 3): void {
  const m = car.basis.m;
  const lx = ax * m[0] + ay * m[3];
  const ly = ax * m[1] + ay * m[4];
  const n = Math.hypot(lx, ly) || 1;
  ex.dX = lx / n; ex.dY = -ly / n;
  ex.dodge = stage; ex.dodgeT = 0;
}

function runDodge(car: CarState, plan: Plan, ex: Exec, out: CarInput): void {
  ex.dodgeT += DT;
  const burn = plan.boost && car.boost > 0;
  if (ex.dodge === 1) {
    out.jump = true; out.throttle = 1; out.boost = burn;
    if (ex.dodgeT >= ex.hold) { ex.dodge = 2; ex.dodgeT = 0; }
  } else if (ex.dodge === 2) {
    out.throttle = 1; out.boost = burn;
    if (ex.dodgeT >= ex.gap) { ex.dodge = 3; ex.dodgeT = 0; }
  } else if (ex.dodge === 3) {
    out.jump = true; out.pitch = ex.dX; out.yaw = ex.dY; out.steer = ex.dY;
    if (ex.dodgeT >= 0.04) { ex.dodge = 0; ex.dodgeT = 0; }
  }
}

function groundStrike(car: CarState, ball: BallState, plan: Plan, ex: Exec, out: CarInput): void {
  const m = car.basis.m;
  const dx = plan.cx - car.pos.x, dy = plan.cy - car.pos.y;
  const dist = Math.hypot(dx, dy);
  const timeLeft = plan.contactT - ex.now;
  // line up behind the contact point, closing in as we get near
  // (a rushing run goes straight at the ball: no dog-leg to line up a shot)
  const back = plan.rush ? R + 47 : R + 47 + clamp((dist - 350) * 0.45, 0, 650);
  const tx = plan.cx - plan.aimX * back, ty = plan.cy - plan.aimY * back;
  const fwd = car.vel.x * m[0] + car.vel.y * m[3] + car.vel.z * m[6];
  const need = dist / Math.max(0.05, timeLeft);
  const want = plan.rush ? 2300 : clamp(need, 800, 2300);
  if (plan.flip && timeLeft <= plan.flipLead && timeLeft > -0.15) {
    const bdx = ball.pos.x - car.pos.x, bdy = ball.pos.y - car.pos.y;
    const bd = Math.hypot(bdx, bdy);
    const ang = Math.atan2(bdx * m[1] + bdy * m[4], bdx * m[0] + bdy * m[3]);
    // a rushing run (tip-off) flips from much farther out: the flip's extra speed gets us there first
    if (bd < (plan.rush ? 1800 : 620) && Math.abs(ang) < 0.55 && ball.pos.z < 300) {
      startDodge(car, ex, plan.aimX, plan.aimY, 1);
      ex.hold = 0.05; ex.gap = 0.06;
      runDodge(car, plan, ex, out);
      return;
    }
  }
  driveTo(car, out, tx, ty, want, plan.boost && (plan.rush || need > fwd + 120));
}

function groundAerial(car: CarState, plan: Plan, ex: Exec, out: CarInput): void {
  const m = car.basis.m;
  const dx = plan.cx - car.pos.x, dy = plan.cy - car.pos.y;
  const flat = Math.hypot(dx, dy);
  const ang = Math.atan2(dx * m[1] + dy * m[4], dx * m[0] + dy * m[3]);
  if (ex.now >= plan.jumpAt && Math.abs(ang) < 0.6) {
    ex.inAerial = true; ex.jumpHold = 0.2; ex.fastStage = 0; ex.fastT = 0;
    out.jump = true; out.throttle = 1;
    return;
  }
  const need = flat / Math.max(0.05, plan.contactT - ex.now);
  const fwd = car.vel.x * m[0] + car.vel.y * m[3] + car.vel.z * m[6];
  driveTo(car, out, plan.cx, plan.cy, clamp(need, 700, 2300), plan.boost && need > fwd + 120);
}

function airControl(car: CarState, ball: BallState, plan: Plan, ex: Exec, out: CarInput): void {
  const m = car.basis.m;
  if (plan.kind === K.Aerial && ex.inAerial) {
    const tau = Math.max(0.12, plan.contactT - ex.now);
    const g = PHYSICS.gravity;
    const ax = (plan.cx - car.pos.x) / tau - car.vel.x;
    const ay = (plan.cy - car.pos.y) / tau - car.vel.y;
    const az = (plan.cz - car.pos.z) / tau - 0.5 * g * tau - car.vel.z;
    const al = Math.hypot(ax, ay, az) || 1;
    const fx = ax / al, fy = ay / al, fz = az / al;
    orientCar(car, out, fx, fy, fz, 0, 0, 1, true);
    const facing = fx * m[0] + fy * m[3] + fz * m[6];
    out.boost = al > 120 && facing > 0.92 && car.boost > 0;
    if (ex.jumpHold > 0) { out.jump = true; ex.jumpHold -= DT; }
    else if (plan.fast && ex.fastStage < 2 && !car.flipUsed) {
      // fast aerial: let go of the jump for two ticks, then press it again with no direction for a second
      // upward kick, and keep pitching toward the ball
      ex.fastT += DT;
      if (ex.fastStage === 0) { ex.fastStage = 1; ex.fastT = 0; }
      else if (ex.fastT > 2.5 * DT) { out.jump = true; out.pitch = 0; out.yaw = 0; out.roll = 0; ex.fastStage = 2; }
    }
    const bd = Math.hypot(ball.pos.x - car.pos.x, ball.pos.y - car.pos.y, ball.pos.z - car.pos.z);
    if (plan.flip && bd < 235 && !car.flipUsed && ex.jumpHold <= 0 && car.airTime > 0.12) {
      startDodge(car, ex, plan.aimX, plan.aimY, 3);
      runDodge(car, plan, ex, out);
    }
    return;
  }
  if (ex.jumpHold > 0) { out.jump = true; ex.jumpHold -= DT; }
  recover(car, out);
}

function execute(car: CarState, ball: BallState, plan: Plan, ex: Exec, out: CarInput): void {
  out.clear();
  if (ex.dodge > 0) { runDodge(car, plan, ex, out); if (ex.dodge > 0) return; }
  if (!car.onGround) { airControl(car, ball, plan, ex, out); return; }
  ex.inAerial = false;
  if (plan.kind === K.Strike) groundStrike(car, ball, plan, ex, out);
  else if (plan.kind === K.Aerial) groundAerial(car, plan, ex, out);
  else driveTo(car, out, plan.tx, plan.ty, plan.speed, plan.boost);
}

// ------------------------------------------------------------------------------------------------
// Planner
// ------------------------------------------------------------------------------------------------

const MAX_OUT = 100; // outcome samples, 1/30 s apart: three seconds of ball flight after the touch

/** A decision in progress: candidates are tried a few per tick against a frozen snapshot of the game. */
interface Candidate { t: number; px: number; py: number; flip: boolean; lead: number; /** aerial flight time; 0/absent = ground strike */ tau?: number; fast?: boolean; rush?: boolean }

export class BossBot {
  readonly level = 'ultrahard' as const;
  readonly path = new BallPath();
  /** Dev-mode debug: latest plan. */
  debug = { mode: 0, tx: 0, ty: 0, tz: 0 };
  /** Decision counters for tuning: how each search ended. */
  readonly stats = { searches: 0, noReach: 0, noTouch: 0, lowScore: 0, strikes: 0, pads: 0, shadows: 0, aerialTried: 0, aerialTouched: 0, aerials: 0, demoRuns: 0, demos: 0 };

  private plan = new Plan();
  private ex = new Exec();
  private tickCount = 0;
  private hasPlan = false;
  private lastBallVy = 0;
  private lastFull = -999;
  private fakeT = 0;
  private fakeCooldown = 0;
  private demoT = 0;
  private rng: Prng;
  private aimBias = new Map<number, number>();
  private demoCooldown = 0;
  private stuckTime = 0;
  private reverseTime = 0;
  // snapshot a search works on
  private snapCar = new CarState();
  private snapBall = new BallState();
  private snapEx = new Exec();
  private snapOpp = new CarState();
  private hasOpp = false;
  private snapTick = 0;
  private att = 1;
  private threat = false;
  private kickoff = false;
  // search progress
  private searching = false;
  private stage = 0;
  private queue: Candidate[] = [];
  private qi = 0;
  private bestScore = -1e9;
  /** Best score per kind in the last search (debug / tuning). */
  bestAerial = -1e9;
  bestGround = -1e9;
  private best = new Plan();
  private found = false;
  private fullSearch = true;
  // rollout scratch
  private rc = new CarState();
  private rb = new BallState();
  private rex = new Exec();
  private rin = new CarInput();
  // a simple model of the opponent, simulated alongside us in contested plays
  private oc = new CarState();
  private oex = new Exec();
  private oin = new CarInput();
  private oppPlan = new Plan();
  private useOpp = false;
  private eb = new BallState();
  private cand = new Plan();
  private ox = new Float32Array(MAX_OUT);
  private oy = new Float32Array(MAX_OUT);
  private oz = new Float32Array(MAX_OUT);
  private tmp = new Vec3();

  constructor(private sim: GameSim, readonly index: number) { this.rng = new Prng(index * 7919 + 13); }

  get predictedPath(): BallPath { return this.path; }
  get target(): Vec3 { return new Vec3(this.plan.tx, this.plan.ty, this.plan.cz); }

  think(): void {
    const sim = this.sim;
    const car = sim.cars[this.index];
    const out = sim.inputs[this.index];
    if (sim.phase !== Phase.Playing) {
      out.clear(); this.hasPlan = false; this.searching = false; this.ex.dodge = 0; this.ex.inAerial = false; this.ex.jumpHold = 0;
      return;
    }
    if (car.demolished) { out.clear(); this.searching = false; return; }
    this.ex.now = sim.tick * DT;
    this.tickCount++;

    const busy = this.ex.dodge > 0 || this.ex.jumpHold > 0 || (this.ex.inAerial && !car.onGround);
    const touched = Math.abs(sim.ball.vel.y - this.lastBallVy) > 400;
    this.lastBallVy = sim.ball.vel.y;

    if (this.searching) this.stepSearch(car, BUDGET);
    else {
      // decide often when the touch is near, rarely while we are just driving there
      const engaged = (this.plan.kind === K.Strike || this.plan.kind === K.Aerial) && this.plan.contactT - this.ex.now < 1.2;
      const period = engaged ? PLAN_PERIOD : PLAN_PERIOD * 2;
      if (!this.hasPlan || (!busy && (this.tickCount % period === 0 || touched))) this.startSearch(car, touched);
      else if (this.plan.kind === K.Aerial && this.ex.inAerial && this.tickCount % PLAN_PERIOD === 0) this.refreshAerial();
      if (this.searching) this.stepSearch(car, BUDGET);
    }

    // fake challenge: rush the ball, then brake and hop as if committing; once the opponent flips, take the ball
    if (this.runDemo(car, out)) return;
    if (this.runFake(car, out)) return;

    // stuck handling
    const sp = Math.hypot(car.vel.x, car.vel.y, car.vel.z);
    if (car.onGround && sp < 60) this.stuckTime += DT; else this.stuckTime = 0;
    if (this.stuckTime > 1.0 && this.reverseTime <= 0) { this.reverseTime = 0.7; this.stuckTime = 0; }
    if (this.reverseTime > 0) {
      this.reverseTime -= DT;
      out.clear(); out.throttle = -1; out.steer = (this.tickCount >> 4) % 2 ? 1 : -1;
      return;
    }
    execute(car, sim.ball, this.plan, this.ex, out);
  }

  /**
   * Demolition run (a staple of the pro we model it on): with boost and a clear line, drive at the
   * opponent's predicted position at supersonic speed. A demolished opponent is out for three seconds,
   * which is a free ball. Only when the ball play does not need us in the next moment.
   */
  private runDemo(car: CarState, out: CarInput): boolean {
    const sim = this.sim;
    const att = this.att;
    this.demoCooldown -= DT;
    const opp = this.nearestOpponent(car);
    if (this.demoT > 0) {
      this.demoT -= DT;
      if (!opp || opp.demolished) {
        if (opp && opp.demolished) this.stats.demos++;
        this.demoT = 0; this.demoCooldown = 1; this.hasPlan = false; return false;
      }
      const dx = opp.pos.x - car.pos.x, dy = opp.pos.y - car.pos.y;
      const dist = Math.hypot(dx, dy);
      const m = car.basis.m;
      const lead = clamp(dist / 2300, 0, 0.9);
      const tx = clamp(opp.pos.x + opp.vel.x * lead, -(W - 150), W - 150), ty = clamp(opp.pos.y + opp.vel.y * lead, -(L - 150), L - 150);
      const ang = Math.atan2((tx - car.pos.x) * m[1] + (ty - car.pos.y) * m[4], (tx - car.pos.x) * m[0] + (ty - car.pos.y) * m[3]);
      const ballT = Math.hypot(sim.ball.pos.x - car.pos.x, sim.ball.pos.y - car.pos.y);
      if (this.demoT <= 0 || !car.onGround || opp.pos.z > 260 || Math.abs(ang) > 1.1 || car.boost <= 0 && Math.hypot(car.vel.x, car.vel.y) < 2200 || (this.threat && ballT < 2500)) {
        this.demoT = 0; this.demoCooldown = DEMO_COOLDOWN; this.hasPlan = false; return false;
      }
      out.clear();
      driveTo(car, out, tx, ty, 2300, true);
      return true;
    }
    if (this.demoCooldown > 0 || !opp || opp.demolished || !car.onGround || this.threat || this.kickoff || this.ex.dodge > 0) return false;
    if (car.boost < 45 || opp.pos.z > 150 || sim.ball.pos.z > 400) return false;
    // a ball play that is about to happen comes first
    if ((this.plan.kind === K.Strike || this.plan.kind === K.Aerial) && this.plan.contactT - this.ex.now < 1.4) return false;
    const dx = opp.pos.x - car.pos.x, dy = opp.pos.y - car.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 900 || dist > 3300) return false;
    const m = car.basis.m;
    const fwd = car.vel.x * m[0] + car.vel.y * m[3];
    const tx = opp.pos.x + opp.vel.x * (dist / 2300), ty = opp.pos.y + opp.vel.y * (dist / 2300);
    const ang = Math.atan2((tx - car.pos.x) * m[1] + (ty - car.pos.y) * m[4], (tx - car.pos.x) * m[0] + (ty - car.pos.y) * m[3]);
    if (Math.abs(ang) > 0.45 || fwd < 1300) return false;
    // not when the opponent is coming straight at us just as fast (the faster car wins the clash; do not gamble)
    const oppFwd = (opp.vel.x * -dx + opp.vel.y * -dy) / dist;
    if (oppFwd > 1500) return false;
    // worth it when the opponent is the one nearer the ball, or when the ball is in their half and we have a lane
    const bo = Math.hypot(sim.ball.pos.x - opp.pos.x, sim.ball.pos.y - opp.pos.y);
    const bc = Math.hypot(sim.ball.pos.x - car.pos.x, sim.ball.pos.y - car.pos.y);
    if (!(bo < bc - 300 || sim.ball.pos.y * att > 1500)) return false;
    // never leave the goal open while the ball is on our side and heading our way
    if (sim.ball.pos.y * att < -1500 && sim.ball.vel.y * att < 0) return false;
    this.demoT = DEMO_MAX; this.stats.demoRuns++;
    return this.runDemo(car, out);
  }

  /** Returns true while a fake is being played (it owns the inputs for those ticks). */
  private runFake(car: CarState, out: CarInput): boolean {
    const sim = this.sim;
    const ball = sim.ball;
    this.fakeCooldown -= DT;
    if (this.fakeT > 0) {
      this.fakeT -= DT;
      const opp = this.nearestOpponent(car);
      const oppCommitted = !!opp && (!opp.onGround || opp.flipActive);
      if (oppCommitted || this.fakeT <= 0 || ball.pos.z > 220) { this.fakeT = 0; this.fakeCooldown = 2 + this.rng.next() * 4; this.hasPlan = false; return false; }
      out.clear();
      // brake while hopping, keep the nose on the ball
      out.throttle = car.onGround ? -1 : 0;
      if (this.fakeT > FAKE_TIME - 0.1) out.jump = true;
      return true;
    }
    if (this.fakeCooldown > 0 || this.plan.kind !== K.Strike || !car.onGround || this.threat || this.kickoff) return false;
    if (ball.pos.z > 160 || this.ex.dodge > 0) return false;
    const opp = this.nearestOpponent(car);
    if (!opp || !opp.onGround) return false;
    const dc = Math.hypot(ball.pos.x - car.pos.x, ball.pos.y - car.pos.y);
    const dopp = Math.hypot(ball.pos.x - opp.pos.x, ball.pos.y - opp.pos.y);
    const fwd = car.vel.x * car.basis.m[0] + car.vel.y * car.basis.m[3];
    // only when the opponent is clearly first to the ball, i.e. we would lose this 50/50 anyway
    if (dc < 420 || dc > 900 || dopp < 260 || dopp > 640 || dopp > dc - 150 || fwd < 900) return false;
    this.fakeT = FAKE_TIME;
    return this.runFake(car, out);
  }

  // ---------------------------------------------------------------- decisions
  /** Freeze the game state and queue up the candidate plays for this decision. */
  private startSearch(car: CarState, touched: boolean): void {
    const sim = this.sim;
    const ball = sim.ball;
    this.att = car.team === 0 ? 1 : -1;
    const att = this.att;
    const opp = this.nearestOpponent(car);
    predictBall(this.path, ball, HORIZON, 2);
    const p = this.path;
    this.threat = p.goalSide === -att && p.goalTime >= 0 && p.goalTime < 3.2;
    this.kickoff = Math.abs(ball.pos.x) < 5 && Math.abs(ball.pos.y) < 5 && Math.abs(ball.vel.y) < 5 && ball.pos.z < R + 5;
    copyCar(this.snapCar, car); copyBall(this.snapBall, ball); this.snapEx.copy(this.ex);
    this.snapTick = sim.tick;
    this.hasOpp = !!opp;
    if (opp) copyCar(this.snapOpp, opp);
    this.useOpp = opp ? this.buildOppPlan(opp) : false;
    // tip-off: head for the ball at once, flat out, while the decision is still being made
    if (this.kickoff && !this.hasPlan) {
      const k = this.plan;
      k.kind = K.Strike; k.cx = ball.pos.x; k.cy = ball.pos.y; k.cz = ball.pos.z; k.contactT = this.ex.now + 3;
      k.aimX = 0; k.aimY = att; k.aimPX = 0; k.aimPY = att * L; k.flip = false; k.boost = true; k.rush = true; k.fast = false;
    }

    // a full search now and then (and after any touch); in between just refine the play we are already on
    this.fullSearch = !this.hasPlan || this.plan.kind !== K.Strike || touched || this.tickCount - this.lastFull >= FULL_EVERY;
    if (this.fullSearch) { this.lastFull = this.tickCount; this.aimBias.clear(); }
    this.queue.length = 0; this.qi = 0;
    this.buildCandidates(car);
    this.stage = 1; this.bestScore = -1e9; this.found = false;
    this.bestAerial = -1e9; this.bestGround = -1e9;
    this.searching = true;
  }

  /**
   * A simple model of the opponent for contested plays: it chases the first ball position it can reach
   * and flips into it, sending the ball at our goal. Returns false when it is too far away to matter.
   */
  private buildOppPlan(opp: CarState): boolean {
    const p = this.path;
    const ballOpp = Math.hypot(this.snapBall.pos.x - opp.pos.x, this.snapBall.pos.y - opp.pos.y);
    if (!this.kickoff && (ballOpp > 3200 || !this.contesting(opp, this.snapBall.pos.x, this.snapBall.pos.y))) return false;
    if (this.kickoff) {
      // the opponent drives flat out at the ball and flips into it
      const o = this.oppPlan;
      const b = this.snapBall.pos;
      o.kind = K.Strike; o.cx = b.x; o.cy = b.y; o.cz = b.z; o.flip = false; o.boost = true; o.rush = true; o.fast = false;
      let ax = -b.x, ay = -this.att * L - b.y;
      const al = Math.hypot(ax, ay) || 1;
      o.aimX = ax / al; o.aimY = ay / al;
      o.contactT = this.snapEx.now + 10;
      const t = this.touchTime(opp, o, 5);
      o.contactT = this.snapEx.now + (t > 0 ? t : 3.0);
      o.flip = true; o.flipLead = 0.3;
      return true;
    }
    for (let i = 2; i < p.n; i++) {
      if (p.z[i] > 230) continue;
      const rt = this.reachTime(opp, p.x[i], p.y[i]);
      if (rt > p.t[i] + 0.1) continue;
      const o = this.oppPlan;
      o.kind = K.Strike; o.cx = p.x[i]; o.cy = p.y[i]; o.cz = p.z[i];
      o.contactT = this.snapEx.now + Math.max(p.t[i], rt);
      let ax = -o.cx, ay = -this.att * L - o.cy;
      const al = Math.hypot(ax, ay) || 1;
      ax /= al; ay /= al;
      o.aimX = ax; o.aimY = ay; o.flip = true; o.flipLead = 0.3; o.boost = true; o.fast = false;
      return true;
    }
    return false;
  }

  /**
   * The ball path with the opponent's hit in it. Near our goal the plain path (no cars) is wrong as soon as
   * the opponent touches the ball, and every save or tackle is aimed at a point on that path. So the modelled
   * opponent strike is simulated and the path is replaced by what the ball then does. Without a touch within
   * the horizon the path is the plain one again.
   */
  private predictOppHit(opp: CarState): void {
    const c = this.oc, b = this.rb, ex = this.oex, inp = this.oin;
    const path = this.path;
    const n = path.n, dt = path.stepDt;
    copyCar(c, opp); copyBall(b, this.snapBall);
    ex.copy(this.snapEx); ex.dodge = 0; ex.dodgeT = 0; ex.jumpHold = 0; ex.inAerial = false; ex.fastStage = 0;
    const att = this.att;
    let tick = this.snapTick;
    let touched = false;
    // sample i of the path is the state after 2 * i ticks; before the touch it is already the plain path
    for (let k = 0; k <= 2 * (n - 1); k++) {
      if (touched && k % 2 === 0) {
        const i = k / 2;
        path.x[i] = b.pos.x; path.y[i] = b.pos.y; path.z[i] = b.pos.z;
        path.vx[i] = b.vel.x; path.vy[i] = b.vel.y; path.vz[i] = b.vel.z;
      }
      if (!touched) {
        execute(c, b, this.oppPlan, ex, inp);
        stepCar(c, inp, DT);
      }
      stepBall(b, DT);
      if (!touched && collideCarBall(c, b, ++tick)) touched = true;
      ex.now += DT;
    }
    if (!touched) return;
    path.goalSide = 0; path.goalTime = -1;
    for (let i = 0; i < n; i++) {
      if (path.y[i] > L + R) { path.goalSide = 1; path.goalTime = i * dt; break; }
      if (path.y[i] < -L - R) { path.goalSide = -1; path.goalTime = i * dt; break; }
    }
    void att;
  }

  /** How long `src` takes to touch the ball (rest of the world frozen) while executing `plan`; -1 if it does not. */
  private touchTime(src: CarState, plan: Plan, maxT: number): number {
    const c = this.rc, b = this.rb, ex = this.rex, inp = this.rin;
    copyCar(c, src); copyBall(b, this.snapBall); ex.copy(this.snapEx);
    ex.dodge = 0; ex.dodgeT = 0; ex.jumpHold = 0; ex.inAerial = false; ex.fastStage = 0;
    const t0 = ex.now;
    let tick = this.snapTick;
    while (ex.now < t0 + maxT) {
      execute(c, b, plan, ex, inp);
      stepCar(c, inp, DT);
      stepBall(b, DT);
      if (collideCarBall(c, b, ++tick)) return ex.now - t0;
      ex.now += DT;
    }
    return -1;
  }

  /** Tip-off candidates: our true flat-out arrival time, then flip timings and aims around it. */
  private buildKickoff(car: CarState): void {
    const att = this.att;
    const b = this.snapBall.pos;
    const calib = this.cand;
    calib.kind = K.Strike; calib.cx = b.x; calib.cy = b.y; calib.cz = b.z; calib.flip = false; calib.boost = true;
    calib.rush = true; calib.fast = false; calib.aimX = 0; calib.aimY = att; calib.contactT = this.snapEx.now + 10;
    const t = this.touchTime(car, calib, 5);
    const ts = t > 0 ? t : 3.0;
    const gy = att * (L + 120), gx = GOAL_HALF - 230;
    // an earlier flip adds speed (a flip is +500 uu/s), so look well beyond the usual flip distance
    for (const lead of [0.3, 0.45, 0.6, 0.72, 0.84]) {
      for (const a of [[0, gy], [-gx, gy], [gx, gy]]) {
        this.queue.push({ t: ts, px: a[0], py: a[1], flip: true, lead, rush: true });
      }
    }
  }

  private buildCandidates(car: CarState): void {
    if (this.kickoff) { this.buildKickoff(car); return; }
    const p = this.path;
    const att = this.att;
    const now = this.ex.now;
    let i0 = -1;
    for (let i = 2; i < p.n; i++) {
      if (p.z[i] > 230) continue;
      if (this.reachTime(car, p.x[i], p.y[i]) <= p.t[i] + 0.15) { i0 = i; break; }
    }
    if (i0 < 0) return;
    const t0 = p.t[i0];

    // where to send the ball: the two corners and the middle of their goal, plus a clear up the near side
    const gy = att * (L + 120), gx = GOAL_HALF - 230;
    const sx = p.x[i0] >= 0 ? 1 : -1;
    const aims: number[][] = [[-gx, gy], [gx, gy], [0, gy], [sx * W * 0.85, att * L * 0.45]];
    if (this.threat) aims.push([-sx * W * 0.85, att * L * 0.45]);
    // bank shot: aim at the mirror image of the goal across the nearer side wall (trick shot off the wall)
    const bx = p.x[i0];
    if (!this.threat && Math.abs(bx) > W * 0.4 && p.y[i0] * att > -1500) {
      const wallX = (W - R) * (bx >= 0 ? 1 : -1);
      aims.push([2 * wallX - 0, gy]);
    }

    const cur = this.plan;
    const tc = cur.contactT - now;
    const refine = !this.fullSearch && cur.kind === K.Strike && tc >= 0.12 && tc <= HORIZON - 0.3;
    const times = refine ? [tc] : [t0, t0 + 0.25, t0 + 0.6, t0 + 1.2, t0 + 2.0];
    for (const t of times) {
      if (t > HORIZON - 0.3 || t < 0.06) continue;
      this.pathAt(t);
      if (this.tmp.z > 230) continue;
      const cx = this.tmp.x, cy = this.tmp.y;
      if (Math.abs(cx) > W - 120 || Math.abs(cy) > L + 200) continue;
      // skip approaches that would need the car to loop round the ball (unless we are defending)
      const dx = cx - car.pos.x, dy = cy - car.pos.y;
      const dl = Math.hypot(dx, dy) || 1;
      let any = false;
      const start = this.queue.length;
      for (const a of aims) {
        const ax = a[0] - cx, ay = a[1] - cy;
        const al = Math.hypot(ax, ay) || 1;
        const align = (dx * ax + dy * ay) / (dl * al);
        if (align < -0.35 && !this.threat && !this.kickoff) continue;
        this.queue.push({ t, px: a[0], py: a[1], flip: true, lead: 0.3, rush: this.threat });
        any = true;
      }
      if (!any) for (const a of aims) this.queue.push({ t, px: a[0], py: a[1], flip: true, lead: 0.3, rush: this.threat });
      void start;
    }
    if (refine) {
      for (const dt of [-0.15, 0.15]) this.queue.push({ t: tc + dt, px: cur.aimPX, py: cur.aimPY, flip: true, lead: 0.3, rush: this.threat });
    }

    // aerials: for a ball that will be up in the air, try a few take-off times against the main aim points
    if ((this.fullSearch || cur.kind === K.Aerial) && car.boost >= 12) {
      // keep the take-off we are already committed to (otherwise a rolling horizon pushes the jump back forever)
      if (cur.kind === K.Aerial) {
        const tc2 = cur.contactT - now;
        const jt = cur.jumpAt - now;
        if (tc2 > 0.25 && tc2 < HORIZON - 0.3) {
          for (const dt of [0, -0.1, 0.1]) {
            const t2 = tc2 + dt;
            this.pathAt(t2);
            if (this.tmp.z < 240 || this.tmp.z > 1700) continue;
            this.queue.push({ t: t2, px: cur.aimPX, py: cur.aimPY, flip: cur.flip, lead: 0.3, tau: Math.max(0.25, t2 - Math.max(0, jt)), fast: cur.fast });
          }
        }
      }
      const taus = [0.9, 1.25, 1.6];
      let taken = 0;
      for (let t = 0.9; t <= 3.4 && taken < 3; t += 0.3) {
        this.pathAt(t);
        const z = this.tmp.z;
        if (z < 240 || z > 1700) continue;
        const cx = this.tmp.x, cy = this.tmp.y;
        // near our own goal (a backboard save) the ball may be right up against the wall
        if (Math.abs(cx) > W - 200 || Math.abs(cy) > (this.threat ? L - 20 : L - 150)) continue;
        if (Math.hypot(cx - car.pos.x, cy - car.pos.y) / 2000 > t - 0.2) continue;
        taken++;
        for (const tau of taus) {
          if (t - tau < 0.15) continue;
          for (let ai = 0; ai < 3; ai++) this.queue.push({ t, px: aims[ai][0], py: aims[ai][1], flip: true, lead: 0.3, tau });
          if (this.threat) this.queue.push({ t, px: aims[3][0], py: aims[3][1], flip: true, lead: 0.3, tau });
        }
      }
    }
  }

  /** Try up to `n` queued candidates; when the queue empties, move to the next stage or decide. */
  private stepSearch(car: CarState, n: number): void {
    const att = this.att;
    const c = this.cand;
    const now = this.snapEx.now;
    for (let k = 0; k < n; k++) {
      if (this.qi >= this.queue.length) {
        if (this.stage === 1 && this.found) {
          // refine the winner: other flip timings, no flip
          const base = this.best;
          this.queue.length = 0; this.qi = 0;
          const bt = base.contactT - now;
          if (base.kind === K.Aerial) {
            const tau = base.contactT - base.jumpAt;
            for (const [dtau, flip] of [[-0.15, true], [0.15, true], [0, false]] as [number, boolean][]) {
              this.queue.push({ t: bt, px: base.aimPX, py: base.aimPY, flip, lead: 0.3, tau: tau + dtau });
            }
            // fast aerial: second jump spent on height, no flip at the end
            this.queue.push({ t: bt, px: base.aimPX, py: base.aimPY, flip: false, lead: 0.3, tau: tau - 0.2, fast: true });
            this.queue.push({ t: bt, px: base.aimPX, py: base.aimPY, flip: false, lead: 0.3, tau, fast: true });
          } else {
            for (const [flip, lead] of [[true, 0.24], [true, 0.36], [false, 0.3]] as [boolean, number][]) {
              this.queue.push({ t: bt, px: base.aimPX, py: base.aimPY, flip, lead, rush: base.rush });
            }
          }
          this.stage = 2;
          continue;
        }
        this.finishSearch(car);
        return;
      }
      const cd = this.queue[this.qi++];
      const tau = cd.tau ?? 0;
      this.pathAt(cd.t);
      if (tau === 0 && this.tmp.z > 230) continue;
      const cx = this.tmp.x, cy = this.tmp.y, cz = this.tmp.z;
      let ax = cd.px - cx, ay = cd.py - cy;
      const al = Math.hypot(ax, ay) || 1;
      ax /= al; ay /= al;
      c.kind = tau > 0 ? K.Aerial : K.Strike; c.cx = cx; c.cy = cy; c.cz = cz; c.contactT = now + cd.t;
      c.jumpAt = tau > 0 ? now + cd.t - tau : 0;
      c.aimX = ax; c.aimY = ay; c.aimPX = cd.px; c.aimPY = cd.py;
      c.flip = cd.flip; c.flipLead = cd.lead; c.boost = true; c.fast = !!cd.fast; c.rush = !!cd.rush;
      let s = this.rollout(c);
      if (this.stage === 1 && s > -9000 && !this.threat && !this.kickoff) s += this.biasFor(cd.px, cd.py);
      if (tau > 0) { this.stats.aerialTried++; if (s > -9000) { this.stats.aerialTouched++; s += AERIAL_BONUS; } }
      if (this.stage === 1 && s > -9000) { if (tau > 0) { if (s > this.bestAerial) this.bestAerial = s; } else if (s > this.bestGround) this.bestGround = s; }
      const cur = this.plan;
      // stick with the play we are already on unless something is clearly better
      if (this.stage === 1 && !this.fullSearch && cur.kind === K.Strike && tau === 0 && Math.abs(cd.t - (cur.contactT - now)) < 0.01 && cd.px === cur.aimPX && cd.py === cur.aimPY) s += 25;
      if (this.stage === 1 && cur.kind === K.Aerial && tau > 0 && Math.abs(cd.t - (cur.contactT - now)) < 0.12 && cd.px === cur.aimPX && cd.py === cur.aimPY) s += 120;
      if (s > this.bestScore) { this.bestScore = s; this.best.copy(c); this.best.score = s; this.found = true; }
    }
    void att;
  }

  private finishSearch(car: CarState): void {
    this.searching = false;
    const dodging = this.ex.dodge > 0 || this.ex.jumpHold > 0;
    if (dodging) return; // a dodge started while we were thinking: let it finish
    const att = this.att;
    let chosen: Plan | null = null;
    const st = this.stats;
    st.searches++;
    if (this.queue.length === 0 && !this.found) st.noReach++;
    else if (!this.found) st.noTouch++;
    else if (!(this.threat || this.kickoff || this.best.score > STRIKE_MIN)) st.lowScore++;
    if (this.found && (this.threat || this.kickoff || this.best.score > STRIKE_MIN)) { chosen = this.best; st.strikes++; if (chosen.kind === K.Aerial) st.aerials++; }
    const ownEndEarly = this.holdGoal(car);
    // a long run-up to the ball with low boost: take a pad on the way if it costs almost nothing
    if (chosen && car.boost < PAD_BOOST && !this.threat && !ownEndEarly && chosen.contactT - this.ex.now > PAD_SLACK) {
      const detour = this.detourPad(car, chosen);
      if (detour) { chosen = detour; st.pads++; }
    }
    // out of position: we are past the ball (toward their goal) and they are nearer to it, so rotate back instead of chasing
    if (chosen && !this.threat && !this.kickoff) {
      const opp = this.nearestOpponent(car);
      const ball = this.sim.ball;
      if (opp && this.contesting(opp, ball.pos.x, ball.pos.y)) {
        const dc = Math.hypot(ball.pos.x - car.pos.x, ball.pos.y - car.pos.y);
        const dopp = Math.hypot(ball.pos.x - opp.pos.x, ball.pos.y - opp.pos.y);
        const ahead = car.pos.y * att - ball.pos.y * att;
        const oppToward = (opp.vel.x * (ball.pos.x - opp.pos.x) + opp.vel.y * (ball.pos.y - opp.pos.y)) / (dopp || 1);
        // only when they are really coming at it fast and close, and we are well past the ball (a looser rule made the boss retreat from open balls)
        if (ahead > 1200 && dopp < 1500 && dopp < dc - 600 && oppToward > 700 && ball.pos.y * att < 1500 && chosen.contactT - this.ex.now > 0.5) chosen = null;
        // the ball is in our half and we are past it while they are about as near as we are: get goal-side before they shoot, do not chase
        if (chosen && ball.pos.y * att < -300 && ahead > 800 && dopp < dc + 300 && chosen.contactT - this.ex.now > 0.4) chosen = null;
      }
    }
    // a dangerous ball we cannot reach: still get to where it will cross the line
    if (!chosen && this.threat) chosen = this.guardPlan(att);
    // nothing to strike: do not wait or go shopping while the ball is on our side, close in on where it is going to be
    if (!chosen && !this.threat && !this.kickoff && (car.boost >= 15 || Math.hypot(this.sim.ball.pos.x - car.pos.x, this.sim.ball.pos.y - car.pos.y) < 2500)) {
      const press = this.pressPlan(car, att);
      if (press) { chosen = press; st.shadows++; }
    }
    // no shopping while the ball is in our end: be a goalkeeper instead
    const ownEnd = this.holdGoal(car);
    if (!chosen) {
      const pad = car.boost < 80 && !ownEnd ? this.padPlan(car, att) : null;
      if (pad) { chosen = pad; st.pads++; }
    }
    if (!chosen) { chosen = this.shadowPlan(att, car); st.shadows++; }
    this.plan.copy(chosen);
    this.hasPlan = true;
    this.ex.inAerial = chosen.kind === K.Aerial ? this.ex.inAerial : false;
    this.debug.mode = chosen.kind; this.debug.tx = chosen.tx || chosen.cx; this.debug.ty = chosen.ty || chosen.cy; this.debug.tz = chosen.cz;
  }

  private refreshAerial(): void {
    const sim = this.sim;
    predictBall(this.path, sim.ball, HORIZON, 2);
    const pl = this.plan;
    const t = pl.contactT - this.ex.now;
    if (t < 0.05 || t > HORIZON - 0.1) return;
    this.pathAt(t);
    pl.cx = this.tmp.x; pl.cy = this.tmp.y; pl.cz = this.tmp.z;
  }

  /** The same random bias for every candidate that aims at the same point, so only the choice of aim is shuffled, never the timing. */
  private biasFor(px: number, py: number): number {
    const key = Math.round(px / 50) * 10007 + Math.round(py / 50);
    let v = this.aimBias.get(key);
    if (v === undefined) { v = (this.rng.next() - 0.5) * 2 * NOISE; this.aimBias.set(key, v); }
    return v;
  }

  /**
   * Is the opponent really going for the ball? Only if it is on it, or moving toward it at some speed. A car that is
   * idle, drifting or heading elsewhere is not a threat to the ball, and defending against it makes the boss passive.
   */
  private contesting(opp: CarState, bx: number, by: number): boolean {
    const dx = bx - opp.pos.x, dy = by - opp.pos.y;
    const d = Math.hypot(dx, dy);
    return d < 1200 || (opp.vel.x * dx + opp.vel.y * dy) / d > 150;
  }

  /** Ball close to our goal and the opponent at least as near to it as we are: stay and defend, do not shop for boost. */
  private holdGoal(car: CarState): boolean {
    const ball = this.sim.ball;
    if (ball.pos.y * this.att > -L + 3000) return false;
    const opp = this.nearestOpponent(car);
    if (!opp || !this.contesting(opp, ball.pos.x, ball.pos.y)) return false;
    const dc = Math.hypot(ball.pos.x - car.pos.x, ball.pos.y - car.pos.y);
    const dopp = Math.hypot(ball.pos.x - opp.pos.x, ball.pos.y - opp.pos.y);
    return dopp < dc + 400;
  }

  private nearestOpponent(car: CarState): CarState | null {
    let best: CarState | null = null, bd = Infinity;
    for (const c of this.sim.cars) {
      if (c.team === car.team || c.demolished) continue;
      const d = Math.hypot(c.pos.x - car.pos.x, c.pos.y - car.pos.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /** Ball position at `t` seconds from the snapshot (linear between samples) into this.tmp. */
  private pathAt(t: number): void {
    const p = this.path;
    const f = clamp(t / p.stepDt, 0, p.n - 1.001);
    const i = Math.floor(f), a = f - i;
    this.tmp.x = p.x[i] + (p.x[i + 1] - p.x[i]) * a;
    this.tmp.y = p.y[i] + (p.y[i + 1] - p.y[i]) * a;
    this.tmp.z = p.z[i] + (p.z[i + 1] - p.z[i]) * a;
  }

  /** Optimistic time for `car` to reach a ground point. */
  private reachTime(car: CarState, px: number, py: number): number {
    const m = car.basis.m;
    const dx = px - car.pos.x, dy = py - car.pos.y;
    const flat = Math.hypot(dx, dy);
    const ang = Math.abs(Math.atan2(dx * m[1] + dy * m[4], dx * m[0] + dy * m[3]));
    return flat / (car.boost > 25 ? 1950 : 1550) + ang / 3.4;
  }

  /**
   * Simulate `plan` with the executor on copies of the snapshot car and ball until the touch, then roll
   * the ball on and score the result. Returns a very low score when the plan never touches the ball.
   */
  private rollout(plan: Plan): number {
    const c = this.rc, b = this.rb, ex = this.rex, inp = this.rin;
    const useOpp = this.useOpp;
    const oc = this.oc, oex = this.oex, oin = this.oin;
    copyCar(c, this.snapCar); copyBall(b, this.snapBall); ex.copy(this.snapEx);
    if (useOpp) {
      copyCar(oc, this.snapOpp);
      oex.copy(this.snapEx); oex.dodge = 0; oex.dodgeT = 0; oex.jumpHold = 0; oex.inAerial = false; oex.fastStage = 0;
    }
    const t0 = ex.now;
    const tEnd = plan.contactT + 0.6;
    let tick = this.snapTick;
    let touched = false, tTouch = 0, oppTouched = false, tOpp = 0, post = 0;
    while (ex.now < tEnd) {
      execute(c, b, plan, ex, inp);
      stepCar(c, inp, DT);
      if (useOpp) { oex.now = ex.now; execute(oc, b, this.oppPlan, oex, oin); stepCar(oc, oin, DT); }
      stepBall(b, DT);
      tick++;
      if (collideCarBall(c, b, tick) && !touched) { touched = true; tTouch = ex.now - t0; }
      if (useOpp) {
        if (collideCarBall(oc, b, tick) && !oppTouched) { oppTouched = true; tOpp = ex.now - t0; }
        if (collideCarCar(c, oc) === CarCarResult.BDemoedA) return -1500; // we would be demolished
      }
      // once anyone has touched it, give the clash a few more ticks to play out
      if ((touched || oppTouched) && ++post > (useOpp ? 12 : 5)) break;
      ex.now += DT;
    }
    if (!touched) {
      if (!oppTouched) return -9999;
      return this.evaluate(b, tOpp, plan) - 350; // they got to it and we did not touch it
    }
    return this.evaluate(b, tTouch, plan);
  }

  private evaluate(b: BallState, tTouch: number, plan: Plan): number {
    const att = this.att;
    // when the opponent was simulated alongside us, use where it ended up; otherwise where it was
    const opp = this.useOpp ? this.oc : this.hasOpp ? this.snapOpp : null;
    const eb = this.eb;
    copyBall(eb, b);
    let goalFor = false, goalAgainst = false, tGoal = 0, n = 0;
    for (let i = 0; i < MAX_OUT; i++) {
      stepBall(eb, DT); stepBall(eb, DT); stepBall(eb, DT); stepBall(eb, DT); // 1/30 s per sample
      this.ox[i] = eb.pos.x; this.oy[i] = eb.pos.y; this.oz[i] = eb.pos.z; n = i + 1;
      const y = eb.pos.y * att;
      if (y > L + R) { goalFor = true; tGoal = (i + 1) / 30; break; }
      if (y < -(L + R)) { goalAgainst = true; tGoal = (i + 1) / 30; break; }
    }
    const tt = tTouch;
    // can the opponent get to the ball before it crosses the line?
    let saveable = false;
    if (opp && goalFor) {
      const spd = Math.max(1500, Math.hypot(opp.vel.x, opp.vel.y));
      for (let i = 0; i < n; i++) {
        const z = this.oz[i];
        if (z > 520) continue;
        const d = Math.hypot(this.ox[i] - opp.pos.x, this.oy[i] - opp.pos.y);
        const need = d / spd + (z > 230 ? 0.6 : 0);
        if (need < tt + (i + 1) / 30 - 0.05) { saveable = true; break; }
      }
    }
    let v: number;
    if (goalFor) v = 1000 - (saveable ? 650 : 0) - 40 * (tt + tGoal);
    else if (goalAgainst) v = -1500;
    else {
      const fy = eb.pos.y * att;
      v = 0.1 * fy + 0.04 * eb.vel.y * att;
      if (fy < -2500) v -= (-2500 - fy) * 0.2;
      // do not leave the ball where the opponent is about to get it
      if (opp) {
        const d = Math.hypot(eb.pos.x - opp.pos.x, eb.pos.y - opp.pos.y);
        v += Math.min(d, 3000) * 0.03;
      }
    }
    v -= TIME_COST * tt;
    // the opponent would get there first
    if (opp && !this.useOpp && !this.kickoff && !this.threat) {
      const od = Math.hypot(plan.cx - opp.pos.x, plan.cy - opp.pos.y);
      const oReach = od / Math.max(1500, Math.hypot(opp.vel.x, opp.vel.y)) + (plan.cz > 230 ? 0.6 : 0);
      if (oReach < tt - 0.15) v -= 250;
    }
    return v;
  }

  private padPlan(car: CarState, att: number): Plan | null {
    const pads = this.sim.pads;
    // when the ball is on our side (or coming), do not run off to pads that lie beyond us toward their goal
    const ball = this.sim.ball;
    const danger = this.threat || ball.pos.y * att < 800;
    let best = -1, bv = 4;
    for (let i = 0; i < pads.length; i++) {
      const pd = pads[i];
      const spec = pd.large ? PADS.large : PADS.small;
      const t = this.reachTime(car, pd.x, pd.y);
      if (!pd.active && pd.timer > t) continue;
      if (t > 3.2) continue;
      let v = Math.min(spec.amount, 100 - car.boost) / (1 + 0.9 * t);
      if (pd.y * att > 3000) v *= 0.6; // deep in their half: leave it
      if (danger && pd.y * att > car.pos.y * att + 500) v *= 0.2; // that is away from our goal
      if (danger && pd.y * att > ball.pos.y * att + 300) v *= 0.3; // and ahead of the ball
      if (v > bv) { bv = v; best = i; }
    }
    if (best < 0) return null;
    const pl = new Plan();
    pl.kind = K.Pad; pl.tx = pads[best].x; pl.ty = pads[best].y; pl.speed = 2100; pl.boost = car.boost > 25;
    return pl;
  }

  /** A pad close to the line between us and the planned touch; null unless it fits inside the time we have. */
  private detourPad(car: CarState, strike: Plan): Plan | null {
    const pads = this.sim.pads;
    const slack = strike.contactT - this.ex.now;
    let best = -1, bv = 6;
    for (let i = 0; i < pads.length; i++) {
      const pd = pads[i];
      const spec = pd.large ? PADS.large : PADS.small;
      const tp = this.reachTime(car, pd.x, pd.y);
      if (!pd.active && pd.timer > tp) continue;
      const tc = Math.hypot(strike.cx - pd.x, strike.cy - pd.y) / 1900 + 0.35;
      if (tp + tc > slack - 0.4) continue;
      const v = Math.min(spec.amount, 100 - car.boost) / (1 + 0.9 * tp);
      if (v > bv) { bv = v; best = i; }
    }
    if (best < 0) return null;
    const pl = new Plan();
    pl.kind = K.Pad; pl.tx = pads[best].x; pl.ty = pads[best].y; pl.speed = 2200; pl.boost = car.boost > 25;
    return pl;
  }

  /** Last-ditch defence: be where the ball will cross our goal line, as fast as possible. */
  private guardPlan(att: number): Plan {
    const p = this.path;
    const gi = Math.min(p.n - 1, Math.max(1, Math.round(p.goalTime / p.stepDt)));
    const ti = Math.max(1, gi - Math.round(0.25 / p.stepDt));
    const pl = new Plan();
    pl.kind = K.Shadow;
    pl.tx = clamp(p.x[ti], -(GOAL_HALF + 150), GOAL_HALF + 150);
    pl.ty = -att * (L - 450);
    pl.speed = 2300; pl.boost = true;
    return pl;
  }

  /**
   * Close in on the ball while it is on our side of the pitch: aim for where it will be in about 0.7 s, a little goal-side of it,
   * so that we are on it the moment it is lost, popped up or passed. Null when the ball is up the field (then the usual shadow/pad play).
   */
  private pressPlan(car: CarState, att: number): Plan | null {
    const p = this.path;
    const i = Math.min(p.n - 1, Math.round(0.7 / p.stepDt));
    const bx = p.x[i], by = p.y[i];
    if (by * att > 800 || p.z[i] > 1500) return null;
    // only against a ball being carried or held: the opponent is on it and it is not flying (a fast rally is for the strike logic)
    const opp = this.nearestOpponent(car);
    const ball = this.sim.ball;
    if (!opp || Math.hypot(ball.pos.x - opp.pos.x, ball.pos.y - opp.pos.y) > 700 || Math.hypot(ball.vel.x, ball.vel.y) > 1300) return null;
    const gx = 0, gy = -att * (L - 300);
    const dgx = gx - bx, dgy = gy - by;
    const dg = Math.hypot(dgx, dgy) || 1;
    const dist = Math.hypot(bx - car.pos.x, by - car.pos.y);
    const gap = clamp(0.3 * dist, 650, 1200);
    const pl = new Plan();
    pl.kind = K.Shadow;
    pl.tx = clamp(bx + (dgx / dg) * gap, -(W - 300), W - 300);
    pl.ty = clamp(by + (dgy / dg) * gap, -(L - 400), L - 400);
    pl.speed = dist > 1800 ? 2200 : 1500;
    pl.boost = dist > 2600 && car.boost > 25;
    return pl;
  }

  /** Hold a position between the ball and our goal, getting there fast when we are out of place. */
  private shadowPlan(att: number, car: CarState): Plan {
    const p = this.path;
    const i = Math.min(p.n - 1, Math.round(0.6 / p.stepDt));
    const bx = p.x[i], by = p.y[i];
    const gy = -att * (L - 300);
    const ballOurSide = by * att < 0;
    const f = ballOurSide ? 0.5 : 0.35;
    let ty = gy + (by - gy) * f;
    const lim = L - 400;
    ty = clamp(ty, -lim, lim);
    const tx = clamp(bx * f, -1800, 1800);
    const pl = new Plan();
    const far = Math.hypot(tx - car.pos.x, ty - car.pos.y) > 1800;
    pl.kind = K.Shadow; pl.tx = tx; pl.ty = ty; pl.speed = far ? 2200 : 1700; pl.boost = far && car.boost > 30;
    return pl;
  }
}

/** Matches the pieces of `Bot` that the game uses. */
export type BotAgent = Pick<BossBot, 'think' | 'predictedPath' | 'target' | 'debug'>;
