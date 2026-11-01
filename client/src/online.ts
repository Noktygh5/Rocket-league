import {
  CarInput, ClientPredictor, PHYSICS, RemoteState, SimEvent, decodeSnapshot, defaultConfig, encodeInputPacket,
} from '@turboball/shared';
import { InputSampler } from './input';
import { Connection } from './net/transport';
import { Action } from './settings';
import { RenderSnap, makeSnap } from './snap';
import { GameView } from './view';

export interface StartInfo {
  you: number;
  players: { name: string; team: 0 | 1 }[];
  seed: number;
  matchLength: number;
}

// flag bits from the snapshot protocol
const F_ONGROUND = 1, F_SUPERSONIC = 64, F_BOOSTING = 128, F_DEMOLISHED = 256;

/** Online match: client-side prediction against the authoritative server. */
export class OnlineGame {
  private pred: ClientPredictor;
  private input = new InputSampler();
  private view: GameView;
  private snap: RenderSnap;
  private local = new CarInput();
  private raf = 0;
  private last = 0;
  private stopped = false;
  private fps = 60;
  private pendingEvents: SimEvent[] = [];
  private nextPing = 0;
  private lastSnapAt = 0;
  private goalClock = 0;
  private lastPhase = 0;
  private serverStats: RenderSnap['stats'] | null = null;
  private rs: RemoteState = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, d: null as never };
  readonly names: string[];
  onPauseRequest: (() => void) | null = null;
  onEnd: ((s: RenderSnap, names: string[]) => void) | null = null;
  onDisconnect: (() => void) | null = null;
  private endedFired = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, private conn: Connection, info: StartInfo) {
    this.names = info.players.map((p) => p.name);
    const cfg = { ...defaultConfig(info.players.map((p) => ({ team: p.team, name: p.name })), info.seed), matchLength: info.matchLength };
    this.pred = new ClientPredictor(cfg, info.you);
    this.view = new GameView(canvas, uiRoot, { names: this.names, teams: info.players.map((p) => p.team), localIndex: info.you, replay: true });
    this.snap = makeSnap(info.players.length);
    this.snap.localIndex = info.you;
    this.input.onAction = (a) => this.onAction(a);
    this.input.attach();
    conn.onBinary = (b) => {
      const s = decodeSnapshot(b);
      if (s) { this.pred.onSnapshot(s); this.lastSnapAt = performance.now(); }
    };
    const prev = conn.onJson;
    conn.onJson = (m) => {
      switch (m.t) {
        case 'pong': this.pred.onPong(Number(m.c), Number(m.tick), performance.now()); break;
        case 'ev': this.pendingEvents.push({ type: m.type as SimEvent['type'], a: Number(m.a), b: Number(m.b), v: Number(m.v) }); break;
        case 'stats': this.serverStats = m.stats as RenderSnap['stats']; break;
        default: prev?.(m); break;
      }
    };
    conn.onClose = () => this.onDisconnect?.();
  }

  get gameView(): GameView { return this.view; }

  private onAction(a: Action): void {
    if (a === 'ballcam') this.view.toggleBallCam();
    else if (a === 'skip') this.view.skipReplay();
    else if (a === 'pause') this.onPauseRequest?.();
  }

  setPaused(p: boolean): void {
    // online matches never pause; the overlay only lets the player open settings or leave
    this.input.enabled = !p;
    this.input.releaseAll();
  }

  start(): void {
    this.last = performance.now();
    this.nextPing = this.last;
    this.lastSnapAt = this.last;
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
    this.conn.onBinary = null;
  }

  private frame(now: number): void {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.016;
    this.fps += (1 / Math.max(dt, 1e-4) - this.fps) * 0.05;
    const pred = this.pred;

    if (now >= this.nextPing) {
      this.nextPing = now + (pred.hasSync ? 1000 : 120);
      this.conn.sendJson({ t: 'ping', c: now });
    }

    if (pred.hasSync) {
      const target = pred.targetTick(now);
      let guard = 0;
      // if far behind (tab was hidden), jump the predicted tick forward instead of replaying everything
      if (target - pred.tick > 30) pred.tick = target - 30;
      while (pred.tick < target && guard++ < 6) {
        this.input.sample(this.local, PHYSICS.dt);
        const t = pred.step(this.local);
        if (t % 2 === 0) this.conn.sendBinary(encodeInputPacket(t, pred.recentInputs(4)));
      }
      pred.decay(dt);
    }

    this.buildSnap(now);
    this.view.scoreboard = this.input.scoreboard;
    this.view.camera.rearView = this.input.rearView;
    const unstable = now - this.lastSnapAt > 600 || pred.rtt > 300;
    this.view.present(this.snap, dt, { fps: this.fps, ping: pred.hasSync ? pred.rtt : -1, unstable });
    this.pendingEvents.length = 0;
    if (this.snap.phase === 3 && !this.endedFired && pred.latest && pred.latest.phase === 3) {
      this.endedFired = true;
      this.onEnd?.(this.snap, this.names);
    }
  }

  private buildSnap(now: number): void {
    const pred = this.pred, sim = pred.sim, s = this.snap;
    const latest = pred.latest;
    s.events = this.pendingEvents.slice();
    const li = pred.localIndex;
    for (let i = 0; i < s.cars.length; i++) {
      const o = s.cars[i];
      o.team = sim.cars[i].team as 0 | 1;
      if (i === li) {
        const c = sim.cars[i];
        o.x = c.pos.x + pred.carOff.x; o.y = c.pos.y + pred.carOff.y; o.z = c.pos.z + pred.carOff.z;
        o.qx = c.rot.x; o.qy = c.rot.y; o.qz = c.rot.z; o.qw = c.rot.w;
        o.vx = c.vel.x; o.vy = c.vel.y; o.vz = c.vel.z;
        o.boost = c.boost; o.boosting = c.boosting && c.boost > 0; o.supersonic = c.supersonic;
        o.demolished = c.demolished; o.onGround = c.onGround;
        o.nx = c.surfaceNormal.x; o.ny = c.surfaceNormal.y; o.nz = c.surfaceNormal.z;
        const m = c.basis.m;
        o.fx = m[0]; o.fy = m[3]; o.fz = m[6];
        o.steer = this.local.steer; o.throttle = this.local.throttle; o.handbrake = this.local.handbrake;
      } else if (pred.remote(i, now, this.rs)) {
        const r = this.rs, d = r.d;
        o.x = r.px; o.y = r.py; o.z = r.pz;
        o.qx = r.qx; o.qy = r.qy; o.qz = r.qz; o.qw = r.qw;
        o.vx = r.vx; o.vy = r.vy; o.vz = r.vz;
        o.boost = d.boost; o.boosting = (d.flags & F_BOOSTING) !== 0; o.supersonic = (d.flags & F_SUPERSONIC) !== 0;
        o.demolished = (d.flags & F_DEMOLISHED) !== 0; o.onGround = (d.flags & F_ONGROUND) !== 0;
        o.fx = 1 - 2 * (r.qy * r.qy + r.qz * r.qz); o.fy = 2 * (r.qx * r.qy + r.qw * r.qz); o.fz = 2 * (r.qx * r.qz - r.qw * r.qy);
        o.nx = 2 * (r.qx * r.qz + r.qw * r.qy); o.ny = 2 * (r.qy * r.qz - r.qw * r.qx); o.nz = 1 - 2 * (r.qx * r.qx + r.qy * r.qy);
        o.steer = 0; o.throttle = o.boosting ? 1 : 0; o.handbrake = false;
      }
    }
    const b = sim.ball, sb = s.ball;
    sb.x = b.pos.x + pred.ballOff.x; sb.y = b.pos.y + pred.ballOff.y; sb.z = b.pos.z + pred.ballOff.z;
    sb.qx = b.rot.x; sb.qy = b.rot.y; sb.qz = b.rot.z; sb.qw = b.rot.w;
    sb.vx = b.vel.x; sb.vy = b.vel.y; sb.vz = b.vel.z;
    if (latest) {
      for (let i = 0; i < s.padActive.length; i++) {
        const t = latest.pads[i] ?? 0;
        s.padActive[i] = t === 0;
        s.padTimer[i] = t === 0 ? 1 : 1 - t / (i < 6 ? 10 : 4);
      }
      s.score = [latest.score[0], latest.score[1]];
      s.clock = latest.clock; s.overtime = latest.overtime; s.phase = latest.phase;
      s.countdown = latest.phaseTimer; s.winner = latest.winner;
    }
    if (this.serverStats) for (let i = 0; i < s.stats.length && i < this.serverStats.length; i++) Object.assign(s.stats[i], this.serverStats[i]);
    if (s.phase === 2) this.goalClock += 1 / 60; // approximate; reset on phase change
    if (s.phase !== this.lastPhase) { this.goalClock = 0; this.lastPhase = s.phase; }
    s.phaseElapsed = this.goalClock;
  }
}
