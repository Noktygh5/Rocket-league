import { LobbyPlayer, PROTOCOL_VERSION } from '@turboball/shared';
import { Connection } from './net/transport';
import { OnlineGame, StartInfo } from './online';
import { settings, saveSettings } from './settings';
import { App, h } from './ui';

type Mode = 1 | 2 | 3;
const MODE_LABEL: Record<Mode, string> = { 1: '1 v 1', 2: '2 v 2', 3: '3 v 3 BETA' };

/** Lets this tab reattach to its match after a dropped connection or a page refresh. */
interface Session { code: string; token: string }
const SESSION_KEY = 'tb-session';
const COLD_START_MS = 90_000; // free Render instances can take about a minute to wake up

function loadSession(): Session | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as Session | null;
    return s && typeof s.code === 'string' && typeof s.token === 'string' ? s : null;
  } catch { return null; }
}
function saveSession(s: Session | null): void {
  try { if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); else sessionStorage.removeItem(SESSION_KEY); } catch { /* storage blocked */ }
}

interface LobbyState { code: string; mode: Mode; hostId: number; state: string; players: LobbyPlayer[] }

/** Online menu, room lobby and in-match lifecycle. */
export class OnlineUi {
  private conn: Connection | null = null;
  private myId = -1;
  private lobby: LobbyState | null = null;
  private game: OnlineGame | null = null;

  constructor(private app: App) {
    app.onlineMenu = () => this.menu();
  }

  /** Reattaches to a match this tab was in before a refresh; returns false when there is nothing to resume. */
  resume(): boolean {
    const s = loadSession();
    if (!s) return false;
    this.connect({ rejoin: s, quiet: true });
    return true;
  }

  /** Called when the page is opened with ?room=CODE. */
  autoJoin(code: string): void {
    this.menu(code);
  }

  private nameInput(): HTMLInputElement {
    return h('input', {
      type: 'text', maxlength: 14, value: settings.name, placeholder: 'Your name',
      onInput: (e: Event) => { settings.name = (e.target as HTMLInputElement).value.trim() || 'Player'; saveSettings(); },
    }) as HTMLInputElement;
  }

