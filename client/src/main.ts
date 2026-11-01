import { FixedStepper, PHYSICS } from '@turboball/shared';

// Phase 1 smoke page: proves the shared package loads in the browser and the fixed stepper runs.
const out = document.getElementById('out')!;
const stepper = new FixedStepper();
let last = performance.now();

function frame(now: number): void {
  const steps = stepper.advance((now - last) / 1000, () => {});
  last = now;
  out.textContent = `TURBOBALL\nphysics ${PHYSICS.tickRate} Hz | tick ${stepper.tick} | steps this frame ${steps} | alpha ${stepper.alpha.toFixed(2)}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
