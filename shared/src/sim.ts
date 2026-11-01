import * as arena from './arena';
import { BallState, copyBall, resetBall, stepBall } from './ball';
import { CarCarResult, collideCarBall, collideCarCar } from './collide';
import { ARENA, BALL, CAR, MATCH, PADS, PHYSICS, SPAWN, mirrorPads } from './constants';
import { CarInput, CarState, copyCar, placeCar, stepCar } from './car';
import { Prng } from './prng';

export const Phase = { Countdown: 0, Playing: 1, Goal: 2, Ended: 3 } as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

export type SimEventType =
  | 'kickoff' | 'countdown' | 'goal' | 'demo' | 'respawn' | 'pad' | 'ballHit' | 'overtime' | 'end';

export interface SimEvent {
  type: SimEventType;
  /** goal: scoring team; demo: attacker car; pad: car; ballHit: car; countdown: number shown */
  a: number;
  /** demo: victim car; pad: pad index; goal: scorer car (or -1) */
  b: number;
  /** ballHit: impact speed; end: winner team (-1 tie); pad: amount */
  v: number;
}

export interface PlayerSpec {
  team: 0 | 1;
  name: string;
}

export interface SimConfig {
  players: PlayerSpec[];
  matchLength: number;
  /** Shorten the goal pause (headless simulations, tests). */
  skipReplay: boolean;
  seed: number;
}

export class PadState {
  active = true;
  timer = 0;
  constructor(public x: number, public y: number, public large: boolean) {}
}

export interface PlayerStats {
  goals: number;
  saves: number;
  shots: number;
  demos: number;
  score: number;
}

export function makePads(): PadState[] {
  const pads: PadState[] = [];
  for (const p of mirrorPads(PADS.largeBase)) pads.push(new PadState(p.x, p.y, true));
  for (const p of mirrorPads(PADS.smallBase)) pads.push(new PadState(p.x, p.y, false));
  return pads;
}

export function defaultConfig(players: PlayerSpec[], seed = 1): SimConfig {
  return { players, matchLength: MATCH.length, skipReplay: false, seed };
}

export class GameSim {
  readonly config: SimConfig;
  tick = 0;
  ball = new BallState();
  cars: CarState[] = [];
  inputs: CarInput[] = [];
  pads: PadState[] = makePads();
  stats: PlayerStats[] = [];
  score = [0, 0];
  phase: Phase = Phase.Countdown;
  phaseTimer: number = SPAWN.countdown;
  /** Seconds remaining (regulation) or elapsed (overtime). */
  clock: number;
  overtime = false;
  /** Regulation expired while the ball was airborne: play on until it lands or a goal is scored. */
  expiring = false;
  winner = -1;
  lastGoalTeam = -1;
  lastGoalPlayer = -1;
  lastTouchCar = -1;
  events: SimEvent[] = [];
  private rng: Prng;
  private kickoffVariant = 0;
  private lastCountdownShown = -1;
  private ballVyBefore = 0;

  constructor(config: SimConfig) {
    this.config = config;
    this.clock = config.matchLength;
    this.rng = new Prng(config.seed);
    config.players.forEach((p, i) => {
      const c = new CarState();
      c.id = i;
      c.team = p.team;
      this.cars.push(c);
      this.inputs.push(new CarInput());
      this.stats.push({ goals: 0, saves: 0, shots: 0, demos: 0, score: 0 });
    });
    this.resetKickoff();
  }

  /** Spawn spot (position + yaw) for car i at the current kickoff. */
  spawnFor(i: number): { x: number; y: number; yaw: number } {
    const car = this.cars[i];
    let slot = 0;
    let teamSize = 0;
    for (let j = 0; j < this.cars.length; j++) {
      if (this.cars[j].team === car.team) {
        if (j < i) slot++;
        teamSize++;
      }
    }
    const spots = SPAWN.kickoff;
    const spot = teamSize === 1 ? spots[this.kickoffVariant & 1] : spots[slot % spots.length];
    if (car.team === 0) return { x: spot.x, y: spot.y, yaw: spot.yaw };
    return { x: -spot.x, y: -spot.y, yaw: spot.yaw + Math.PI };
  }

  /** Where a demolished car comes back: the team's back corner spots, not the kickoff position. */
  respawnFor(i: number): { x: number; y: number; yaw: number } {
    const car = this.cars[i];
    const spots = CAR.demo.respawnSpots;
    const n = (this.tick + i) % spots.length;
    const [x, y] = spots[n];
    if (car.team === 0) return { x, y, yaw: Math.PI / 2 };
    return { x: -x, y: -y, yaw: -Math.PI / 2 };
  }

