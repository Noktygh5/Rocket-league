import type { WebSocket } from 'ws';
import {
  CarInput, ClientMsg, GameSim, LobbyPlayer, MATCH, PHYSICS, Phase, ServerMsg, SimEvent, decodeInputPacket,
  defaultConfig, encodeSnapshot,
} from '@turboball/shared';

const DT_MS = 1000 * PHYSICS.dt;
const FORFEIT_MS = 10_000;
const MAX_FUTURE_TICKS = 240;

export interface Player {
  id: number;
  ws: WebSocket;
  name: string;
  team: 0 | 1;
  ready: boolean;
  wantsRematch: boolean;
  connected: boolean;
  carIndex: number;
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

  constructor(readonly code: string, readonly mode: 1 | 2, private onEmpty: (r: Room) => void) {}

  get capacity(): number { return this.mode === 1 ? 2 : 4; }
  get size(): number { return this.players.size; }

  // ------------------------------------------------------------ membership
  add(ws: WebSocket, name: string): Player | null {
    if (this.players.size >= this.capacity || this.state === 'playing') return null;
    const blue = [...this.players.values()].filter((p) => p.team === 0).length;
    const orange = this.players.size - blue;
    const p: Player = {
      id: nextPlayerId++, ws, name, team: blue <= orange ? 0 : 1, ready: false, wantsRematch: false, connected: true, carIndex: -1,
      last: new CarInput(), buf: new Map(), binTokens: 240, jsonTokens: 30, lastRefill: Date.now(), leftAt: 0,
    };
    this.players.set(p.id, p);
    if (this.hostId < 0) this.hostId = p.id;
    this.emptySince = 0;
    this.send(p, { t: 'welcome', id: p.id, code: this.code, v: 1 });
    this.broadcastLobby();
    return p;
  }

  remove(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
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
    if (![...this.players.values()].some((q) => q.connected)) this.shutdownSoon();
  }

  private shutdownSoon(): void {
    this.stopLoop();
    this.emptySince = Date.now();
    this.onEmpty(this);
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
        if ([...this.players.values()].filter((q) => q.team === m.team && q.id !== p.id).length < 2) { p.team = m.team === 1 ? 1 : 0; p.ready = false; this.broadcastLobby(); }
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
    this.sim = new GameSim({ ...defaultConfig(ps.map((p) => ({ team: p.team, name: p.name })), seed), matchLength: MATCH.length });
    this.state = 'playing';
    this.events.length = 0;
    const players = ps.map((p) => ({ name: p.name, team: p.team }));
    for (const p of ps) this.send(p, { t: 'start', you: p.carIndex, players, seed, matchLength: MATCH.length, tick: 0 });
    this.broadcastLobby();
    this.nextAt = performance.now() + 100;
    this.loop();
  }

  private checkForfeit(): void {
    if (this.forfeitTimer || this.mode !== 1 || this.state !== 'playing') return;
    this.forfeitTimer = setTimeout(() => {
      this.forfeitTimer = null;
      if (!this.sim || this.state !== 'playing') return;
      const gone = [...this.players.values()].find((p) => !p.connected);
      const stay = [...this.players.values()].find((p) => p.connected);
      if (gone && stay) {
        this.sim.score[stay.team] = Math.max(this.sim.score[stay.team], this.sim.score[gone.team] + 1);
        this.sim.winner = stay.team;
        this.sim.phase = Phase.Ended;
      }
    }, FORFEIT_MS);
  }

  // ------------------------------------------------------------ simulation loop
  private stopLoop(): void {
    if (this.timer) { clearTimeout(this.timer); clearImmediate(this.timer as unknown as NodeJS.Immediate); this.timer = null; }
    if (this.forfeitTimer) { clearTimeout(this.forfeitTimer); this.forfeitTimer = null; }
  }

  /** Drift-correcting fixed-rate loop: sleeps with setTimeout, then spins with setImmediate for the last ~2 ms. */
  private loop = (): void => {
    if (this.state !== 'playing' || !this.sim) return;
    const now = performance.now();
    let steps = 0;
    while (this.nextAt <= now && steps < 5) { this.stepOnce(); this.nextAt += DT_MS; steps++; }
    if (steps === 5 && this.nextAt <= now) this.nextAt = now + DT_MS; // fell behind: drop the backlog
    if (this.state !== 'playing') return;
    const wait = this.nextAt - performance.now();
    this.timer = (wait > 3 ? setTimeout(this.loop, wait - 2) : setImmediate(this.loop)) as unknown as NodeJS.Timeout;
  };

  private stepOnce(): void {
    const sim = this.sim as GameSim;
    const T = sim.tick + 1;
    for (const p of this.players.values()) {
      if (p.carIndex < 0) continue;
      const inp = sim.inputs[p.carIndex];
      if (!p.connected) { inp.clear(); continue; }
      const got = p.buf.get(T);
      if (got) p.last = got;
      inp.copy(p.last); // missing input: repeat the last known one
      if (T % 120 === 0) for (const k of p.buf.keys()) if (k < T - 20) p.buf.delete(k);
    }
    sim.step();
    sim.drainEvents(this.events);
    for (const e of this.events) this.broadcast({ t: 'ev', type: e.type, a: e.a, b: e.b, v: e.v });
    const hadScoreEvent = this.events.some((e) => e.type === 'goal' || e.type === 'demo' || e.type === 'end');
    this.events.length = 0;

    if (sim.tick % 2 === 0) {
      const snap = encodeSnapshot(sim);
      for (const p of this.players.values()) {
        if (p.connected && p.ws.readyState === 1 && p.ws.bufferedAmount < 1_000_000) p.ws.send(snap, { binary: true });
      }
    }
    const nowMs = Date.now();
    if (hadScoreEvent || nowMs - this.lastStats > 1000) {
      this.lastStats = nowMs;
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
