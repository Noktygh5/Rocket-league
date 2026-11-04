import { BotLevel, CAMERA_DEFAULTS } from '@turboball/shared';
import { escapeHtml } from './hud';
import { serverUrl } from './net/transport';
import { OfflineGame } from './offline';
import { canRecordHere } from './recorder';
import { WinSink, canRecordWins, getSaveFolder } from './winSaver';
import { ACTIONS, ACTION_LABELS, Action, Quality, keyLabel, resetCamera, saveSettings, settings } from './settings';
import type { RenderSnap } from './snap';

type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;

/** Tiny DOM builder. */
export function h(tag: string, attrs: Attrs | null, ...kids: (Node | string | null | undefined)[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false) el.setAttribute(k, String(v));
    }
  }
  for (const kid of kids) if (kid != null) el.append(kid);
  return el;
}

const bigBtn = (label: string, onClick: () => void, sec = false): HTMLElement =>
  h('button', { class: 'big' + (sec ? ' sec' : ''), onClick }, h('span', null, label));

/** Application shell: owns the screens and the currently running game. */
export class App {
  readonly ui = document.getElementById('ui') as HTMLElement;
  readonly canvas = document.getElementById('game') as HTMLCanvasElement;
  private current: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  game: OfflineGame | null = null;
  /** Hook for the online module, set by main.ts. */
  onlineMenu: (() => void) | null = null;
  /** Whatever is currently running a match (offline or online) so Esc and quit can stop it. */
  stopActive: (() => void) | null = null;
  private lastBot: { difficulty: BotLevel; length: number; record: boolean } = { difficulty: 'medium', length: 300, record: false };
  private toastEl: HTMLElement | null = null;

  screen(el: HTMLElement | null): void {
    this.current?.remove();
    this.current = el;
    if (el) this.ui.append(el);
  }

  showOverlay(el: HTMLElement | null): void {
    this.overlay?.remove();
    this.overlay = el;
    if (el) this.ui.append(el);
  }

  toast(msg: string, ms = 3500): void {
    this.toastEl?.remove();
    const t = h('div', { class: 'toast' }, msg);
    this.toastEl = t;
    this.ui.append(t);
    setTimeout(() => { if (this.toastEl === t) { t.remove(); this.toastEl = null; } }, ms);
  }

  private page(...kids: (Node | string | null)[]): HTMLElement {
    return h('div', { class: 'screen' }, h('div', { class: 'col' }, ...kids));
  }

  // ------------------------------------------------------------ menus
  mainMenu(): void {
    this.stopGame();
    this.screen(this.page(
      h('div', { class: 'logo' }, 'TURBOBALL'),
      h('div', { class: 'sub' }, 'ROCKET-POWERED CAR SOCCER'),
      bigBtn('PLAY VS BOT', () => this.botSetup()),
      bigBtn('PLAY ONLINE', () => (this.onlineMenu ? this.onlineMenu() : this.toast('Online mode is not available in this build'))),
      bigBtn('SETTINGS', () => this.settingsScreen(() => this.mainMenu())),
      bigBtn('CONTROLS', () => this.controlsScreen()),
      bigBtn('GIVE NIKHIL FEEDBACK', () => this.feedbackScreen(), true),
    ));
  }

