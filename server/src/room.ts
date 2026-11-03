import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  CarInput, ClientMsg, GameSim, LobbyPlayer, MATCH, PHYSICS, Phase, ServerMsg, SimEvent, decodeInputPacket,
  defaultConfig, encodeSnapshot,
} from '@turboball/shared';

const DT_MS = 1000 * PHYSICS.dt;
const FORFEIT_MS = 20_000; // a whole team gone this long forfeits (long enough to reconnect)
const STALE_INPUT_MS = 300; // no input packet for this long: stop repeating the last input
const MATCH_GRACE_MS = 90_000; // keep a running match alive this long with nobody connected
const LOBBY_GRACE_MS = 5_000;
const MAX_FUTURE_TICKS = 240;
const MAX_CATCHUP = 8; // sim steps allowed per wake-up when the loop is late
// A snapshot is skipped for a connection that still has this much unsent data: after a network stall the client then
// gets the freshest state instead of seconds of stale snapshots in one burst (which would freeze and rubber-band it).
const SNAP_BACKLOG_BYTES = 3000;
const SNAP_EVERY = Math.max(1, Number(process.env.SNAP_EVERY ?? 2)); // sim ticks between snapshots (2 = 60 per second)
const SLOW_TPS = 100; // below this many sim ticks per second the server is considered to be struggling

/** Per-room timing of the sim loop, sampled once a second. */
export interface LoopHealth { tps: number; lateMs: number; dropped: number }

export interface Player {
  id: number;
  ws: WebSocket;
  name: string;
  team: 0 | 1;
  ready: boolean;
  wantsRematch: boolean;
  connected: boolean;
  carIndex: number;
  /** Secret that lets this player reattach after a dropped connection. */
  token: string;
  lastInputAt: number;
  last: CarInput;
  buf: Map<number, CarInput>;
  // rate limiting (token buckets)
  binTokens: number;
  jsonTokens: number;
  lastRefill: number;
  leftAt: number;
}

export type RoomState = 'lobby' | 'playing' | 'ended';

let nextPlayerId = 1;

