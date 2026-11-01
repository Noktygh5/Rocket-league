import { ARENA, BALL, CAMERA_DEFAULTS, CAR, CarState, MATCH, NET, PADS, PHYSICS, vec3 } from '@turboball/shared';
import { netCond } from './net/transport';
import type { App } from './ui';

const ROOTS: Record<string, Record<string, unknown>> = { PHYSICS, CAR, BALL, ARENA, PADS, MATCH, NET, CAMERA_DEFAULTS };

const CSS = `
#dev{position:fixed;top:0;right:0;bottom:0;width:360px;background:rgba(5,8,14,.94);z-index:50;overflow:auto;font:12px ui-monospace,Menlo,monospace;color:#d6e4ff;padding:8px;display:none}
#dev.on{display:block} #dev h4{margin:10px 0 4px;color:#ffb066} #dev details{margin-left:8px} #dev summary{cursor:pointer;color:#8fb8ff}
#dev label{display:flex;justify-content:space-between;gap:6px;margin:1px 0} #dev input{width:120px;background:#0d1422;color:#fff;border:1px solid #2a3a58;font:inherit;padding:1px 4px}
#devhud{position:fixed;left:10px;bottom:10px;font:12px/1.5 ui-monospace,Menlo,monospace;background:rgba(0,0,0,.6);padding:8px 12px;white-space:pre;z-index:5;pointer-events:none;display:none;color:#cfe}
`;

/**
 * Dev tools: F2 toggles the live tuning panel (every constant in shared/constants.ts is editable while the
 * game runs) plus a physics debug overlay. Enabled with ?dev or by pressing F2.
 */
export class DevTools {
  private panel: HTMLElement;
  private hud: HTMLElement;
  private built = false;

  constructor(private app: App) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    this.panel = document.createElement('div'); this.panel.id = 'dev';
    this.hud = document.createElement('div'); this.hud.id = 'devhud';
    document.body.append(this.panel, this.hud);
    window.addEventListener('keydown', (e) => { if (e.code === 'F2') { e.preventDefault(); this.toggle(); } });
    if (new URLSearchParams(location.search).has('dev')) this.toggle();
    setInterval(() => this.tickHud(), 100);
  }

  private toggle(): void {
    if (!this.built) this.build();
    this.panel.classList.toggle('on');
    this.hud.style.display = this.panel.classList.contains('on') ? 'block' : 'none';
  }

  private build(): void {
    this.built = true;
    this.panel.append(Object.assign(document.createElement('div'), { textContent: 'DEV PANEL (F2) — edits apply live' }));
    const net = document.createElement('details');
    net.open = true;
    net.innerHTML = '<summary>Network simulator</summary>';
    for (const k of ['latency', 'jitter', 'loss'] as const) net.append(this.field(k + (k === 'loss' ? ' %' : ' ms'), () => netCond[k], (v) => { netCond[k] = v as number; }));
    this.panel.append(net);
    for (const [name, obj] of Object.entries(ROOTS)) this.panel.append(this.tree(name, obj as Record<string, unknown>, true));
  }

  private field(label: string, get: () => number | number[], set: (v: number | number[]) => void): HTMLElement {
    const l = document.createElement('label');
    const i = document.createElement('input');
    const cur = get();
    i.value = Array.isArray(cur) ? cur.join(',') : String(cur);
    i.addEventListener('change', () => {
      if (Array.isArray(get())) {
        const arr = i.value.split(',').map(Number);
        if (arr.every((n) => Number.isFinite(n))) set(arr);
      } else {
        const n = Number(i.value);
        if (Number.isFinite(n)) set(n);
      }
    });
    l.append(Object.assign(document.createElement('span'), { textContent: label }), i);
    return l;
  }

  private tree(name: string, obj: Record<string, unknown>, open = false): HTMLElement {
    const d = document.createElement('details');
    d.open = open;
    d.innerHTML = `<summary>${name}</summary>`;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number') d.append(this.field(k, () => obj[k] as number, (n) => { obj[k] = n; }));
      else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) {
        d.append(this.field(k, () => obj[k] as number[], (n) => { (obj[k] as number[]).splice(0, (obj[k] as number[]).length, ...(n as number[])); }));
      } else if (v && typeof v === 'object' && !Array.isArray(v)) d.append(this.tree(k, v as Record<string, unknown>));
    }
    return d;
  }

  private tickHud(): void {
    if (!this.panel.classList.contains('on')) return;
    const g = this.app.game;
    if (!g) { this.hud.textContent = 'no offline match running'; return; }
    const c: CarState = g.sim.cars[0];
    const sp = vec3.length(c.vel);
    this.hud.textContent =
      `speed      ${sp.toFixed(0)} uu/s${c.supersonic ? '  SUPERSONIC' : ''}\n` +
      `boost      ${c.boost.toFixed(1)}${c.boosting ? '  (burning)' : ''}\n` +
      `grounded   ${c.onGround}  wheels ${c.wheelContacts}\n` +
      `jump used  ${c.jumped}   flip available ${!c.flipUsed && !c.onGround && c.airTime < CAR.jump.secondJumpWindow}\n` +
      `air time   ${c.airTime.toFixed(2)} s   pitch lock ${Math.max(0, c.pitchLock).toFixed(2)} s\n` +
      `flip       ${c.flipActive ? `active ${c.flipTimer.toFixed(2)}s` : 'idle'}\n` +
      `ang vel    ${vec3.length(c.angVel).toFixed(2)} rad/s\n` +
      `pos        ${c.pos.x.toFixed(0)}, ${c.pos.y.toFixed(0)}, ${c.pos.z.toFixed(0)}\n` +
      `ball       ${vec3.length(g.sim.ball.vel).toFixed(0)} uu/s   draw calls ${g.gameView.world.drawCalls}`;
  }
}
