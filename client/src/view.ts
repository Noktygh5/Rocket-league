import * as THREE from 'three';
import { MATCH, PAD_COUNT, Vec3, arena } from '@turboball/shared';
import { AudioEngine } from './audio';
import { CamPose, CamTarget, ChaseCamera } from './camera';
import { Hud } from './hud';
import { Frame, World } from './render/world';
import { Quality, settings } from './settings';
import { BallSnap, CarSnap, RenderSnap, makeSnap, nlerpQuat } from './snap';

const REPLAY_HZ = 60;

function copyCar(d: CarSnap, s: CarSnap): void { Object.assign(d, s); }
function copyBall(d: BallSnap, s: BallSnap): void { Object.assign(d, s); }
export function copySnap(d: RenderSnap, s: RenderSnap): void {
  for (let i = 0; i < s.cars.length; i++) copyCar(d.cars[i], s.cars[i]);
  copyBall(d.ball, s.ball);
  d.phase = s.phase; d.clock = s.clock; d.score = [s.score[0], s.score[1]];
}

function lerpSnap(out: RenderSnap, a: RenderSnap, b: RenderSnap, t: number): void {
  const l = (x: number, y: number): number => x + (y - x) * t;
  for (let i = 0; i < a.cars.length; i++) {
    const o = out.cars[i], p = a.cars[i], q = b.cars[i];
    Object.assign(o, t < 0.5 ? p : q);
    o.x = l(p.x, q.x); o.y = l(p.y, q.y); o.z = l(p.z, q.z);
    nlerpQuat(o as never, p.qx, p.qy, p.qz, p.qw, q.qx, q.qy, q.qz, q.qw, t);
  }
  out.ball.x = l(a.ball.x, b.ball.x); out.ball.y = l(a.ball.y, b.ball.y); out.ball.z = l(a.ball.z, b.ball.z);
  nlerpQuat(out.ball as never, a.ball.qx, a.ball.qy, a.ball.qz, a.ball.qw, b.ball.qx, b.ball.qy, b.ball.qz, b.ball.qw, t);
}

/** Ring buffer of the last ~8 seconds at 60 Hz, used for goal replays. */
class ReplayBuffer {
  private frames: RenderSnap[];
  private head = 0;
  count = 0;
  private acc = 0;
  private readonly size = REPLAY_HZ * 8;
  constructor(n: number) { this.frames = Array.from({ length: this.size }, () => makeSnap(n)); }
  push(s: RenderSnap, dt: number): void {
    this.acc += dt;
    if (this.acc < 1 / REPLAY_HZ) return;
    this.acc = 0;
    copySnap(this.frames[this.head], s);
    this.head = (this.head + 1) % this.size;
    this.count = Math.min(this.size, this.count + 1);
  }
  clear(): void { this.count = 0; this.head = 0; }
  /** Frame `i` counted from the oldest stored frame. */
  at(i: number): RenderSnap { return this.frames[(this.head - this.count + i + this.size * 2) % this.size]; }
}

export interface ViewOptions {
  names: string[];
  teams: (0 | 1)[];
  localIndex: number;
  /** Instant replay after goals. */
  replay: boolean;
}

export interface FrameExtras { fps: number; ping: number; unstable: boolean }