export function cleanName(raw: unknown): string {
  const s = String(raw ?? '').replace(/[\u0000-\u001f<>&"']/g, '').trim().slice(0, 14);
  return s || 'Player';
}

export class Room {
  readonly players = new Map<number, Player>();
  state: RoomState = 'lobby';
  hostId = -1;
  sim: GameSim | null = null;
  emptySince = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private nextAt = 0;
  private events: SimEvent[] = [];
  private lastStats = 0;
  private matchIndex = 0;
  private forfeitTimer: NodeJS.Timeout | null = null;
  private roster: { name: string; team: 0 | 1 }[] = [];
  /** Latest one-second sample of how the sim loop is keeping up (tps should be PHYSICS.tickRate). */
  health: LoopHealth = { tps: PHYSICS.tickRate, lateMs: 0, dropped: 0 };
  private winStart = 0;
  private winTicks = 0;
  private winLate = 0;
  private winDropped = 0;
  private seed = 0;

  /** `mode` is the team size: 1 = 1v1, 2 = 2v2, 3 = 3v3 (beta, larger map). */
  constructor(readonly code: string, readonly mode: 1 | 2 | 3) {}

  get capacity(): number { return this.mode * 2; }
  get size(): number { return this.players.size; }
  /** How long this room may sit with nobody connected before it is deleted. */
  get emptyGraceMs(): number { return this.state === 'playing' ? MATCH_GRACE_MS : LOBBY_GRACE_MS; }

  // ------------------------------------------------------------ membership
  add(ws: WebSocket, name: string): Player | null {
    if (this.players.size >= this.capacity || this.state === 'playing') return null;
    const blue = [...this.players.values()].filter((p) => p.team === 0).length;
    const orange = this.players.size - blue;
    const p: Player = {
      id: nextPlayerId++, ws, name, team: blue <= orange ? 0 : 1, ready: false, wantsRematch: false, connected: true, carIndex: -1,
      token: randomUUID(), lastInputAt: 0, last: new CarInput(), buf: new Map(), binTokens: 240, jsonTokens: 30, lastRefill: Date.now(), leftAt: 0,
    };
    this.players.set(p.id, p);
    if (this.hostId < 0) this.hostId = p.id;
    this.emptySince = 0;
    this.send(p, { t: 'welcome', id: p.id, code: this.code, token: p.token, v: 1 });
    this.broadcastLobby();
    return p;
  }

  /** Reattaches a player whose connection dropped mid-match (matched by their secret token). */
  rejoin(ws: WebSocket, token: string): Player | null {
    if (!token) return null;
    const p = [...this.players.values()].find((q) => q.token === token);
    if (!p) return null;
    const old = p.ws;
    p.ws = ws;
    p.connected = true;
    p.leftAt = 0;
    p.buf.clear();
    p.last = new CarInput();
    p.lastInputAt = performance.now();
    p.binTokens = 240; p.jsonTokens = 30; p.lastRefill = Date.now();
    this.emptySince = 0;
    if (old !== ws) { try { old.close(); } catch { /* already gone */ } }
    this.send(p, { t: 'welcome', id: p.id, code: this.code, token: p.token, v: 1 });
    if (this.state === 'playing' && this.sim) {
      this.send(p, { t: 'start', you: p.carIndex, players: this.roster, seed: this.seed, matchLength: MATCH.length, tick: this.sim.tick });
      this.broadcast({ t: 'back', name: p.name });
      if (!this.timer) { this.nextAt = performance.now() + 50; this.winStart = 0; this.loop(); } // the loop pauses while nobody is connected
      this.checkForfeit();
    }
    this.broadcastLobby();
    return p;
  }

  /** `ws` identifies which connection closed, so a late close of a replaced socket is ignored. */
  remove(id: number, ws?: WebSocket): void {
    const p = this.players.get(id);
    if (!p || (ws && p.ws !== ws)) return;
    if (this.state === 'playing' && this.sim) {
      p.connected = false;
      p.leftAt = Date.now();
      this.broadcast({ t: 'left', name: p.name });
      this.checkForfeit();
    } else {
      this.players.delete(id);
      if (this.hostId === id) this.hostId = this.players.size ? [...this.players.keys()][0] : -1;
      this.broadcast({ t: 'left', name: p.name });
      this.broadcastLobby();
    }
    if (![...this.players.values()].some((q) => q.connected)) {
      this.stopLoop();
      this.emptySince = Date.now();
    }
  }

  // ------------------------------------------------------------ messaging
  send(p: Player, m: ServerMsg): void {
    if (p.connected && p.ws.readyState === 1) p.ws.send(JSON.stringify(m));
  }
  broadcast(m: ServerMsg): void {
    const s = JSON.stringify(m);
    for (const p of this.players.values()) if (p.connected && p.ws.readyState === 1) p.ws.send(s);
  }
  broadcastLobby(): void {
    const players: LobbyPlayer[] = [...this.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, ready: p.ready, host: p.id === this.hostId }));
    this.broadcast({ t: 'lobby', code: this.code, mode: this.mode, hostId: this.hostId, state: this.state, players });
  }

  private allow(p: Player, binary: boolean): boolean {
    const now = Date.now();
    const dt = (now - p.lastRefill) / 1000;
    p.lastRefill = now;
    p.binTokens = Math.min(240, p.binTokens + dt * 150);
    p.jsonTokens = Math.min(30, p.jsonTokens + dt * 15);
    if (binary) return p.binTokens-- > 0;
    return p.jsonTokens-- > 0;
  }

  // ------------------------------------------------------------ handlers
  onBinary(p: Player, data: ArrayBuffer): void {
    if (!this.allow(p, true) || !this.sim || this.state !== 'playing') return;
    const pk = decodeInputPacket(data);
    if (!pk) return;
    p.lastInputAt = performance.now();
    const now = this.sim.tick;
    for (let k = 0; k < pk.inputs.length; k++) {
      const tick = pk.lastTick - (pk.inputs.length - 1 - k);
      if (tick <= now - 12 || tick > now + MAX_FUTURE_TICKS) continue; // stale or absurdly far ahead
      p.buf.set(tick, pk.inputs[k]);
    }
  }

  onMessage(p: Player, m: ClientMsg): void {
    if (!this.allow(p, false)) return;
    switch (m.t) {
      case 'ping':
        this.send(p, { t: 'pong', c: Number(m.c) || 0, tick: this.sim ? this.sim.tick : 0 });
        break;
      case 'team':
        if (this.state !== 'lobby' || this.mode === 1) break;
        if ([...this.players.values()].filter((q) => q.team === m.team && q.id !== p.id).length < this.mode) { p.team = m.team === 1 ? 1 : 0; p.ready = false; this.broadcastLobby(); }
        break;
      case 'ready':
        if (this.state === 'lobby') { p.ready = !!m.ready; this.broadcastLobby(); }
        break;
      case 'start':
        if (p.id === this.hostId && this.state === 'lobby') this.tryStart();
        break;
      case 'rematch':
        if (this.state === 'ended') {
          p.wantsRematch = true;
          if ([...this.players.values()].filter((q) => q.connected).every((q) => q.wantsRematch)) this.resetToLobbyAndStart();
        }
        break;
      case 'leave':
        this.remove(p.id);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ match lifecycle
  private tryStart(): void {
    const ps = [...this.players.values()];
    const blue = ps.filter((p) => p.team === 0).length, orange = ps.length - blue;
    const host = this.players.get(this.hostId);
    if (blue < 1 || orange < 1) { if (host) this.send(host, { t: 'err', msg: 'Each team needs at least one player' }); return; }
    if (ps.some((p) => p.id !== this.hostId && !p.ready)) { if (host) this.send(host, { t: 'err', msg: 'Waiting for everyone to ready up' }); return; }
    this.startMatch();
  }

  private resetToLobbyAndStart(): void {
    for (const [id, p] of this.players) if (!p.connected) this.players.delete(id);
    if (this.players.size < 2) { this.state = 'lobby'; this.broadcastLobby(); return; }
    this.startMatch();
  }

  private startMatch(): void {
    const ps = [...this.players.values()].sort((a, b) => a.team - b.team || a.id - b.id);
    ps.forEach((p, i) => { p.carIndex = i; p.buf.clear(); p.last.clear(); p.wantsRematch = false; });
    this.matchIndex++;
    const seed = (Date.now() ^ (this.matchIndex * 2654435761)) >>> 0;
    this.seed = seed;
    this.sim = new GameSim({ ...defaultConfig(ps.map((p) => ({ team: p.team, name: p.name })), seed), matchLength: MATCH.length });
    this.state = 'playing';
    this.events.length = 0;
    const players = ps.map((p) => ({ name: p.name, team: p.team }));
    this.roster = players;
    const startedAt = performance.now();
    for (const p of ps) p.lastInputAt = startedAt;
    for (const p of ps) this.send(p, { t: 'start', you: p.carIndex, players, seed, matchLength: MATCH.length, tick: 0 });
    this.broadcastLobby();
    this.nextAt = performance.now() + 100;
    this.winStart = 0; this.winTicks = 0; this.winLate = 0; this.winDropped = 0;
    this.loop();
  }

  /** If one whole team is disconnected, the other team wins after FORFEIT_MS unless someone comes back. */
  private checkForfeit(): void {
    if (this.state !== 'playing' || !this.sim) return;
    const alive = [0, 0];
    for (const p of this.players.values()) if (p.connected) alive[p.team]++;
    const gone = alive[0] === 0 && alive[1] > 0 ? 0 : alive[1] === 0 && alive[0] > 0 ? 1 : -1;
    if (gone < 0) {
      if (this.forfeitTimer) { clearTimeout(this.forfeitTimer); this.forfeitTimer = null; }
      return;
    }
    if (this.forfeitTimer) return;
    this.forfeitTimer = setTimeout(() => {
      this.forfeitTimer = null;
      if (!this.sim || this.state !== 'playing') return;
      const still = [0, 0];
      for (const p of this.players.values()) if (p.connected) still[p.team]++;
      if (still[gone] > 0 || still[1 - gone] === 0) return;
      const win = 1 - gone;
      this.sim.score[win] = Math.max(this.sim.score[win], this.sim.score[gone] + 1);
      this.sim.winner = win;
      this.sim.phase = Phase.Ended;
    }, FORFEIT_MS);
  }

  // ------------------------------------------------------------ simulation loop
  private stopLoop(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.forfeitTimer) { clearTimeout(this.forfeitTimer); this.forfeitTimer = null; }
  }

  /**
   * Drift-correcting fixed-rate loop. It only sleeps (no busy-waiting): a free Render instance gets ~0.1 CPU,
   * and spinning would burn that quota and get the whole process throttled. If it falls far behind it skips
   * the backlog instead of snowballing; clients notice the lower tick rate and slow down with it.
   */
  private loop = (): void => {
    if (this.state !== 'playing' || !this.sim) return;
    const now = performance.now();
    if (now - this.nextAt > this.winLate) this.winLate = now - this.nextAt;
    let steps = 0;
    while (this.nextAt <= now && steps < MAX_CATCHUP) { this.stepOnce(); this.nextAt += DT_MS; steps++; }
    this.winTicks += steps;
    if (this.nextAt <= now) { // still behind after catching up: drop the rest rather than spiral
      this.winDropped += Math.ceil((now - this.nextAt) / DT_MS);
      this.nextAt = now + DT_MS;
    }
    this.sampleHealth(now);
    if (this.state !== 'playing') return;
    this.timer = setTimeout(this.loop, Math.max(0, this.nextAt - performance.now()));
  };

  private sampleHealth(now: number): void {
    if (this.winStart === 0) { this.winStart = now; return; }
    const span = now - this.winStart;
    if (span < 1000) return;
    this.health = { tps: (this.winTicks * 1000) / span, lateMs: this.winLate, dropped: this.winDropped };
    if (this.health.tps < SLOW_TPS && this.sim && this.sim.phase !== Phase.Countdown) {
      console.warn(`[room ${this.code}] server running slow: ${this.health.tps.toFixed(0)}/${PHYSICS.tickRate} ticks/s, worst delay ${this.health.lateMs.toFixed(0)} ms, ${this.health.dropped} ticks dropped`);
    }
    this.winStart = now; this.winTicks = 0; this.winLate = 0; this.winDropped = 0;
  }

  private stepOnce(): void {
    const sim = this.sim as GameSim;
    const T = sim.tick + 1;
    const nowMs = performance.now();
    for (const p of this.players.values()) {
      if (p.carIndex < 0) continue;
      const inp = sim.inputs[p.carIndex];
      if (!p.connected) { inp.clear(); continue; }
      const got = p.buf.get(T);
      if (got) p.last = got;
      else if (nowMs - p.lastInputAt > STALE_INPUT_MS) p.last.clear(); // client stalled (hidden tab, lag spike): coast instead of driving blind
      inp.copy(p.last); // missing input: repeat the last known one
      if (T % 120 === 0) for (const k of p.buf.keys()) if (k < T - 20) p.buf.delete(k);
    }
    sim.step();
    sim.drainEvents(this.events);
    for (const e of this.events) this.broadcast({ t: 'ev', type: e.type, a: e.a, b: e.b, v: e.v });
    const hadScoreEvent = this.events.some((e) => e.type === 'goal' || e.type === 'demo' || e.type === 'end');
    this.events.length = 0;

    if (sim.tick % SNAP_EVERY === 0) {
      const snap = encodeSnapshot(sim);
      for (const p of this.players.values()) {
        if (p.connected && p.ws.readyState === 1 && p.ws.bufferedAmount < SNAP_BACKLOG_BYTES) p.ws.send(snap, { binary: true });
      }
    }
    const wallMs = Date.now();
    if (hadScoreEvent || wallMs - this.lastStats > 1000) {
      this.lastStats = wallMs;
      this.broadcast({ t: 'stats', stats: sim.stats.map((s) => ({ ...s })) });
    }
    if (sim.phase === Phase.Ended) {
      this.state = 'ended';
      this.stopLoop();
      this.broadcast({ t: 'stats', stats: sim.stats.map((s) => ({ ...s })) });
      // final snapshot so clients see the end state
      const snap = encodeSnapshot(sim);
      for (const p of this.players.values()) if (p.connected && p.ws.readyState === 1) p.ws.send(snap, { binary: true });
      this.broadcastLobby();
    }
  }
}
