// Usage: npm run tuning-doc   -> regenerates /TUNING.md from shared/src/constants.ts (values + comments).
import { readFileSync, writeFileSync } from 'node:fs';

import * as C from '../src/constants';

const src = readFileSync(new URL('../src/constants.ts', import.meta.url), 'utf8').split('\n');

// Walk the source to attach the nearest preceding comment to each dotted key path.
const comments = new Map<string, string>();
const stack: string[] = [];
let pending: string[] = [];
for (const raw of src) {
  const line = raw.trim();
  if (line.startsWith('/**') || line.startsWith('//') || line.startsWith('*')) {
    pending.push(line.replace(/^\/\*\*\s?|\*\/$|^\*\s?|^\/\/\s?/g, '').trim());
    continue;
  }
  const open = line.match(/^export const (\w+)\s*=\s*\{$/) ?? line.match(/^(\w+):\s*\{$/);
  if (open) { stack.push(open[1]); if (pending.length) comments.set(stack.join('.'), pending.join(' ')); pending = []; continue; }
  if (/^\},?;?$/.test(line)) { stack.pop(); pending = []; continue; }
  const kv = line.match(/^(\w+):/);
  if (kv) { if (pending.length) comments.set([...stack, kv[1]].join('.'), pending.join(' ')); }
  pending = [];
}

// Plain-language "if it feels off" hints for the constants people ask about most.
const HINTS: Record<string, string> = {
  'PHYSICS.gravity': 'Everything feels floatier (less negative) or heavier (more negative): jump height, ball hang time, aerial reach.',
  'CAR.drive.throttleAccelCurve': 'Ground acceleration without boost. Raise the first value for snappier launches.',
  'CAR.drive.steerCurve': 'Turning radius by speed. Raise values for tighter turns at that speed.',
  'CAR.drive.brakeDecel': 'How hard S / reverse brakes while moving forward.',
  'CAR.drive.coastDecel': 'How fast the car slows when you let go of the throttle.',
  'CAR.drive.lateralGripRate': 'How quickly sideways sliding is killed. Lower = more slippery.',
  'CAR.drive.handbrakeGripRate': 'Powerslide slipperiness. Lower = longer drifts that keep more speed.',
  'CAR.drive.handbrakeSteerScale': 'Extra turn rate while holding powerslide.',
  'CAR.drive.stickyMax': 'Wall / ceiling hold strength. If you fall off ceilings, raise it.',
  'CAR.boost.accel': 'Boost thrust. Raise for a faster supersonic ramp-up.',
  'CAR.boost.useRate': 'Boost drain per second.',
  'CAR.jump.impulse': 'Instant jump strength (tap-jump height).',
  'CAR.jump.holdAccel': 'Extra push while holding jump (full-jump height).',
  'CAR.jump.secondJumpWindow': 'How long you have to flip after leaving the ground.',
  'CAR.flip.impulse': 'How far a flip launches the car. "Flips feel too strong / weak" -> change this first.',
  'CAR.flip.torquePitch': 'Front/back flip rotation speed.',
  'CAR.flip.torqueRoll': 'Side flip rotation speed.',
  'CAR.flip.zDampFactor': 'Flip hang: lower = car hangs in the air more during a flip.',
  'CAR.flip.pitchLockTime': 'How long pitch control is disabled after a flip.',
  'CAR.air.torque': 'Air control strength per axis (roll / pitch / yaw).',
  'CAR.air.damping': 'How quickly air rotation settles when you stop steering.',
  'CAR.collision.restitution': 'Car bounciness against walls and floor.',
  'BALL.restitution': 'How bouncy the ball is against walls and floor.',
  'BALL.friction': 'How much the ball spins and grips when it rolls or bounces.',
  'BALL.drag': 'Air resistance on the ball.',
  'BALL.carHit.extraImpulseCurve': 'Extra push added to every car hit by relative speed. "Hits feel weak/strong" -> scale this.',
  'BALL.carHit.normalZScale': 'Lower = flatter shots; higher = more upward pops off the car.',
  'BALL.carHit.restitution': 'Rigid-body bounciness of a car-ball contact (before the extra impulse).',
  'CAMERA_DEFAULTS.stiffness': 'How tightly the camera follows the car.',
  'CAMERA_DEFAULTS.swivelSpeed': 'How fast the camera turns to the ball or to the car heading.',
};

const rows: string[] = [];
const fmt = (v: unknown): string => (Array.isArray(v) ? `[${v.join(', ')}]` : String(v));
function walk(path: string, v: unknown): void {
  if (typeof v === 'number' || (Array.isArray(v) && v.every((x) => typeof x === 'number'))) {
    const note = [comments.get(path), HINTS[path]].filter(Boolean).join(' — ');
    rows.push(`| \`${path}\` | \`${fmt(v)}\` | ${note || ''} |`);
  } else if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, c] of Object.entries(v as Record<string, unknown>)) walk(`${path}.${k}`, c);
  }
}
for (const name of ['PHYSICS', 'CAR', 'BALL', 'ARENA', 'PADS', 'SPAWN', 'MATCH', 'CAMERA_DEFAULTS', 'NET'] as const) walk(name, C[name]);

const doc = `# TUNING

Every physical number lives in \`shared/src/constants.ts\`. This table is generated from that file
(\`npm run tuning-doc\`), so it always lists the current values.

**Live tuning:** run the game (\`npm run dev\`), open it with \`?dev\` (or press F2) and edit any value in the
panel; changes apply to the running simulation immediately. The panel also has network-condition sliders
(latency, jitter, loss). Offline matches show a physics debug overlay (speed, boost, grounded, flip state).

**Saying "it feels off":** name the behaviour, find it in the table below, and change that constant.
Quick map:

| Complaint | Start with |
| --- | --- |
| Flips too strong / weak | \`CAR.flip.impulse\`, \`CAR.flip.torquePitch\`, \`CAR.flip.torqueRoll\` |
| Flips hang too long / too short | \`CAR.flip.zDampFactor\`, \`CAR.flip.zDampStart/End\` |
| Car turns too wide / tight | \`CAR.drive.steerCurve\` |
| Powerslide too grippy / too loose | \`CAR.drive.handbrakeGripRate\`, \`CAR.drive.handbrakeSteerScale\` |
| Jump too low / high | \`CAR.jump.impulse\`, \`CAR.jump.holdAccel\` |
| Boost too slow / fast | \`CAR.boost.accel\`, \`CAR.boost.useRate\` |
| Falls off walls or ceiling | \`CAR.drive.stickyMax\`, \`CAR.drive.stickyBase\` |
| Ball too floaty / bouncy | \`PHYSICS.gravity\`, \`BALL.restitution\`, \`BALL.drag\` |
| Hits too weak / strong | \`BALL.carHit.extraImpulseCurve\` |
| Camera too loose / twitchy | \`CAMERA_DEFAULTS.stiffness\`, \`CAMERA_DEFAULTS.swivelSpeed\` |

Bot difficulty (reaction time, prediction horizon, aerials, ...) is configured in \`shared/src/bot/bot.ts\` (\`BOT_CONFIGS\`).

| Constant | Current value | What it changes |
| --- | --- | --- |
${rows.join('\n')}
`;
writeFileSync(new URL('../../TUNING.md', import.meta.url), doc);
console.log(`TUNING.md written (${rows.length} constants)`);