/** Camera + world + HUD + audio for one running match. Source-agnostic: feed it RenderSnaps. */
export class GameView {
  readonly world: World;
  readonly camera = new ChaseCamera();
  readonly hud: Hud;
  readonly audio: AudioEngine;
  /** Offline sim speed multiplier (goal slow motion). */
  timeScale = 1;
  scoreboard = false;
  private replay: ReplayBuffer;
  private frame: Frame;
  private pose: CamPose = { pos: new Vec3(), target: new Vec3(), up: new Vec3(0, 0, 1), fov: 100 };
  private tgt: CamTarget = {
    carPos: new Vec3(), carFwd: new Vec3(1, 0, 0), carVel: new Vec3(), surfaceNormal: new Vec3(0, 0, 1),
    onGround: true, supersonic: false, ballPos: new Vec3(),
  };
  private playSnap: RenderSnap;
  private replaySkipped = false;
  private replayStarted = false;
  private lastPhase = 0;
  private prevOnGround = true;
  private prevVz = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private lowFpsFor = 0;
  onQualityDrop: ((q: Quality) => void) | null = null;
  private tags: HTMLElement[] = [];
  private tagV = new THREE.Vector3();
  private ballArrow: HTMLElement;
  /** True once the goal replay has played to its end (the sim can go straight to kickoff). */
  replayEnded = false;
  private resizeHandler = (): void => { this.world.resize(); this.camera.aspect = this.world.aspect; };

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, readonly opts: ViewOptions) {
    this.world = new World(canvas, settings.quality);
    this.world.setCars(opts.teams);
    this.hud = new Hud(uiRoot);
    this.audio = new AudioEngine();
    this.audio.init();
    this.replay = new ReplayBuffer(opts.teams.length);
    this.playSnap = makeSnap(opts.teams.length);
    this.camera.ballCam = settings.ballCamDefault;
    this.camera.aspect = this.world.aspect;
    this.frame = {
      ball: { x: 0, y: 0, z: 0, q: { x: 0, y: 0, z: 0, w: 1 } },
      cars: opts.teams.map((t) => ({ x: 0, y: 0, z: 0, q: { x: 0, y: 0, z: 0, w: 1 }, team: t, boosting: false, supersonic: false, boost: 0, fwdSpeed: 0, steer: 0, demolished: false, handbrake: false, slip: 0, onGround: true })),
      padActive: new Array(PAD_COUNT).fill(true), padTimer01: new Array(PAD_COUNT).fill(0),
      cam: { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, ux: 0, uy: 0, uz: 1, fov: 100 }, focus: opts.localIndex,
    };
    // name tags over the other cars, like the reference HUD
    opts.names.forEach((name, i) => {
      const el = document.createElement('div');
      el.className = `tag t${opts.teams[i]}`;
      el.innerHTML = `<i></i><span></span>`;
      (el.querySelector('span') as HTMLElement).textContent = name;
      el.style.display = 'none';
      this.hud.root.appendChild(el);
      this.tags.push(el);
    });
    // free camera: an arrow at the screen edge points to the ball while it is out of view
    this.ballArrow = document.createElement('div');
    this.ballArrow.className = 'ballarrow';
    this.ballArrow.innerHTML = '<svg viewBox="-30 -30 60 60"><circle r="13" class="bd"/><path d="M0-27 L9-16 L-9-16 Z" class="ar"/></svg>';
    this.hud.root.appendChild(this.ballArrow);
    window.addEventListener('resize', this.resizeHandler);
  }

  toggleBallCam(): void {
    this.camera.ballCam = !this.camera.ballCam;
    this.hud.notice(this.camera.ballCam ? 'BALL CAM ON' : 'BALL CAM OFF');
  }
  skipReplay(): void { this.replaySkipped = true; }
  get replaying(): boolean { return this.replayStarted && !this.replaySkipped; }

  private handleEvents(s: RenderSnap): void {
    const names = this.opts.names;
    for (const e of s.events) {
      switch (e.type) {
        case 'goal': {
          this.world.goalExplosion(e.a, s.ball.x, s.ball.y, s.ball.z);
          this.audio.goal();
          this.hud.goal(e.a, e.b >= 0 ? names[e.b] ?? '' : e.a === 0 ? 'BLUE' : 'ORANGE');
          this.camera.addShake(1.1);
          break;
        }
        case 'demo': {
          const v = s.cars[e.b];
          if (v) this.world.demoExplosion(v.team, v.x, v.y, v.z);
          this.audio.demo();
          this.hud.killFeed(names[e.a] ?? '?', names[e.b] ?? '?', s.cars[e.a]?.team ?? 0);
          if (e.a === s.localIndex || e.b === s.localIndex) this.camera.addShake(0.8);
          break;
        }
        case 'ballHit':
          this.world.ballImpact(s.ball.x, s.ball.y, s.ball.z, e.v);
          this.audio.ballHit(e.v);
          if (e.a === s.localIndex) this.camera.addShake(Math.min(0.9, e.v / 4500));
          break;
        case 'pad':
          if (e.a === s.localIndex) this.audio.padPickup(e.b < 6);
          break;
        case 'countdown': this.audio.beep(false); break;
        case 'kickoff': this.audio.beep(true); this.hud.hideBanner(); this.camera.reset(); this.replay.clear(); break;
        case 'respawn': if (e.a === s.localIndex) this.camera.reset(); break;
        default: break;
      }
    }
  }

  private fillFrame(s: RenderSnap): void {
    const f = this.frame;
    f.ball.x = s.ball.x; f.ball.y = s.ball.y; f.ball.z = s.ball.z;
    f.ball.q.x = s.ball.qx; f.ball.q.y = s.ball.qy; f.ball.q.z = s.ball.qz; f.ball.q.w = s.ball.qw;
    for (let i = 0; i < s.cars.length; i++) {
      const c = s.cars[i], o = f.cars[i];
      o.x = c.x; o.y = c.y; o.z = c.z;
      o.q.x = c.qx; o.q.y = c.qy; o.q.z = c.qz; o.q.w = c.qw;
      o.boosting = c.boosting; o.supersonic = c.supersonic; o.boost = c.boost; o.demolished = c.demolished;
      o.fwdSpeed = c.vx * c.fx + c.vy * c.fy + c.vz * c.fz;
      o.steer = c.steer;
      o.handbrake = c.handbrake; o.onGround = c.onGround;
      const sp2 = c.vx * c.vx + c.vy * c.vy + c.vz * c.vz;
      o.slip = Math.sqrt(Math.max(0, sp2 - o.fwdSpeed * o.fwdSpeed)); // speed sliding sideways
    }
    for (let i = 0; i < f.padActive.length; i++) {
      f.padActive[i] = s.padActive[i]; f.padTimer01[i] = s.padTimer[i];
    }
  }

  private setCam(p: CamPose): void {
    const c = this.frame.cam;
    c.px = p.pos.x; c.py = p.pos.y; c.pz = p.pos.z;
    c.tx = p.target.x; c.ty = p.target.y; c.tz = p.target.z;
    c.ux = p.up.x; c.uy = p.up.y; c.uz = p.up.z; c.fov = p.fov;
  }

  present(s: RenderSnap, dt: number, ex: FrameExtras): void {
    // quality fallback
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 1) {
      const fps = this.fpsN / this.fpsAcc;
      this.fpsAcc = 0; this.fpsN = 0;
      this.lowFpsFor = fps < 45 ? this.lowFpsFor + 1 : 0;
      if (this.lowFpsFor >= 5 && settings.quality !== 'low') {
        const next: Quality = settings.quality === 'high' ? 'medium' : 'low';
        settings.quality = next;
        this.world.applyQuality(next);
        this.lowFpsFor = 0;
        this.onQualityDrop?.(next);
      }
    }

    if (s.phase !== this.lastPhase) {
      if (s.phase === 2) { this.replaySkipped = false; this.replayStarted = false; this.replayEnded = false; }
      this.lastPhase = s.phase;
    }
    this.handleEvents(s);

    // goal slow motion (offline only; online clients have no control over the clock)
    this.timeScale = s.phase === 2 && s.phaseElapsed < 2.4 ? 0.25 + 0.75 * Math.max(0, (s.phaseElapsed - 1.6) / 0.8) : 1;

    const inGoal = s.phase === 2;
    const t0 = MATCH.goalCelebration;
    let playing = false;
    let replayT = 0;
    if (inGoal && this.opts.replay && !this.replaySkipped && s.phaseElapsed >= t0 && this.replay.count > 30) {
      const len = Math.min(MATCH.replaySeconds, this.replay.count / REPLAY_HZ);
      replayT = s.phaseElapsed - t0;
      if (replayT < len) playing = true; else { this.replaySkipped = true; this.replayEnded = true; }
    }
    if (!inGoal) this.replay.push(s, dt);
    this.replayStarted = playing || (this.replayStarted && !this.replaySkipped);

    let view = s;
    if (playing) {
      const n = this.replay.count;
      const len = Math.min(MATCH.replaySeconds, n / REPLAY_HZ);
      const startIdx = Math.max(0, n - Math.floor(len * REPLAY_HZ));
      const fi = startIdx + replayT * REPLAY_HZ;
      const i0 = Math.min(n - 1, Math.floor(fi)), i1 = Math.min(n - 1, i0 + 1);
      lerpSnap(this.playSnap, this.replay.at(i0), this.replay.at(i1), fi - Math.floor(fi));
      this.playSnap.padActive = s.padActive; this.playSnap.padTimer = s.padTimer;
      this.playSnap.localIndex = s.localIndex;
      view = this.playSnap;
      this.cinematic(view, replayT);
    } else {
      this.liveCamera(s, dt);
    }
    this.fillFrame(view);
    this.setCam(this.pose);
    this.world.render(this.frame, dt);
    const camW = this.world.camera, W = window.innerWidth, Hh = window.innerHeight;
    for (let i = 0; i < this.tags.length; i++) {
      const c = view.cars[i], el = this.tags[i];
      if (!c || i === s.localIndex || c.demolished || playing) { el.style.display = 'none'; continue; }
      this.tagV.set(c.x, c.z + 85, -c.y).project(camW);
      const vis = this.tagV.z < 1 && Math.abs(this.tagV.x) < 1.05 && Math.abs(this.tagV.y) < 1.05;
      el.style.display = vis ? 'flex' : 'none';
      if (vis) el.style.transform = `translate(${((this.tagV.x + 1) / 2) * W}px, ${((1 - this.tagV.y) / 2) * Hh}px) translate(-50%, -100%)`;
    }

    // ball pointer (free camera only)
    {
      const b = view.ball;
      this.tagV.set(b.x, b.z, -b.y).project(camW);
      let nx = this.tagV.x, ny = this.tagV.y;
      const behind = this.tagV.z > 1;
      if (behind) { nx = -nx; ny = -ny; }
      const off = behind || Math.abs(nx) > 0.94 || Math.abs(ny) > 0.9;
      const show = off && !this.camera.ballCam && !playing && s.phase !== 3;
      this.ballArrow.style.display = show ? 'block' : 'none';
      if (show) {
        let dx = nx, dy = ny;
        if (behind) { const m = Math.hypot(dx, dy) || 1; dx = (dx / m) * 5; dy = (dy / m) * 5; if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) dy = -5; }
        const k = Math.max(Math.abs(dx) / 0.9, Math.abs(dy) / 0.82, 1e-6);
        const ex = (dx / k + 1) / 2 * W, ey = (1 - (dy / k)) / 2 * Hh;
        const ang = Math.atan2(dx * (W / 2), dy * (Hh / 2)); // 0 = up, clockwise
        this.ballArrow.style.transform = `translate(${ex}px, ${ey}px) translate(-50%, -50%) rotate(${ang}rad)`;
      }
    }

    // sound loops
    const me = s.cars[s.localIndex];
    if (me && s.phase !== 3) {
      const sp = Math.hypot(me.vx, me.vy, me.vz);
      this.audio.update(sp, me.boosting && !me.demolished, me.throttle, !me.onGround);
      if (this.prevOnGround && !me.onGround && me.vz > 150) this.audio.jump();
      else if (!me.onGround && me.vz - this.prevVz > 250) this.audio.flip();
      this.prevOnGround = me.onGround; this.prevVz = me.vz;
    }

    this.hud.update(s, {
      ballCam: this.camera.ballCam, fps: ex.fps, ping: ex.ping, unstable: ex.unstable,
      replay: playing, scoreboard: this.scoreboard || s.phase === 3, names: this.opts.names,
    });
  }

  private liveCamera(s: RenderSnap, dt: number): void {
    const i = s.localIndex;
    const c = s.cars[i] ?? s.cars[0];
    const t = this.tgt;
    t.carPos.x = c.x; t.carPos.y = c.y; t.carPos.z = c.z;
    t.carFwd.x = c.fx; t.carFwd.y = c.fy; t.carFwd.z = c.fz;
    t.carVel.x = c.vx; t.carVel.y = c.vy; t.carVel.z = c.vz;
    t.surfaceNormal.x = c.nx; t.surfaceNormal.y = c.ny; t.surfaceNormal.z = c.nz;
    t.onGround = c.onGround && !c.demolished; t.supersonic = c.supersonic;
    t.ballPos.x = s.ball.x; t.ballPos.y = s.ball.y; t.ballPos.z = s.ball.z;
    this.camera.update(Math.min(dt, 0.05), t, this.pose);
  }

  private cinematic(s: RenderSnap, t: number): void {
    const b = s.ball;
    const a = 0.9 + t * 0.32;
    const r = 1250;
    const p = this.pose;
    p.pos.x = b.x + Math.cos(a) * r; p.pos.y = b.y + Math.sin(a) * r; p.pos.z = b.z + 420;
    const d = arena.sdf(p.pos.x, p.pos.y, p.pos.z);
    if (d < 60) {
      const n = new Vec3();
      arena.normal(n, p.pos.x, p.pos.y, p.pos.z);
      p.pos.x += n.x * (60 - d); p.pos.y += n.y * (60 - d); p.pos.z += n.z * (60 - d);
    }
    p.target.x = b.x; p.target.y = b.y; p.target.z = b.z + 80;
    p.up.x = 0; p.up.y = 0; p.up.z = 1;
    p.fov = 58;
  }

  destroy(): void {
    window.removeEventListener('resize', this.resizeHandler);
    this.audio.silenceLoops();
    this.hud.destroy();
    this.world.renderer.dispose();
  }
}
