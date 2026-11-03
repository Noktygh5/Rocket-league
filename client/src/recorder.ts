import * as THREE from 'three';
import { ARENA, BOSS_VERSION, BotAgent, GameSim, PHYSICS, SimEvent } from '@turboball/shared';
import type { World } from './render/world';
import type { RenderSnap } from './snap';

// Vs-Bot match recorder (localhost only). Renders the match a second time from a fixed overhead
// camera, so you can watch it without your own point of view, and logs per-tick telemetry for
// analysing the bot. Both stream to the local server, which writes recordings/<id>/.

const W = 1920, H = 1080, FPS = 30, BITRATE = 6_000_000;
const LOG_EVERY = 4; // the sim runs at 120 Hz, telemetry is logged at 30 Hz
const FLUSH_LINES = 150;
const VIDEO_TYPES = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
const BLUE = '#5aa9ff', ORANGE = '#ffa24a';
const BOSS_MODES = ['Drive', 'Strike', 'Aerial', 'Pad', 'Shadow'];

// Fixed camera: high above the pitch, shifted slightly toward the near touchline so the walls and
// ball height still read. Sized from the arena so the whole pitch and both goals are always in frame.
const CAM_VFOV = 60;
const CAM_HEIGHT = (ARENA.halfWidth + 700) / Math.tan((CAM_VFOV / 2) * (Math.PI / 180));
const CAM_OFFSET_X = -0.2 * CAM_HEIGHT;

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

/** Recording is offered only when the game is opened on this machine's own localhost. */
export function canRecordHere(): boolean {
  return LOCAL_HOSTS.includes(location.hostname) && typeof MediaRecorder !== 'undefined';
}