  /** Free-text feedback box; messages land in the server's private inbox. */
  feedbackScreen(): void {
    const name = h('input', { type: 'text', maxlength: 40, placeholder: 'Your name (optional)', value: settings.name === 'Player' ? '' : settings.name }) as HTMLInputElement;
    const msg = h('textarea', { maxlength: 1000, rows: 8, placeholder: 'What did you like? What felt off? Any bugs or ideas?' }) as HTMLTextAreaElement;
    const status = h('div', { class: 'sub' }, '');
    const sendBtn = h('button', { class: 'big' }, h('span', null, 'SEND'));
    let sending = false;
    const send = async (): Promise<void> => {
      if (sending) return;
      const message = msg.value.trim();
      if (message.length < 3) { status.textContent = 'Write a few words first.'; return; }
      sending = true; status.textContent = 'Sending…';
      try {
        const r = await fetch(`${serverUrl().replace(/^ws/, 'http')}/api/feedback`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.value.trim(), message }),
        });
        const body = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (r.ok && body.ok) {
          this.screen(this.page(h('h2', null, 'THANKS!'), h('div', { class: 'sub' }, 'Your feedback was sent to Nikhil.'), bigBtn('BACK', () => this.mainMenu())));
          return;
        }
        status.textContent = body.error ?? 'Could not send. Try again in a moment.';
      } catch {
        status.textContent = 'Could not reach the server. Try again in a moment.';
      }
      sending = false;
    };
    sendBtn.addEventListener('click', () => { void send(); });
    this.screen(this.page(
      h('h2', null, 'GIVE NIKHIL FEEDBACK'),
      h('div', { class: 'sub' }, 'Tell me what you think. I read every message.'),
      h('div', { class: 'panel feedback' }, name, msg),
      status,
      sendBtn,
      bigBtn('BACK', () => this.mainMenu(), true),
    ));
    setTimeout(() => msg.focus(), 0);
  }

  botSetup(): void {
    let difficulty: BotLevel = this.lastBot.difficulty;
    let length = this.lastBot.length;
    let record = this.lastBot.record && (canRecordHere() || canRecordWins());
    const diffRow = h('div', { class: 'row' });
    const lenRow = h('div', { class: 'row' });
    const recRow = h('div', { class: 'row' });
    const recSetting = h('div', { class: 'setting' }, h('span', { class: 'lbl' }, 'Record'), recRow);
    const render = (): void => {
      // on localhost every match is recorded for analysis; anywhere else only Ultrahard wins are, to the player's own computer
      const local = canRecordHere();
      recSetting.style.display = local || (canRecordWins() && difficulty === 'ultrahard') ? '' : 'none';
      recRow.replaceChildren(
        h('button', { class: 'small' + (record ? ' on' : ''), onClick: () => { record = !record; render(); } }, record ? '● RECORDING ON' : local ? 'RECORD MATCH' : 'RECORD MY WINS'),
        h('span', { class: 'hint', style: 'margin:0' }, !record ? 'Off'
          : local ? 'Fixed overhead camera + bot telemetry, saved to the recordings folder.'
            : 'Overhead video of every win, saved to a folder you pick (it opens in Documents). Losses are not saved.'));
      diffRow.replaceChildren(...(['easy', 'medium', 'hard', 'ultrahard'] as BotLevel[]).map((d) =>
        h('button', { class: 'small' + (d === difficulty ? ' on' : '') + (d === 'ultrahard' ? ' boss' : ''), onClick: () => { difficulty = d; render(); } }, d === 'ultrahard' ? 'ULTRAHARD BOSS' : d.toUpperCase())));
      lenRow.replaceChildren(...[180, 300, 600].map((l) =>
        h('button', { class: 'small' + (l === length ? ' on' : ''), onClick: () => { length = l; render(); } }, `${l / 60} MIN`)));
    };
    render();
    this.screen(this.page(
      h('h2', null, 'PLAY VS BOT'),
      h('div', { class: 'panel' },
        h('div', { class: 'setting' }, h('span', { class: 'lbl' }, 'Difficulty'), diffRow),
        h('div', { class: 'setting' }, h('span', { class: 'lbl' }, 'Match length'), lenRow),
        recSetting,
        h('div', { class: 'setting' }, h('span', { class: 'lbl' }, 'Your name'),
          h('input', { type: 'text', maxlength: 14, value: settings.name, onInput: (e: Event) => { settings.name = (e.target as HTMLInputElement).value.trim() || 'Player'; saveSettings(); } }))),
      bigBtn('START MATCH', () => this.startOffline(difficulty, length, record)),
      bigBtn('BACK', () => this.mainMenu(), true),
    ));
  }

  controlsScreen(): void {
    const rows = ACTIONS.map((a) => h('div', { class: 'k' }, h('span', null, ACTION_LABELS[a]), h('kbd', null, keyLabel(settings.keys[a]))));
    this.screen(this.page(
      h('h2', null, 'CONTROLS'),
      h('div', { class: 'panel' }, h('div', { class: 'keys' }, ...rows)),
      h('p', { class: 'sub' }, 'Hold right mouse for rear view. Jump again in the air with a direction held to flip. Rebind keys in Settings.'),
      bigBtn('BACK', () => this.mainMenu(), true),
    ));
  }

  settingsScreen(back: () => void): void {
    const slider = (label: string, key: keyof typeof settings.camera, min: number, max: number, step: number): HTMLElement => {
      const val = h('span', { class: 'val' }, String(settings.camera[key]));
      const inp = h('input', {
        type: 'range', min, max, step, value: settings.camera[key],
        onInput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); settings.camera[key] = v; val.textContent = String(v); saveSettings(); },
      });
      return h('div', { class: 'setting' }, h('span', { class: 'lbl' }, label), inp, val);
    };
    const camBox = h('div', { class: 'panel' }, h('h2', null, 'CAMERA'),
      slider('FOV', 'fov', 60, 130, 1), slider('Distance', 'distance', 100, 400, 5), slider('Height', 'height', 40, 200, 5),
      slider('Angle', 'angle', -15, 5, 1), slider('Stiffness', 'stiffness', 0, 1, 0.05), slider('Swivel speed', 'swivelSpeed', 1, 10, 0.5),
      slider('Transition speed', 'transitionSpeed', 0.5, 2, 0.1),
      h('button', { class: 'small', onClick: () => { resetCamera(); this.settingsScreen(back); } }, 'Reset to defaults'));

    const keysBox = h('div', { class: 'panel' }, h('h2', null, 'KEY BINDINGS'));
    const grid = h('div', { class: 'keys' });
    const refresh = (): void => {
      grid.replaceChildren(...ACTIONS.map((a) => {
        const kbd = h('kbd', { onClick: () => capture(a, kbd) }, keyLabel(settings.keys[a]));
        return h('div', { class: 'k' }, h('span', null, ACTION_LABELS[a]), kbd);
      }));
    };
    const capture = (a: Action, kbd: HTMLElement): void => {
      kbd.textContent = 'press key…'; kbd.classList.add('wait');
      const fn = (e: KeyboardEvent): void => {
        e.preventDefault(); e.stopPropagation();
        window.removeEventListener('keydown', fn, true);
        if (e.code !== 'Escape') {
          const other = ACTIONS.find((x) => x !== a && settings.keys[x] === e.code);
          if (other) settings.keys[other] = settings.keys[a];
          settings.keys[a] = e.code;
          saveSettings();
        }
        refresh();
      };
      window.addEventListener('keydown', fn, true);
    };
    refresh();
    keysBox.append(grid);

    const select = (label: string, opts: [string, string][], value: string, onChange: (v: string) => void): HTMLElement => {
      const s = h('select', { onChange: (e: Event) => onChange((e.target as HTMLSelectElement).value) }, ...opts.map(([v, l]) => h('option', { value: v, ...(v === value ? { selected: true } : {}) }, l)));
      return h('div', { class: 'setting' }, h('span', { class: 'lbl' }, label), s);
    };
    const check = (label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement =>
      h('div', { class: 'setting' }, h('span', { class: 'lbl' }, label),
        h('input', { type: 'checkbox', ...(get() ? { checked: true } : {}), onChange: (e: Event) => { set((e.target as HTMLInputElement).checked); saveSettings(); } }));
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: settings.volume, onInput: (e: Event) => { settings.volume = Number((e.target as HTMLInputElement).value); saveSettings(); this.game?.gameView.audio.setVolume(settings.volume); } });
    const gen = h('div', { class: 'panel' }, h('h2', null, 'GENERAL'),
      select('Graphics quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], settings.quality, (v) => { settings.quality = v as Quality; saveSettings(); this.game?.gameView.world.applyQuality(settings.quality); }),
      h('div', { class: 'setting' }, h('span', { class: 'lbl' }, 'Volume'), vol),
      select('Speed unit', [['kmh', 'km/h'], ['uu', 'uu/s']], settings.speedUnit, (v) => { settings.speedUnit = v as 'kmh' | 'uu'; saveSettings(); }),
      check('Show FPS', () => settings.showFps, (v) => (settings.showFps = v)),
      check('Show ping', () => settings.showPing, (v) => (settings.showPing = v)),
      check('Ball cam on by default', () => settings.ballCamDefault, (v) => (settings.ballCamDefault = v)));
    const page = this.page(h('h2', null, 'SETTINGS'), gen, camBox, keysBox, bigBtn('BACK', back, true));
    if (this.game) page.style.background = 'rgba(6,9,15,0.92)';
    this.screen(page);
  }

  // ------------------------------------------------------------ matches
  startOffline(difficulty: BotLevel, length: number, record = this.lastBot.record): void {
    this.lastBot = { difficulty, length, record };
    // wins-only recording (not localhost): ask for the save folder now, while the click that started the match is still fresh
    const wins = record && !canRecordHere() && difficulty === 'ultrahard' && canRecordWins();
    const folder = wins ? getSaveFolder() : Promise.resolve(null);
    this.screen(h('div', { class: 'loading' }, 'LOADING…'));
    void folder.then((dir) => requestAnimationFrame(() => setTimeout(() => {
      this.stopGame();
      let winSink: WinSink | undefined;
      if (wins) {
        const d = new Date(), p2 = (n: number): string => String(n).padStart(2, '0');
        winSink = new WinSink(dir, `Turboball_vs_Boss_${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`);
      }
      const game = new OfflineGame(this.canvas, this.ui, { difficulty, matchLength: length, name: settings.name, record: record && canRecordHere(), winSink });
      this.game = game;
      game.onWinRecording = (result, name) => {
        if (result === 'folder') this.toast(`Win saved to your recordings folder: ${name}`, 8000);
        else if (result === 'download') this.toast(`Win saved to your Downloads folder: ${name}`, 8000);
        else if (result === 'error') this.toast('Could not save the win recording', 6000);
      };
      game.onRecordingSaved = (id) => this.toast(`Recording saved: recordings/${id}`, 8000);
      game.onRecordingError = (msg) => this.toast(`Not recording: ${msg}`, 6000);
      this.stopActive = () => game.stop();
      game.onPauseRequest = () => this.pause();
      game.onEnd = (snap, names) => this.matchResult(snap, names, true);
      this.screen(null);
      game.start();
    }, 30)));
  }

  private pause(): void {
    const g = this.game;
    if (!g) return;
    if (this.overlay) { this.resume(); return; }
    g.setPaused(true);
    this.showOverlay(h('div', { class: 'overlay' }, h('div', { class: 'box' },
      h('h2', null, 'PAUSED'),
      bigBtn('RESUME', () => this.resume()),
      bigBtn('SETTINGS', () => { this.showOverlay(null); this.settingsScreen(() => { this.screen(null); this.pause(); }); }),
      bigBtn('QUIT TO MENU', () => { this.showOverlay(null); this.mainMenu(); }))));
  }

  private resume(): void {
    this.showOverlay(null);
    this.game?.setPaused(false);
  }

  stopGame(): void {
    this.showOverlay(null);
    this.stopActive?.();
    this.stopActive = null;
    this.game = null;
  }

  /** Post-match screen (offline and online). */
  matchResult(s: RenderSnap, names: string[], offline: boolean, extra?: { rematch?: () => void; leave: () => void }): void {
    const me = s.cars[s.localIndex];
    const myTeam = me ? me.team : 0;
    const win = s.winner === myTeam;
    let mvp = 0, best = -1;
    s.stats.forEach((st, i) => { if (st.score > best) { best = st.score; mvp = i; } });
    const rows = s.cars.map((c, i) => {
      const st = s.stats[i];
      return h('tr', { class: `t${c.team}${i === mvp ? ' mvp' : ''}` },
        h('td', null, names[i] ?? 'Player'), h('td', null, String(st.score)), h('td', null, String(st.goals)), h('td', null, String(st.saves)), h('td', null, String(st.shots)), h('td', null, String(st.demos)));
    });
    const leave = extra?.leave ?? (() => this.mainMenu());
    const rematch = extra?.rematch ?? (() => this.startOffline(this.lastBot.difficulty, this.lastBot.length));
    this.showOverlay(h('div', { class: 'overlay' }, h('div', { class: 'box', style: 'min-width:620px' },
      h('div', { class: `result ${win ? 'win' : 'loss'}` }, s.winner < 0 ? 'DRAW' : win ? 'VICTORY' : 'DEFEAT'),
      h('div', { style: 'font-size:34px;font-weight:800' }, `${s.score[0]}  –  ${s.score[1]}`),
      h('table', { class: 'res' }, h('tr', null, h('th', null, 'Player'), h('th', null, 'Score'), h('th', null, 'Goals'), h('th', null, 'Saves'), h('th', null, 'Shots'), h('th', null, 'Demos')), ...rows),
      h('div', { class: 'row' }, bigBtn(offline ? 'REMATCH' : 'REMATCH', rematch), bigBtn('LEAVE', leave, true)))));
  }
}

void CAMERA_DEFAULTS; void escapeHtml;
