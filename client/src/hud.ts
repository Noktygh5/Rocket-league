import { CAR, PHYSICS } from '@turboball/shared';
import type { RenderSnap } from './snap';
import { settings } from './settings';

const el = <T extends HTMLElement>(html: string): T => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};

const fmt = (s: number): string => {
  const t = Math.max(0, Math.ceil(s - 1e-6));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** DOM heads-up display. Cheap to update: only touches the DOM when a value changes. */
export class Hud {
  readonly root: HTMLElement;
  private q = <T extends HTMLElement>(sel: string): T => this.root.querySelector(sel) as T;
  private last: Record<string, string> = {};
  private feed: HTMLElement;
  private banner: HTMLElement;
  private countdown: HTMLElement;
  private fpsEl: HTMLElement;
  private ticks: SVGElement[] = [];
  private lit = -1;
  private shown = 0;

  constructor(parent: HTMLElement) {
    this.root = el(`
      <div class="hud">
        <div class="vignette"></div>
        <div class="scorebar">
          <div class="sb blue"><span class="sc" id="sc0">0</span></div>
          <div class="clock" id="clock">5:00</div>
          <div class="sb orange"><span class="sc" id="sc1">0</span></div>
        </div>
        <div class="fps" id="fps"></div>
        <div class="feed" id="feed"></div>
        <div class="countdown" id="countdown"></div>
        <div class="banner" id="banner"></div>
        <div class="ballcam" id="ballcam">BALL CAM</div>
        <div class="notice" id="notice"></div>
        <div class="warn" id="warn">Connection unstable</div>
        <div class="replay-ui" id="replayui"><div class="bar top"></div><div class="bar bottom"></div><div class="tag">REPLAY</div><div class="hint">Press Backspace to skip</div></div>
        <div class="boost">
          <div class="disc"></div><svg viewBox="0 0 120 120" id="ticks"></svg>
          <div class="num" id="boostnum">33</div>
          <div class="spd" id="speed">0 km/h</div>
        </div>
        <div class="board" id="board"></div>
      </div>`);
    parent.appendChild(this.root);
    this.feed = this.q('#feed');
    this.banner = this.q('#banner');
    this.countdown = this.q('#countdown');
    this.fpsEl = this.q('#fps');
    // segmented boost arc: 24 ticks from about 7 o'clock, clockwise over the top, like the real gauge
    const svg = this.root.querySelector('#ticks') as SVGElement;
    const N = 24, start = 212, span = 238;
    for (let i = 0; i < N; i++) {
      const a = ((start + (span * i) / (N - 1)) * Math.PI) / 180;
      const x0 = 60 + Math.sin(a) * 42, y0 = 60 - Math.cos(a) * 42, x1 = 60 + Math.sin(a) * 54, y1 = 60 - Math.cos(a) * 54;
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      t.setAttribute('x1', x0.toFixed(2)); t.setAttribute('y1', y0.toFixed(2)); t.setAttribute('x2', x1.toFixed(2)); t.setAttribute('y2', y1.toFixed(2));
      t.setAttribute('class', 'tick');
      svg.appendChild(t); this.ticks.push(t);
    }
  }

  private set(key: string, node: HTMLElement, text: string): void {
    if (this.last[key] !== text) { this.last[key] = text; node.textContent = text; }
  }

  update(s: RenderSnap, opts: { ballCam: boolean; fps: number; ping: number; unstable: boolean; serverTps: number; replay: boolean; scoreboard: boolean; names: string[] }): void {
    this.set('sc0', this.q('#sc0'), String(s.score[0]));
    this.set('sc1', this.q('#sc1'), String(s.score[1]));
    const clock = this.q('#clock');
    this.set('clock', clock, (s.overtime ? '+' : '') + fmt(s.clock));
    const low = !s.overtime && s.clock <= 10 && s.phase === 1;
    clock.classList.toggle('low', low);
    clock.classList.toggle('ot', s.overtime);

    const me = s.cars[s.localIndex];
    if (me) {
      const b = Math.round(me.boost);
      this.set('boost', this.q('#boostnum'), String(b));
      const f = Math.max(0, Math.min(1, me.boost / CAR.boost.max));
      const n = Math.round(f * this.ticks.length);
      if (n !== this.lit) { this.lit = n; this.ticks.forEach((t, i) => t.classList.toggle('on', i < n)); }
      const box = this.q('.boost');
      box.classList.toggle('low', b < 20);
      box.classList.toggle('team1', me.team === 1);
      box.classList.toggle('full', b >= 99);
      const sp = Math.hypot(me.vx, me.vy, me.vz);
      this.set('speed', this.q('#speed'), settings.speedUnit === 'kmh' ? `${Math.round(sp * 0.036)} km/h` : `${Math.round(sp)} uu/s`);
      this.q('.vignette').classList.toggle('on', me.supersonic);
    }
    this.q('#ballcam').classList.toggle('on', opts.ballCam && !opts.replay);
    this.q('#warn').classList.toggle('on', opts.unstable);
    this.q('#replayui').classList.toggle('on', opts.replay);
    this.root.classList.toggle('replaying', opts.replay);

    this.fpsEl.style.display = settings.showFps || settings.showPing ? 'block' : 'none';
    const parts: string[] = [];
    if (settings.showFps) parts.push(`${Math.round(opts.fps)} FPS`);
    if (settings.showPing && opts.ping >= 0) parts.push(`${Math.round(opts.ping)} ms`);
    if (settings.showPing && opts.serverTps > 0 && opts.serverTps < PHYSICS.tickRate * 0.93) parts.push(`SERVER SLOW ${Math.round((opts.serverTps / PHYSICS.tickRate) * 100)}%`);
    this.set('fps', this.fpsEl, parts.join('  ·  '));

    // countdown
    if (s.phase === 0) {
      const n = Math.ceil(s.countdown);
      if (n !== this.shown && n > 0) { this.shown = n; this.flash(this.countdown, String(n)); }
    } else if (this.shown !== 0) {
      this.shown = 0;
      this.flash(this.countdown, 'GO!');
    }

    // scoreboard
    const board = this.q('#board');
    board.classList.toggle('on', opts.scoreboard);
    if (opts.scoreboard) board.innerHTML = this.boardHtml(s, opts.names);
  }

  private flash(node: HTMLElement, text: string): void {
    node.textContent = text;
    node.classList.remove('pop');
    void node.offsetWidth;
    node.classList.add('pop');
  }

  goal(team: number, scorerName: string): void {
    this.banner.innerHTML = `<div class="g ${team === 0 ? 'b' : 'o'}">GOAL!</div><div class="who">${scorerName ? escapeHtml(scorerName) : ''}</div>`;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
  }
  hideBanner(): void { this.banner.classList.remove('show'); }

  /** Short centre-bottom message (ball cam on/off etc.). */
  notice(text: string): void {
    const n = this.q('#notice');
    n.textContent = text;
    n.classList.remove('show');
    void n.offsetWidth;
    n.classList.add('show');
  }

  killFeed(attacker: string, victim: string, atkTeam: number): void {
    const d = document.createElement('div');
    d.className = `kf t${atkTeam}`;
    d.innerHTML = `<b>${escapeHtml(attacker)}</b> demolished <b>${escapeHtml(victim)}</b>`;
    this.feed.appendChild(d);
    setTimeout(() => d.remove(), 4500);
  }

  private boardHtml(s: RenderSnap, names: string[]): string {
    const rows = (team: number): string => s.cars
      .map((c, i) => ({ c, i }))
      .filter((x) => x.c.team === team)
      .map(({ i }) => {
        const st = s.stats[i];
        return `<tr><td>${escapeHtml(names[i] ?? 'Player')}</td><td>${st?.score ?? 0}</td><td>${st?.goals ?? 0}</td><td>${st?.saves ?? 0}</td><td>${st?.shots ?? 0}</td><td>${st?.demos ?? 0}</td></tr>`;
      }).join('');
    const head = '<tr><th></th><th>Score</th><th>Goals</th><th>Saves</th><th>Shots</th><th>Demos</th></tr>';
    return `<div class="bt"><h3 class="b">BLUE ${s.score[0]}</h3><table>${head}${rows(0)}</table><h3 class="o">ORANGE ${s.score[1]}</h3><table>${head}${rows(1)}</table></div>`;
  }

  show(on: boolean): void { this.root.style.display = on ? 'block' : 'none'; }
  destroy(): void { this.root.remove(); }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