function apiBase(): string {
  // the Vite dev server (5173) is a different origin from the game server (8080)
  return location.port === '5173' ? `${location.protocol}//${location.hostname}:8080` : location.origin;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;
const r2 = (v: number): number => Math.round(v * 100) / 100;
const pad2 = (n: number): string => String(n).padStart(2, '0');

export interface RecorderInfo {
  difficulty: string;
  matchLength: number;
  names: string[];
  teams: number[];
  botIndex: number;
}

export class SpectatorRecorder {
  readonly id: string;
  private _paused = false;
  private _replaying = false;
  private held = false;
  private holdWhy = 'pause';
  /** True while the match is paused (Esc menu): the video is paused too, so that time is not in it. */
  get paused(): boolean { return this._paused; }
  set paused(v: boolean) { this._paused = v; this.syncHold(); }
  /** True while a goal replay plays: replays are cut from the video (the live match is what gets analysed). */
  get replaying(): boolean { return this._replaying; }
  set replaying(v: boolean) { if (v !== this._replaying) { this._replaying = v; this.syncHold(); } }
  onError: ((msg: string) => void) | null = null;
  private renderer: THREE.WebGLRenderer;
  private cam: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mr: MediaRecorder | null = null;
  private ext = 'webm';
  private chain: Promise<void> = Promise.resolve();
  private lines: string[] = [];
  private acc = 0;
  private failed = false;
  private stopped: Promise<string> | null = null;
  private startedAt = Date.now();
  private tickN = 0;
  private proj = new THREE.Vector3();
  private bot: BotAgent['debug'] | null = null;

  constructor(private world: World, private info: RecorderInfo) {
    const d = new Date();
    this.id = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}_${info.difficulty}`;

    // A second renderer on its own offscreen canvas: it shares the scene but never touches the player's view.
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.renderer.setClearColor(0x05070b);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.cam = new THREE.PerspectiveCamera(CAM_VFOV, W / H, 50, 60000);
    // sim space is Z-up; three is Y-up with sim Y mapped to -Z. "up" on screen is -X so the pitch runs left to right.
    this.cam.position.set(CAM_OFFSET_X, CAM_HEIGHT, 0);
    this.cam.up.set(-1, 0, 0);
    this.cam.lookAt(0, 0, 0);
    this.cam.updateMatrixWorld();

    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  /** Point the recorder at the bot's debug state so its intended target is drawn and logged. */
  setBot(debug: BotAgent['debug']): void { this.bot = debug; }

  async start(): Promise<void> {
    const type = VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    if (!type) throw new Error('This browser cannot record video');
    this.ext = type.startsWith('video/mp4') ? 'mp4' : 'webm';
    await this.send('meta.json', 'PUT', JSON.stringify(this.meta(null))); // also verifies the server accepts recordings
    const stream = this.canvas.captureStream(FPS);
    this.mr = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: BITRATE });
    this.mr.ondataavailable = (e) => { if (e.data.size > 0) this.enqueue(`video.${this.ext}`, 'POST', e.data); };
    this.mr.start(1000);
    if (this.held) this.mr.pause(); // paused or in a replay before the recorder was ready
    this.startedAt = Date.now();
  }

  /** Pauses the video while the match is paused or a replay plays; telemetry marks where, to line it up with the video. */
  private syncHold(): void {
    const hold = this._paused || this._replaying;
    if (hold === this.held) return;
    this.held = hold;
    const mr = this.mr;
    if (mr) {
      try {
        if (hold && mr.state === 'recording') mr.pause();
        else if (!hold && mr.state === 'paused') mr.resume();
      } catch { /* recorder already stopped */ }
    }
    if (hold) this.holdWhy = this._paused ? 'pause' : 'replay';
    if (!this.failed) this.lines.push(JSON.stringify({ k: 'v', tick: this.tickN, video: hold ? 'hold' : 'resume', why: this.holdWhy }));
  }

  private meta(end: { score: [number, number]; stats: unknown } | null): object {
    return {
      id: this.id,
      startedAt: new Date(this.startedAt).toISOString(),
      ...(end ? { endedAt: new Date().toISOString(), finalScore: end.score, stats: end.stats, simTicks: this.tickN } : {}),
      difficulty: this.info.difficulty,
      botVersion: this.info.difficulty === 'ultrahard' ? BOSS_VERSION : undefined,
      matchLengthSeconds: this.info.matchLength,
      players: this.info.names.map((name, i) => ({ index: i, name, team: this.info.teams[i], isBot: i === this.info.botIndex })),
      arena: { halfWidthX: ARENA.halfWidth, halfLengthY: ARENA.halfLength, goalBackY: ARENA.goal.backY, ceilingZ: ARENA.ceilingHeight, goalHalfWidth: ARENA.goal.halfWidth, goalHeight: ARENA.goal.height },
      video: { file: `video.${this.ext}`, width: W, height: H, fps: FPS, note: 'Fixed overhead camera. Blue defends the left goal (-Y), orange the right (+Y). Rings = cars, ticks = heading, dashed line = the bot\'s current target. Goal replays and paused time are cut from the video; telemetry marks them with {k:"v", video:"hold"|"resume"} lines.' },
      telemetry: {
        file: 'telemetry.ndjson', simTickRate: PHYSICS.tickRate, loggedEveryTicks: LOG_EVERY,
        units: 'Unreal units (uu); 1 car length ~ 118 uu; speeds in uu/s; clock in seconds remaining',
        tickLine: '{k:"t", tick, clock, ph(phase 0 countdown,1 play,2 goal,3 ended), sc:[blue,orange], ball:[x,y,z,vx,vy,vz], cars:[{p:[x,y,z], v:[vx,vy,vz], f:[forward xyz], b:boost 0-100, g:onGround, ss:supersonic, d:demolished, in:[throttle,steer,pitch,yaw,roll,jump,boost,handbrake]}], bot:{m:mode, t:[target xyz]}}',
        eventLine: '{k:"e", tick, type, a, b, v}  (goal: a=team b=scorer; demo: a=attacker b=victim; ballHit: a=car v=speed; pad: a=car b=padIndex)',
        botModes: this.info.difficulty === 'ultrahard' ? BOSS_MODES : 'see shared/src/bot/bot.ts',
      },
    };
  }

  // ------------------------------------------------------------ uploads
  private enqueue(file: string, method: 'POST' | 'PUT', body: Blob | string): void {
    if (this.failed) return;
    this.chain = this.chain.then(() => this.send(file, method, body)).catch((e: Error) => this.fail(e.message));
  }

  private async send(file: string, method: 'POST' | 'PUT', body: Blob | string): Promise<void> {
    // text/plain keeps these "simple" requests, so the Vite dev server (another origin) needs no preflight
    const r = await fetch(`${apiBase()}/api/recordings/${this.id}/${file}`, { method, body, headers: { 'content-type': 'text/plain' } });
    if (!r.ok) throw new Error(r.status === 403 ? 'Recording only works on localhost' : `Recording upload failed (${r.status})`);
  }

  private fail(msg: string): void {
    if (this.failed) return;
    this.failed = true;
    try { if (this.mr && this.mr.state !== 'inactive') this.mr.stop(); } catch { /* ignore */ }
    this.onError?.(msg);
  }

  private flushTelemetry(): void {
    if (!this.lines.length) return;
    this.enqueue('telemetry.ndjson', 'POST', this.lines.join('\n') + '\n');
    this.lines = [];
  }

  // ------------------------------------------------------------ telemetry (called once per sim tick)
  onTick(sim: GameSim, events: SimEvent[], firstNew: number): void {
    if (this.failed) return;
    this.tickN = sim.tick;
    for (let i = firstNew; i < events.length; i++) {
      const e = events[i];
      this.lines.push(JSON.stringify({ k: 'e', tick: sim.tick, type: e.type, a: e.a, b: e.b, v: r1(e.v) }));
    }
    if (sim.tick % LOG_EVERY === 0) {
      const b = sim.ball;
      const cars = sim.cars.map((c, i) => {
        const inp = sim.inputs[i], m = c.basis.m;
        return {
          p: [r1(c.pos.x), r1(c.pos.y), r1(c.pos.z)], v: [r1(c.vel.x), r1(c.vel.y), r1(c.vel.z)], f: [r2(m[0]), r2(m[3]), r2(m[6])],
          b: r1(c.boost), g: c.onGround ? 1 : 0, ss: c.supersonic ? 1 : 0, d: c.demolished ? 1 : 0,
          in: [r2(inp.throttle), r2(inp.steer), r2(inp.pitch), r2(inp.yaw), r2(inp.roll), inp.jump ? 1 : 0, inp.boost ? 1 : 0, inp.handbrake ? 1 : 0],
        };
      });
      const d = this.bot;
      this.lines.push(JSON.stringify({
        k: 't', tick: sim.tick, clock: r2(sim.clock), ph: sim.phase, sc: [sim.score[0], sim.score[1]],
        ball: [r1(b.pos.x), r1(b.pos.y), r1(b.pos.z), r1(b.vel.x), r1(b.vel.y), r1(b.vel.z)], cars,
        ...(d ? { bot: { m: d.mode, t: [r1(d.tx), r1(d.ty), r1(d.tz)] } } : {}),
      }));
    }
    if (this.lines.length >= FLUSH_LINES) this.flushTelemetry();
  }

  // ------------------------------------------------------------ video frames (called once per drawn frame, live state only)
  frame(s: RenderSnap, dt: number): void {
    if (this.failed || this.held || !this.mr) return;
    this.acc += dt;
    if (this.acc < 1 / FPS) return;
    this.acc = this.acc > 2 / FPS ? 0 : this.acc - 1 / FPS;
    this.renderer.render(this.world.scene, this.cam);
    this.ctx.drawImage(this.renderer.domElement, 0, 0); // must happen right after render, before the canvas is presented
    this.overlay(s);
  }

  private project(x: number, y: number, z: number): [number, number] {
    this.proj.set(x, z, -y).project(this.cam);
    return [((this.proj.x + 1) / 2) * W, ((1 - this.proj.y) / 2) * H];
  }

  private overlay(s: RenderSnap): void {
    const g = this.ctx;
    g.textAlign = 'center';
    g.lineWidth = 3;
    for (let i = 0; i < s.cars.length; i++) {
      const c = s.cars[i];
      if (c.demolished) continue;
      const col = c.team === 0 ? BLUE : ORANGE;
      const [x, y] = this.project(c.x, c.y, c.z);
      const [hx, hy] = this.project(c.x + c.fx * 260, c.y + c.fy * 260, c.z + c.fz * 260);
      g.strokeStyle = col; g.fillStyle = col;
      g.beginPath(); g.arc(x, y, 20, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(x, y); g.lineTo(hx, hy); g.stroke();
      g.font = '600 22px system-ui, sans-serif';
      g.fillText(this.info.names[i] ?? '', x, y + 42); // below the ring so it never collides with the bot's target label
      if (i === this.info.botIndex && this.bot) {
        const [tx, ty] = this.project(this.bot.tx, this.bot.ty, this.bot.tz);
        g.save();
        g.setLineDash([10, 8]); g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(tx, ty); g.stroke();
        g.setLineDash([]);
        g.beginPath(); g.moveTo(tx - 9, ty - 9); g.lineTo(tx + 9, ty + 9); g.moveTo(tx + 9, ty - 9); g.lineTo(tx - 9, ty + 9); g.stroke();
        if (this.info.difficulty === 'ultrahard') {
          g.font = '600 20px system-ui, sans-serif';
          g.fillText(BOSS_MODES[this.bot.mode] ?? `mode ${this.bot.mode}`, tx, ty - 16);
        }
        g.restore();
      }
    }
    // ball: ring + velocity tail, with its height when it is in the air (the overhead view hides it)
    {
      const b = s.ball;
      const [bx, by] = this.project(b.x, b.y, b.z);
      const [tx, ty] = this.project(b.x - b.vx * 0.12, b.y - b.vy * 0.12, b.z - b.vz * 0.12);
      g.strokeStyle = '#ffffff'; g.fillStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(bx, by); g.lineTo(tx, ty); g.stroke();
      g.beginPath(); g.arc(bx, by, 14, 0, Math.PI * 2); g.fill(); g.stroke();
      if (b.z > 250) { g.fillStyle = '#fff'; g.font = '600 18px ui-monospace, monospace'; g.fillText(`z ${Math.round(b.z)}`, bx, by - 22); }
    }
    // scoreboard
    const mm =Math.floor(Math.max(0, s.clock) / 60), ss = Math.floor(Math.max(0, s.clock) % 60);
    g.fillStyle = 'rgba(5,8,14,0.65)';
    g.fillRect(W / 2 - 230, 14, 460, 56);
    g.font = '700 34px system-ui, sans-serif';
    g.fillStyle = BLUE; g.fillText(String(s.score[0]), W / 2 - 150, 54);
    g.fillStyle = ORANGE; g.fillText(String(s.score[1]), W / 2 + 150, 54);
    g.fillStyle = '#fff'; g.fillText(`${mm}:${pad2(ss)}${s.overtime ? ' OT' : ''}`, W / 2, 54);
    // per-car readout
    g.textAlign = 'left';
    g.font = '600 22px ui-monospace, monospace';
    s.cars.forEach((c, i) => {
      const sp = Math.round(Math.hypot(c.vx, c.vy, c.vz));
      g.fillStyle = 'rgba(5,8,14,0.65)'; g.fillRect(16, H - 56 - i * 34, 560, 30);
      g.fillStyle = c.team === 0 ? BLUE : ORANGE;
      g.fillText(`${(this.info.names[i] ?? '').padEnd(16)} boost ${String(Math.round(c.boost)).padStart(3)}  speed ${String(sp).padStart(4)}`, 26, H - 33 - i * 34);
    });
  }

  /** Finishes the recording; resolves with the recording id once everything is on disk. Safe to call twice. */
  stop(s: RenderSnap | null): Promise<string> {
    if (this.stopped) return this.stopped;
    this.stopped = (async () => {
      const mr = this.mr;
      if (mr && mr.state !== 'inactive') {
        await new Promise<void>((res) => { mr.addEventListener('stop', () => res(), { once: true }); mr.stop(); });
      }
      this.flushTelemetry();
      await this.chain;
      if (!this.failed) {
        try { await this.send('meta.json', 'PUT', JSON.stringify(this.meta({ score: s ? [s.score[0], s.score[1]] : [0, 0], stats: s ? s.stats : null }))); } catch { /* the video is already saved */ }
      }
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      return this.id;
    })();
    return this.stopped;
  }

  get hasFailed(): boolean { return this.failed; }
}