  resetKickoff(): void {
    resetBall(this.ball);
    this.kickoffVariant = this.rng.int(2);
    for (let i = 0; i < this.cars.length; i++) {
      const s = this.spawnFor(i);
      placeCar(this.cars[i], s.x, s.y, s.yaw);
      this.inputs[i].clear();
    }
    for (const p of this.pads) { p.active = true; p.timer = 0; }
    this.phase = Phase.Countdown;
    this.phaseTimer = SPAWN.countdown;
    this.lastCountdownShown = -1;
    this.lastTouchCar = -1;
  }

  private emit(type: SimEventType, a = 0, b = 0, v = 0): void {
    this.events.push({ type, a, b, v });
  }

  drainEvents(out: SimEvent[]): void {
    for (const e of this.events) out.push(e);
    this.events.length = 0;
  }

  /** Time shown on the scoreboard. */
  get displayTime(): number {
    return this.clock;
  }

  step(): void {
    const dt = PHYSICS.dt;
    this.tick++;
    const live = this.phase === Phase.Playing;

    // ---- phase timers ----
    if (this.phase === Phase.Countdown) {
      const shown = Math.ceil(this.phaseTimer);
      if (shown !== this.lastCountdownShown) { this.lastCountdownShown = shown; this.emit('countdown', shown); }
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.phase = Phase.Playing;
        this.emit('kickoff');
      }
    } else if (this.phase === Phase.Goal) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        if (this.overtime || this.expiring) this.finish();
        else this.resetKickoff();
      }
    }

    const controllable = this.phase === Phase.Playing;

    // ---- cars ----
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (c.demolished) {
        c.respawnTimer -= dt;
        if (c.respawnTimer <= 0 && this.phase !== Phase.Ended) {
          const s = this.respawnFor(i);
          placeCar(c, s.x, s.y, s.yaw);
          this.emit('respawn', i);
        }
        continue;
      }
      if (this.phase === Phase.Ended) continue;
      stepCar(c, controllable ? this.inputs[i] : EMPTY_INPUT, dt);
    }

    // ---- ball ----
    this.ballVyBefore = this.ball.vel.y;
    stepBall(this.ball, dt);

    // ---- collisions ----
    if (this.phase !== Phase.Ended) {
      for (let i = 0; i < this.cars.length; i++) {
        const c = this.cars[i];
        const prevTouch = c.lastTouchTick;
        const bvx = this.ball.vel.x, bvy = this.ball.vel.y, bvz = this.ball.vel.z;
        if (collideCarBall(c, this.ball, this.tick)) {
          if (this.tick - prevTouch > 12 || prevTouch < 0) {
            const dvx = this.ball.vel.x - bvx, dvy = this.ball.vel.y - bvy, dvz = this.ball.vel.z - bvz;
            const sp = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
            this.emit('ballHit', i, 0, sp);
            this.recordTouch(i, bvy);
          }
          this.lastTouchCar = i;
        }
      }
      for (let i = 0; i < this.cars.length; i++) {
        for (let j = i + 1; j < this.cars.length; j++) {
          const r = collideCarCar(this.cars[i], this.cars[j]);
          if (r === CarCarResult.ADemoedB) this.onDemo(i, j);
          else if (r === CarCarResult.BDemoedA) this.onDemo(j, i);
        }
      }
    }

    // ---- boost pads ----
    for (let k = 0; k < this.pads.length; k++) {
      const p = this.pads[k];
      if (!p.active) {
        p.timer -= dt;
        if (p.timer <= 0) p.active = true;
        continue;
      }
      const spec = p.large ? PADS.large : PADS.small;
      for (let i = 0; i < this.cars.length; i++) {
        const c = this.cars[i];
        if (c.demolished || c.boost >= CAR.boost.max) continue;
        const dx = c.pos.x - p.x, dy = c.pos.y - p.y;
        if (dx * dx + dy * dy < spec.radius * spec.radius && c.pos.z < spec.height) {
          c.boost = Math.min(CAR.boost.max, c.boost + spec.amount);
          p.active = false;
          p.timer = spec.respawn;
          this.emit('pad', i, k, spec.amount);
          break;
        }
      }
    }

    // ---- goal / clock ----
    if (live) this.updateMatch(dt);
  }

  private recordTouch(i: number, vyBefore: number): void {
    const c = this.cars[i];
    const st = this.stats[i];
    const dir = c.team === 0 ? 1 : -1; // direction of the opponent goal along Y
    const vyAfter = this.ball.vel.y;
    if (vyAfter * dir > 1500 && vyBefore * dir < vyAfter * dir - 600) st.shots++;
    // a save: ball was heading into own goal fast and now isn't
    const ownGoalDir = -dir;
    if (vyBefore * ownGoalDir > 1200 && vyAfter * ownGoalDir < 300 && this.ball.pos.y * ownGoalDir > 2500) st.saves++;
    this.updateScore(i);
  }

  private updateScore(i: number): void {
    const s = this.stats[i];
    s.score = s.goals * 100 + s.saves * 50 + s.shots * 20 + s.demos * 25;
  }

  private onDemo(attacker: number, victim: number): void {
    this.stats[attacker].demos++;
    this.updateScore(attacker);
    this.emit('demo', attacker, victim);
  }

  private updateMatch(dt: number): void {
    const gs = arena.goalSide(this.ball.pos.y, BALL.radius);
    if (gs !== 0) {
      const team = gs > 0 ? 0 : 1; // ball in the Orange goal means Blue scored
      this.onGoal(team);
      return;
    }
    if (this.overtime) {
      this.clock += dt;
      return;
    }
    if (this.expiring) {
      if (this.ball.pos.z < BALL.radius + 4 && this.ball.hitSurface) this.expire();
      return;
    }
    this.clock -= dt;
    if (this.clock <= 0) {
      this.clock = 0;
      if (this.ball.pos.z > BALL.radius + 40) this.expiring = true;
      else this.expire();
    }
  }

  /** Clock hit zero and the ball is on the ground. */
  private expire(): void {
    this.expiring = false;
    if (this.score[0] === this.score[1]) {
      this.overtime = true;
      this.clock = 0;
      this.emit('overtime');
    } else {
      this.finish();
    }
  }

  private onGoal(team: number): void {
    this.score[team]++;
    this.lastGoalTeam = team;
    // scorer: last toucher if on the scoring team, else first teammate
    let scorer = -1;
    if (this.lastTouchCar >= 0 && this.cars[this.lastTouchCar].team === team) scorer = this.lastTouchCar;
    if (scorer >= 0) { this.stats[scorer].goals++; this.updateScore(scorer); }
    this.lastGoalPlayer = scorer;
    this.phase = Phase.Goal;
    this.phaseTimer = this.config.skipReplay ? 1.5 : MATCH.goalCelebration + MATCH.replaySeconds;
    this.blastCars(team);
    this.emit('goal', team, scorer);
  }

  /** The goal explodes: every car is thrown away from the goal that was scored in, tumbling. */
  private blastCars(team: number): void {
    const gy = team === 0 ? ARENA.halfLength : -ARENA.halfLength;
    for (const c of this.cars) {
      if (c.demolished) continue;
      let dx = c.pos.x, dy = c.pos.y - gy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1) { dx = 0; dy = -Math.sign(gy); } else { dx /= d; dy /= d; }
      const k = MATCH.goalBlast * Math.max(0.35, 1 - d / 5500);
      c.vel.x += dx * k; c.vel.y += dy * k; c.vel.z += MATCH.goalBlastLift;
      c.angVel.x += (this.rng.next() - 0.5) * 8; c.angVel.y += (this.rng.next() - 0.5) * 8; c.angVel.z += (this.rng.next() - 0.5) * 6;
      c.onGround = false;
    }
  }

  private finish(): void {
    this.phase = Phase.Ended;
    this.winner = this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1;
    this.emit('end', 0, 0, this.winner);
  }

  /** Copies the complete dynamic state (not inputs) from another sim of the same configuration. */
  copyFrom(o: GameSim): void {
    this.tick = o.tick;
    copyBall(this.ball, o.ball);
    for (let i = 0; i < this.cars.length; i++) copyCar(this.cars[i], o.cars[i]);
    for (let i = 0; i < this.pads.length; i++) { this.pads[i].active = o.pads[i].active; this.pads[i].timer = o.pads[i].timer; }
    for (let i = 0; i < this.stats.length; i++) Object.assign(this.stats[i], o.stats[i]);
    this.score[0] = o.score[0]; this.score[1] = o.score[1];
    this.phase = o.phase; this.phaseTimer = o.phaseTimer; this.clock = o.clock;
    this.overtime = o.overtime; this.expiring = o.expiring; this.winner = o.winner;
    this.lastGoalTeam = o.lastGoalTeam; this.lastGoalPlayer = o.lastGoalPlayer; this.lastTouchCar = o.lastTouchCar;
    this.kickoffVariant = o.kickoffVariant;
    this.rng.setState(o.rng.getState());
    this.lastCountdownShown = o.lastCountdownShown;
  }
}

const EMPTY_INPUT = new CarInput();
