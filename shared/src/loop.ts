import { PHYSICS } from './constants';

/**
 * Fixed-timestep accumulator. Feed it real frame time; it calls `step` zero or more times
 * at exactly PHYSICS.dt and exposes `alpha` (0..1) for render interpolation between the
 * last two physics states. Sub-steps per frame are capped to avoid the spiral of death.
 */
export class FixedStepper {
  alpha = 0;
  /** Total physics ticks executed. */
  tick = 0;
  private acc = 0;

  constructor(
    private readonly dt: number = PHYSICS.dt,
    private readonly maxSubSteps: number = PHYSICS.maxSubSteps,
  ) {}

  /** Returns the number of steps executed. */
  advance(frameDt: number, step: (tick: number) => void): number {
    // A hidden tab can hand us seconds of dt; clamp so we never try to catch up on all of it.
    this.acc += Math.min(frameDt, this.dt * this.maxSubSteps * 2);
    let n = 0;
    while (this.acc >= this.dt && n < this.maxSubSteps) {
      step(this.tick++);
      this.acc -= this.dt;
      n++;
    }
    if (n === this.maxSubSteps && this.acc >= this.dt) this.acc = 0; // drop the backlog
    this.alpha = this.acc / this.dt;
    return n;
  }

  reset(): void {
    this.acc = 0;
    this.alpha = 0;
    this.tick = 0;
  }
}