  menu(prefill = ''): void {
    this.leaveRoom(false);
    const codeIn = h('input', { type: 'text', maxlength: 5, placeholder: 'CODE', value: prefill, autocomplete: 'off', spellcheck: false }) as HTMLInputElement;
    const modeBtn = (mode: Mode, title: string, note: string): HTMLElement =>
      h('button', { class: 'mode', onClick: () => this.connect({ create: mode }) }, h('b', null, title), h('small', null, note));
    const tryJoin = (): void => {
      const c = codeIn.value.trim().toUpperCase();
      if (c.length === 5) this.connect({ join: c }); else this.app.toast('Enter the 5-letter room code');
    };
    codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryJoin(); });
    this.app.screen(h('div', { class: 'screen' }, h('div', { class: 'col' },
      h('h2', null, 'PLAY ONLINE'),
      h('div', { class: 'panel' },
        h('div', { class: 'setting' }, h('span', { class: 'lbl' }, 'Your name'), this.nameInput())),
      h('div', { class: 'panel' },
        h('h3', null, 'CREATE A ROOM'),
        h('p', { class: 'hint' }, 'Pick a size. You get a 5-letter code to send to your friends.'),
        h('div', { class: 'modes' },
          modeBtn(1, '1 v 1', 'Standard map'),
          modeBtn(2, '2 v 2', 'Standard map'),
          modeBtn(3, '3 v 3', 'BETA · bigger map'))),
      h('div', { class: 'panel' },
        h('h3', null, 'JOIN A ROOM'),
        h('p', { class: 'hint' }, 'Got a code from a friend? Type it here.'),
        h('div', { class: 'joinrow' }, codeIn, h('button', { class: 'small', onClick: tryJoin }, 'JOIN'))),
      h('button', { class: 'big sec', onClick: () => this.app.mainMenu() }, h('span', null, 'BACK')))));
    if (prefill) this.app.toast(`Room ${prefill}: enter your name and press JOIN`);
  }

  private connect(o: { create?: Mode; join?: string; rejoin?: Session; quiet?: boolean }): void {
    const deadline = Date.now() + COLD_START_MS;
    this.app.screen(h('div', { class: 'loading' }, o.rejoin ? 'RECONNECTING…' : 'CONNECTING…'));
    const fail = (msg: string): void => { this.leaveRoom(false); this.app.toast(msg, 5000); this.menu(); };
    const attempt = (): void => {
      const conn = new Connection();
      this.conn = conn;
      let opened = false, settled = false;
      // Never reached the server: keep retrying until the deadline (a sleeping free instance needs ~a minute).
      const unreachable = (): void => {
        if (settled || this.conn !== conn) return;
        settled = true; clearTimeout(timer); conn.close();
        if (Date.now() >= deadline) { fail('Could not reach the server. Check your connection and try again'); return; }
        this.app.screen(h('div', { class: 'loading' }, 'WAKING UP THE SERVER… (can take up to a minute)'));
        setTimeout(() => { if (this.conn === conn) attempt(); }, 1500);
      };
      const timer = setTimeout(unreachable, 8000);
      conn.onOpen = () => {
        opened = true; settled = true; clearTimeout(timer);
        if (o.rejoin) conn.sendJson({ t: 'rejoin', code: o.rejoin.code, token: o.rejoin.token, v: PROTOCOL_VERSION });
        else if (o.create) conn.sendJson({ t: 'create', name: settings.name, mode: o.create, v: PROTOCOL_VERSION });
        else conn.sendJson({ t: 'join', name: settings.name, code: o.join, v: PROTOCOL_VERSION });
      };
      conn.onClose = () => {
        if (this.conn !== conn) return;
        if (!opened) unreachable();
        else if (!this.game) fail('Connection closed');
      };
      conn.onJson = (m) => {
        if (o.rejoin && m.t === 'err') {
          saveSession(null);
          if (o.quiet) { this.leaveRoom(false); this.menu(); } else fail(String(m.msg));
          return;
        }
        this.onMessage(m);
      };
    };
    attempt();
  }

  /** The connection dropped mid-match: tear the game down and try to slip back into the same match. */
  private recover(): void {
    const s = loadSession();
    this.game?.stop();
    this.game = null;
    this.conn?.close();
    this.conn = null;
    this.app.stopActive = null;
    if (!s) { this.app.toast('Disconnected from server', 5000); this.app.mainMenu(); return; }
    this.app.toast('Connection lost, reconnecting…', 4000);
    this.connect({ rejoin: s });
  }

  private onMessage(m: Record<string, unknown>): void {
    switch (m.t) {
      case 'welcome':
        this.myId = Number(m.id);
        if (typeof m.token === 'string') saveSession({ code: String(m.code), token: m.token });
        break;
      case 'lobby':
        this.lobby = { code: String(m.code), mode: m.mode as Mode, hostId: Number(m.hostId), state: String(m.state), players: m.players as LobbyPlayer[] };
        if (!this.game) this.renderLobby();
        break;
      case 'start': this.startMatch(m as unknown as StartInfo); break;
      case 'err': this.app.toast(String(m.msg), 4500); break;
      case 'left': this.app.toast(`${String(m.name)} left`); break;
      case 'back': this.app.toast(`${String(m.name)} is back`); break;
      default: break;
    }
  }

  private renderLobby(): void {
    const l = this.lobby;
    if (!l || !this.conn) return;
    const conn = this.conn;
    const me = l.players.find((p) => p.id === this.myId);
    const isHost = l.hostId === this.myId;
    const link = `${location.origin}${location.pathname}?room=${l.code}`;
    const col = (team: 0 | 1): HTMLElement => {
      const ps = l.players.filter((p) => p.team === team);
      const slots: HTMLElement[] = ps.map((p) => h('div', { class: 'slot' + (p.id === this.myId ? ' me' : '') },
        h('span', null, `${p.name}${p.host ? ' ★' : ''}`), h('span', null, p.ready || p.host ? '✔ READY' : '…')));
      const cap = l.mode;
      for (let i = ps.length; i < cap; i++) slots.push(h('div', { class: 'slot empty' }, 'Open slot'));
      const canSwitch = l.mode > 1 && me && me.team !== team && ps.length < cap;
      return h('div', { class: `team ${team === 0 ? 'b' : 'o'}` }, h('h3', null, team === 0 ? 'BLUE' : 'ORANGE'), ...slots,
        canSwitch ? h('button', { class: 'small', onClick: () => conn.sendJson({ t: 'team', team }) }, 'JOIN TEAM') : null);
    };
    this.app.screen(h('div', { class: 'screen' }, h('div', { class: 'col' },
      h('h2', null, `ROOM · ${MODE_LABEL[l.mode]}`),
      h('div', { class: 'panel' },
        h('div', { class: 'code' }, l.code),
        h('div', { class: 'row' },
          h('input', { type: 'text', readonly: true, value: link, style: 'flex:1;min-width:260px' }),
          h('button', { class: 'small', onClick: () => { void navigator.clipboard?.writeText(link).then(() => this.app.toast('Invite link copied')); } }, 'COPY LINK'))),
      h('div', { class: 'panel teams' }, col(0), col(1)),
      h('div', { class: 'row' },
        isHost
          ? h('button', { class: 'big', onClick: () => conn.sendJson({ t: 'start' }) }, h('span', null, 'START MATCH'))
          : h('button', { class: 'big', onClick: () => conn.sendJson({ t: 'ready', ready: !me?.ready }) }, h('span', null, me?.ready ? 'NOT READY' : 'READY')),
        h('button', { class: 'big sec', onClick: () => { this.leaveRoom(true); this.app.mainMenu(); } }, h('span', null, 'LEAVE'))))));
  }

  private startMatch(info: StartInfo): void {
    if (!this.conn) return;
    this.game?.stop();
    this.app.showOverlay(null);
    this.app.screen(null);
    const g = new OnlineGame(this.app.canvas, this.app.ui, this.conn, info);
    this.game = g;
    this.app.stopActive = () => { g.stop(); };
    g.onPauseRequest = () => this.pauseMenu();
    g.onDisconnect = () => this.recover();
    g.onEnd = (snap, names) => this.app.matchResult(snap, names, false, {
      rematch: () => { this.conn?.sendJson({ t: 'rematch' }); this.app.toast('Waiting for the other players…'); },
      leave: () => { this.leaveRoom(true); this.app.mainMenu(); },
    });
    g.start();
  }

  private pauseMenu(): void {
    // Online games do not pause; this overlay is just a way to reach settings or leave.
    const app = this.app;
    const box = h('div', { class: 'overlay' }, h('div', { class: 'box' },
      h('h2', null, 'MENU'), h('p', { class: 'sub' }, 'The match keeps running.'),
      h('button', { class: 'big', onClick: () => app.showOverlay(null) }, h('span', null, 'RESUME')),
      h('button', { class: 'big', onClick: () => { app.showOverlay(null); app.settingsScreen(() => app.screen(null)); } }, h('span', null, 'SETTINGS')),
      h('button', { class: 'big sec', onClick: () => { this.leaveRoom(true); app.mainMenu(); } }, h('span', null, 'LEAVE MATCH'))));
    app.showOverlay(box);
  }

  private leaveRoom(notify: boolean): void {
    if (notify) saveSession(null);
    if (this.conn && notify && this.conn.open) this.conn.sendJson({ t: 'leave' });
    this.game?.stop();
    this.game = null;
    this.conn?.close();
    this.conn = null;
    this.lobby = null;
    this.app.stopActive = null;
  }
}
