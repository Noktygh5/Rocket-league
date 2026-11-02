import { LobbyPlayer, PROTOCOL_VERSION } from '@turboball/shared';
import { Connection } from './net/transport';
import { OnlineGame, StartInfo } from './online';
import { settings, saveSettings } from './settings';
import { App, h } from './ui';

type Mode = 1 | 2 | 3;
const MODE_LABEL: Record<Mode, string> = { 1: '1 v 1', 2: '2 v 2', 3: '3 v 3 BETA' };

interface LobbyState { code: string; mode: Mode; hostId: number; state: string; players: LobbyPlayer[] }

/** Online menu, room lobby and in-match lifecycle. */
export class OnlineUi {
  private conn: Connection | null = null;
  private myId = -1;
  private lobby: LobbyState | null = null;
  private game: OnlineGame | null = null;
  private pendingJoin: string | null = null;
  private pendingCreate: Mode | null = null;

  constructor(private app: App) {
    app.onlineMenu = () => this.menu();
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
    const codeIn = h('input', { type: 'text', maxlength: 5, placeholder: 'ROOM CODE', value: prefill, style: 'text-transform:uppercase;letter-spacing:6px;width:180px;font-size:22px' }) as HTMLInputElement;
    const tryJoin = (): void => {
      const c = codeIn.value.trim().toUpperCase();
      if (c.length === 5) this.connect({ join: c }); else this.app.toast('Enter the 5-letter room code');
    };
    codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryJoin(); });
    this.app.screen(h('div', { class: 'screen' }, h('div', { class: 'col' },
      h('h2', null, 'PLAY ONLINE'),
      h('div', { class: 'panel' },
        h('div', { class: 'setting' }, h('span', { class: 'lbl' }, 'Your name'), this.nameInput()),
        h('div', { class: 'setting' }, h('span', { class: 'lbl' }, 'Create a private room'),
          h('button', { class: 'small go', onClick: () => this.connect({ create: 1 }) }, '1 v 1'),
          h('button', { class: 'small go', onClick: () => this.connect({ create: 2 }) }, '2 v 2'),
          h('button', { class: 'small go', onClick: () => this.connect({ create: 3 }) }, '3 v 3 BETA')),
        h('div', { class: 'setting' }, h('span', { class: 'lbl' }, 'Join with a code'), codeIn,
          h('button', { class: 'small', onClick: tryJoin }, 'JOIN'))),
      h('button', { class: 'big sec', onClick: () => this.app.mainMenu() }, h('span', null, 'BACK')))));
    if (prefill) this.app.toast(`Room ${prefill}: enter your name and press JOIN`);
    else setTimeout(() => codeIn.focus(), 0);
  }

  private connect(o: { create?: Mode; join?: string }): void {
    this.pendingCreate = o.create ?? null;
    this.pendingJoin = o.join ?? null;
    this.app.screen(h('div', { class: 'loading' }, 'CONNECTING…'));
    const conn = new Connection();
    this.conn = conn;
    let opened = false;
    const fail = (msg: string): void => { this.leaveRoom(false); this.app.toast(msg, 5000); this.menu(); };
    const timer = setTimeout(() => { if (!opened) fail('Could not reach the server (it may be waking up — try again in a few seconds)'); }, 12000);
    conn.onOpen = () => {
      opened = true; clearTimeout(timer);
      if (this.pendingCreate) conn.sendJson({ t: 'create', name: settings.name, mode: this.pendingCreate, v: PROTOCOL_VERSION });
      else conn.sendJson({ t: 'join', name: settings.name, code: this.pendingJoin, v: PROTOCOL_VERSION });
    };
    conn.onClose = () => { clearTimeout(timer); if (!this.game) fail('Connection closed'); };
    conn.onJson = (m) => this.onMessage(m);
  }

  private onMessage(m: Record<string, unknown>): void {
    switch (m.t) {
      case 'welcome': this.myId = Number(m.id); break;
      case 'lobby':
        this.lobby = { code: String(m.code), mode: m.mode as Mode, hostId: Number(m.hostId), state: String(m.state), players: m.players as LobbyPlayer[] };
        if (!this.game) this.renderLobby();
        break;
      case 'start': this.startMatch(m as unknown as StartInfo); break;
      case 'err': this.app.toast(String(m.msg), 4500); break;
      case 'left': this.app.toast(`${String(m.name)} left`); break;
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
    g.onDisconnect = () => { this.app.toast('Disconnected from server', 5000); this.leaveRoom(false); this.app.mainMenu(); };
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
    if (this.conn && notify && this.conn.open) this.conn.sendJson({ t: 'leave' });
    this.game?.stop();
    this.game = null;
    this.conn?.close();
    this.conn = null;
    this.lobby = null;
    this.app.stopActive = null;
  }
}
