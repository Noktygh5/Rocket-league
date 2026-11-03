import { CarInput } from '@turboball/shared';
import { Action, ACTIONS, settings } from './settings';

/** Fixed secondary keys that always work alongside the rebindable ones. */
const ALT_KEYS: Partial<Record<Action, string>> = { boost: 'KeyN', powerslide: 'KeyJ' };

/**
 * Keyboard sampler. Called once per physics tick; digital keys are smoothed here (never in the
 * sim) so the server sees exactly the inputs the client simulated.
 */
export class InputSampler {
  private down = new Set<string>();
  private axes = { throttle: 0, steer: 0, roll: 0 };
  rearView = false;
  scoreboard = false;
  /** Fired on key-down edges. */
  onAction: ((a: Action) => void) | null = null;
  enabled = true;
  /** Axis ramp rates (1/s): reach full deflection in ~1/rise s, release in ~1/fall s. */
  rise = 14;
  fall = 24;

  private readonly kd = (e: KeyboardEvent): void => {
    if (!this.enabled && e.code !== settings.keys.pause) return;
    const a = this.actionFor(e.code);
    if (a || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    if (a) this.onAction?.(a);
    if (a === 'scoreboard') this.scoreboard = true;
  };
  private readonly ku = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
    if (this.actionFor(e.code) === 'scoreboard') this.scoreboard = false;
  };
  private readonly md = (e: MouseEvent): void => { if (e.button === 2) this.rearView = true; };
  private readonly mu = (e: MouseEvent): void => { if (e.button === 2) this.rearView = false; };
  private readonly cm = (e: Event): void => e.preventDefault();
  private readonly blur = (): void => this.releaseAll();

  attach(): void {
    window.addEventListener('keydown', this.kd);
    window.addEventListener('keyup', this.ku);
    window.addEventListener('mousedown', this.md);
    window.addEventListener('mouseup', this.mu);
    window.addEventListener('contextmenu', this.cm);
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.blur);
  }
  detach(): void {
    window.removeEventListener('keydown', this.kd);
    window.removeEventListener('keyup', this.ku);
    window.removeEventListener('mousedown', this.md);
    window.removeEventListener('mouseup', this.mu);
    window.removeEventListener('contextmenu', this.cm);
    window.removeEventListener('blur', this.blur);
    document.removeEventListener('visibilitychange', this.blur);
  }

  releaseAll(): void {
    this.down.clear();
    this.rearView = false;
    this.scoreboard = false;
    this.axes.throttle = 0; this.axes.steer = 0; this.axes.roll = 0;
  }

  private actionFor(code: string): Action | null {
    for (const a of ACTIONS) if (settings.keys[a] === code) return a;
    return null;
  }
  private held(a: Action): boolean {
    return this.down.has(settings.keys[a]) || (ALT_KEYS[a] !== undefined && this.down.has(ALT_KEYS[a]!));
  }

  private approach(v: number, target: number, dt: number): number {
    const rate = target === 0 ? this.fall : target * v < 0 ? this.rise * 2 : this.rise;
    const d = target - v;
    const step = rate * dt;
    return Math.abs(d) <= step ? target : v + Math.sign(d) * step;
  }

  /** Writes one tick of input into `out`. */
  sample(out: CarInput, dt: number): CarInput {
    if (!this.enabled) return out.clear();
    const t = (this.held('throttle') ? 1 : 0) - (this.held('reverse') ? 1 : 0);
    const s = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    const r = (this.held('rollRight') ? 1 : 0) - (this.held('rollLeft') ? 1 : 0);
    this.axes.throttle = this.approach(this.axes.throttle, t, dt);
    this.axes.steer = this.approach(this.axes.steer, s, dt);
    this.axes.roll = this.approach(this.axes.roll, r, dt);
    out.throttle = this.axes.throttle;
    out.steer = this.axes.steer;
    out.yaw = this.axes.steer;
    out.pitch = this.axes.throttle; // W = nose down, S = nose up
    out.roll = this.axes.roll;
    out.jump = this.held('jump');
    out.boost = this.held('boost');
    out.handbrake = this.held('powerslide');
    return out;
  }
}
