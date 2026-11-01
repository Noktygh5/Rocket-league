import { Bot, BotLevel, CarInput, GameSim, PHYSICS, FixedStepper, SimEvent, defaultConfig } from '@turboball/shared';
import { InputSampler } from './input';
import { RenderSnap, makeSnap, nlerpQuat } from './snap';
import { Action, settings } from './settings';
import { GameView } from './view';

export interface OfflineOptions {
  difficulty: BotLevel;
  matchLength: number;
  name: string;
}

/** Offline 1v1 against a bot: the sim, bot and renderer all run in the browser. */
export class OfflineGame {
  readonly sim: GameSim;
  private bot: Bot;
  private stepper = new FixedStepper();
  private input = new InputSampler();
  private view: GameView;
  private snap: RenderSnap;
  private raf = 0;
  private last = 0;
  private paused = false;
  private stopped = false;
  private fps = 60;
  private events: SimEvent[] = [];
  // previous-tick copies for render interpolation
  private prevCars: Float64Array;
  private prevBall = new Float64Array(7);
  private goalClock = 0;
  onPauseRequest: (() => void) | null = null;
  onEnd: ((s: RenderSnap, names: string[]) => void) | null = null;
  private endedFired = false;
  readonly names: string[];

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, readonly opts: OfflineOptions) {
    this.sim = new GameSim({
      ...defaultConfig([{ team: 0, name: opts.name }, { team: 1, name: `Bot (${opts.difficulty})` }], (Date.now() & 0xffff) | 1),
      matchLength: opts.matchLength,
    });
    this.names = [opts.name, `Bot (${opts.difficulty})`];
    this.bot = new Bot(opts.difficulty, this.sim, 1, 7);
    this.view = new GameView(canvas, uiRoot, { names: this.names, teams: [0, 1], localIndex: 0, replay: true });
    this.snap = makeSnap(2);
    this.snap.localIndex = 0;
    this.prevCars = new Float64Array(2 * 7);
    this.input.onAction = (a) => this.onAction(a);
    this.input.attach();
    this.savePrev();
  }

  get gameView(): GameView { return this.view; }

  private onAction(a: Action): void {
    if (a === 'ballcam') this.view.toggleBallCam();
    else if (a === 'skip') {
      this.view.skipReplay();
      if (this.sim.phase === 2) this.sim.phaseTimer = Math.min(this.sim.phaseTimer, 1.0);
    } else if (a === 'pause') this.onPauseRequest?.();
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.input.enabled = !p;
    this.input.releaseAll();
    this.last = performance.now();
    if (p) this.view.audio.silenceLoops();
  }

  start(): void {
    this.last = performance.now();
    const loop = (now: number): void => {
      if (this.stopped) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    this.view.destroy();
  }

  private savePrev(): void {
    const s = this.sim;
    for (let i = 0; i < s.cars.length; i++) {
      const c = s.cars[i], o = i * 7;
      this.prevCars[o] = c.pos.x; this.prevCars[o + 1] = c.pos.y; this.prevCars[o + 2] = c.pos.z;
      this.prevCars[o + 3] = c.rot.x; this.prevCars[o + 4] = c.rot.y; this.prevCars[o + 5] = c.rot.z; this.prevCars[o + 6] = c.rot.w;
    }
    const b = s.ball;
    this.prevBall[0] = b.pos.x; this.prevBall[1] = b.pos.y; this.prevBall[2] = b.pos.z;
    this.prevBall[3] = b.rot.x; this.prevBall[4] = b.rot.y; this.prevBall[5] = b.rot.z; this.prevBall[6] = b.rot.w;
  }

  private frame(now: number): void {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.016;
    this.fps += (1 / Math.max(dt, 1e-4) - this.fps) * 0.05;
    const sim = this.sim;

    if (!this.paused) {
      this.stepper.advance(dt * this.view.timeScale, () => {
        this.input.sample(sim.inputs[0], PHYSICS.dt);
        this.bot.think();
        this.savePrev();
        sim.step();
        sim.drainEvents(this.events);
      });
      if (sim.phase === 2) this.goalClock += dt; else this.goalClock = 0;
    }
    this.buildSnap();
    this.view.scoreboard = this.input.scoreboard;
    this.view.camera.rearView = this.input.rearView;
    this.view.present(this.snap, dt, { fps: this.fps, ping: -1, unstable: false });
    this.events.length = 0;
    if (sim.phase === 3 && !this.endedFired) {
      this.endedFired = true;
      this.onEnd?.(this.snap, this.names);
    }
  }

  private buildSnap(): void {
    const sim = this.sim, s = this.snap, a = this.stepper.alpha;
    s.events = this.events.slice();
    for (let i = 0; i < sim.cars.length; i++) {
      const c = sim.cars[i], o = s.cars[i], p = i * 7;
      o.x = this.prevCars[p] + (c.pos.x - this.prevCars[p]) * a;
      o.y = this.prevCars[p + 1] + (c.pos.y - this.prevCars[p + 1]) * a;
      o.z = this.prevCars[p + 2] + (c.pos.z - this.prevCars[p + 2]) * a;
      nlerpQuat(o, this.prevCars[p + 3], this.prevCars[p + 4], this.prevCars[p + 5], this.prevCars[p + 6], c.rot.x, c.rot.y, c.rot.z, c.rot.w, a);
      o.vx = c.vel.x; o.vy = c.vel.y; o.vz = c.vel.z;
      o.team = c.team as 0 | 1; o.boost = c.boost; o.boosting = c.boosting && c.boost > 0; o.supersonic = c.supersonic;
      o.demolished = c.demolished; o.onGround = c.onGround;
      o.nx = c.surfaceNormal.x; o.ny = c.surfaceNormal.y; o.nz = c.surfaceNormal.z;
      const m = c.basis.m;
      o.fx = m[0]; o.fy = m[3]; o.fz = m[6];
      o.steer = sim.inputs[i].steer; o.throttle = sim.inputs[i].throttle; o.handbrake = sim.inputs[i].handbrake;
    }
    const b = sim.ball, sb = s.ball;
    sb.x = this.prevBall[0] + (b.pos.x - this.prevBall[0]) * a;
    sb.y = this.prevBall[1] + (b.pos.y - this.prevBall[1]) * a;
    sb.z = this.prevBall[2] + (b.pos.z - this.prevBall[2]) * a;
    nlerpQuat(sb, this.prevBall[3], this.prevBall[4], this.prevBall[5], this.prevBall[6], b.rot.x, b.rot.y, b.rot.z, b.rot.w, a);
    sb.vx = b.vel.x; sb.vy = b.vel.y; sb.vz = b.vel.z;
    for (let i = 0; i < sim.pads.length; i++) {
      const p = sim.pads[i];
      s.padActive[i] = p.active;
      s.padTimer[i] = p.active ? 1 : 1 - p.timer / (p.large ? 10 : 4);
    }
    s.score = [sim.score[0], sim.score[1]];
    s.clock = sim.clock; s.overtime = sim.overtime; s.phase = sim.phase;
    s.countdown = sim.phaseTimer; s.winner = sim.winner;
    for (let i = 0; i < sim.stats.length; i++) Object.assign(s.stats[i], sim.stats[i]);
    s.phaseElapsed = this.goalClock;
  }
}

void settings; void CarInput;
