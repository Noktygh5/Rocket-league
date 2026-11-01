# DECISIONS

Ambiguities resolved by picking the option closest to the reference game. Newest at the bottom.

## Phase 1

- **Math style:** classes (`Vec3`, `Quat`, `Mat3`) hold plain fields; operations live in `vec3` / `quat` / `mat3` namespaces and write into an `out` argument (aliasing allowed except `mat3.mul` and `mat3.transpose`). No allocation in hot paths.
- **Quaternion convention:** `(x, y, z, w)`, `mul(a, b)` applies `b` first. `quat.integrate` takes a world-space angular velocity.
- **Mat3:** row-major `Float64Array`. Columns of a rotation matrix are the body axes: 0 = forward (+X body), 1 = right (+Y body), 2 = up (+Z body).
- **Tick rate:** 120 Hz fixed. `FixedStepper` clamps one frame's dt to `2 * maxSubSteps * dt`, then caps sub-steps at 5. If the cap is hit with time left over, the backlog is dropped rather than carried over, so a stalled tab doesn't cause a catch-up burst.
- **Constants:** all in `shared/src/constants.ts`. Curves are flat `[x0, y0, x1, y1, ...]` arrays read by `curve()`. Values the brief gave only as "about" (flip scales, car collision restitution/friction, handbrake friction, steer scale while sliding) are first guesses and are the first candidates for the phase 12 tuning pass.
- **Flip forward scale curve:** brief says forward flips "scale with current forward speed" without numbers; started with 1.0 at 0, 0.7 at 1400, 0.55 at 2300.
- **Kickoff yaws:** diagonal spots face the ball (45° / 135°), the three back spots face +Y (90°). Blue spawns face +Y; Orange mirrors position and yaw through the origin.
- **Pad list:** stored as a half-field base table and expanded by `mirrorPads()`, which skips duplicates when a coordinate is 0. Unit-tested at exactly 6 large and 28 small.
- **Naming:** the product name is TURBOBALL; the car is "Striker". No third-party game names appear in code or package names.
- **Tooling:** npm workspaces, TypeScript project config shared via `tsconfig.base.json`, Vitest for `/shared` only, `tsx` for running the server in dev.

## Phases 2-12

### Physics model
- **Hitbox centre = centre of mass**, resting 37.77 uu above the floor (the 17.01 "root" height plus the 20.755 hitbox offset). The brief's raw suspension numbers are not self-consistent in a plain Bullet model, so the wheel rays keep the brief's radii, connection x/y, stiffness (500), damping (25/40) and travel (12), but the spring's reference length is derived from the resting height. Spring force is mass-scaled like Bullet's (stiffness x compression = acceleration).
- **Ground driving is not a literal wheel-friction model.** Throttle, brake and coast accelerations follow the brief's curves exactly. Steering sets the yaw rate about the surface normal to `speed * tan(steerAngle) / wheelbase` (the brief's steer table matches curvature = tan(angle)/85 uu). Lateral grip is an exponential decay of sideways velocity (`lateralGripRate`, much lower while powersliding).
- **Boost from rest reaches 2200 uu/s in ~2 s, not the ~3.5-4 s the brief estimated.** With the brief's own numbers (throttle curve 1600->0 plus 991.667 boost accel) the maths gives ~1.7-2 s to supersonic; the test accepts 1-4 s. If it feels too quick, lower `CAR.boost.accel` or the throttle curve while boosting.
- **Angular speed cap:** 5.5 rad/s in the air, but 14 rad/s while any wheel touches a surface; otherwise a 256 uu ramp cannot be followed at speed and cars fly off at the wall-to-ceiling transition.
- **Sticky force** scales with how far the surface normal is from floor-up: `stickyBase` (0.5 g) on the floor up to `stickyMax` (1.5 g) on walls and ceiling.
- **Ground contact reach:** wheels count as touching while the hitbox centre is within `maxTravel` (12 uu) of its resting height; after a jump wheel contact is ignored for 0.06 s so the jump isn't immediately re-grounded.
- **Flips:** direction uses the car's forward axis flattened onto the horizontal plane. Rotation is angular acceleration about local pitch/roll axes for 0.41 s (saturating at 5.5 rad/s). Cancel = opposite pitch input past the threshold. Pitch input is locked for `pitchLockTime + pitchLockExtra` = 1.1 s.
- **Car-ball hit:** rigid contact with restitution 0 plus the brief's extra impulse. The extra direction is the contact normal with local Z scaled by 0.35, nudged toward car-forward by `forwardScale`. A touch on the underside of a flying car restores its flip.
- **Demolition:** attacker must be supersonic and the contact point in the front 35% of its hitbox. If both qualify the faster car wins. Victim respawns at its kickoff spot after 3 s.
- **Car vs car** is a full 15-axis SAT with an impulse response; the contact point is the midpoint of each box's closest point to the other's centre.
- **Arena:** analytic SDF = rounded box (plan corners 1152, ramps 256) unioned with a goal box behind each back wall. Goal posts/crossbar are the sharp edges of the opening rather than separate 40 uu cylinders (visual posts are drawn). Ball is a goal when fully past the line (centre beyond 5120 + radius).

### Match flow
- Goal pause = 3 s celebration (first 1.6 s in slow motion, offline) + 6 s replay + 1 s, then the 3-2-1 countdown.
- Overtime is sudden death with the clock counting up. If regulation ends with the ball in the air the match plays on until the ball touches down (or someone scores).
- Kickoff: 1v1 uses a diagonal spot chosen with the seeded PRNG; 2v2 assigns slots to the five standard spots in order.
- Boost pads are only consumed by cars below 100 boost.

### Bots
- Same input struct and physics as a human; difficulty is one config object each (`BOT_CONFIGS`): reaction delay by queuing inputs, prediction horizon, speed cap, aerial skill, dodge chance, steering noise, mis-timing, boost policy.
- 50-match ladder (120 s matches): Medium beats Easy 22-9, Hard beats Medium 25-8, Hard beats Easy 27-7 (`npm run ladder`).
- Bots are 1v1 only. The dev "debug bot view" is limited to `bot.debug` (mode and target) exposed for tooling; there is no 3D overlay.

### Netcode
- Lobby/control messages are small JSON text frames; only inputs and snapshots are packed binary (DataView). Events are JSON sent immediately (WebSocket is reliable and ordered, so "reliable events" are free).
- Inputs are tagged with the server tick they should apply to. The client estimates the server tick from ping/pong (lowest-RTT samples), runs `rtt/2 + 4` ticks ahead, sends 60 Hz packets carrying the last 4 inputs; the server holds a per-player tick map and repeats the last input when one is missing.
- Inputs are quantised to int8 on the client before being predicted, so client and server simulate identical values.
- Reconciliation replays unacknowledged inputs on every snapshot; errors under 350 uu blend over ~100 ms, larger ones snap (demos, kickoffs). Remote cars are held as zero-input in the predicted sim and rendered by interpolation (2 snapshots behind, 150 ms extrapolation cap).
- "Packet loss" in the dev simulator drops binary game packets only (WebSocket itself never loses data). The automated net test runs a server and client in-process with 100 ms RTT, jitter and 2% loss, and at 200 ms / 5%.
- 1v1 forfeit: if a player is gone for 10 s the remaining player wins. In 2v2 a leaver's car idles and the match continues.
- Server limits: 100 rooms, 400 connections, per-connection token buckets for JSON and binary traffic, 4 KB payload cap, name sanitising, input range clamping, future-tick cap. Empty rooms expire after 30 s.

### Rendering and UI
- All geometry is generated: arena from the same profile constants as the collision SDF, a low-poly "Striker" (~700 triangles), instanced stands/crowd, pads and light bars. One shadow-casting light for cars and ball, bloom on Medium/High, pixel ratio capped at 1.5, automatic quality drop after 5 s below 45 FPS.
- Camera defaults match the brief. FOV is treated as horizontal and converted to vertical for the aspect ratio. Ball-cam pitch is clamped (-25 deg to +32 deg) so the car stays in frame; the camera is pushed back inside the arena by the SDF so it never clips walls.
- Keyboard digital axes are smoothed only at the sampling layer (rise ~14/s, fall ~24/s).
- The wall/ceiling profile and car silhouette come from the written visual brief (no reference images were supplied).

### Tooling
- `TUNING.md` is generated from `constants.ts` so it cannot drift; the in-game dev panel (F2 or `?dev`) edits the same objects live.

## Round 2: fixes after playtesting, using the reference gameplay video

Findings from the video (a 1v1 match, ~7 min): open-air stadium with a sunset sky and no visible ceiling; striped grass with white lines and orange hexagonal pads; a solid, team-coloured lower wall with a see-through wire cage above it; chunky car with a ring marker under the player's car; large orange boost flame; two white light trails at supersonic; a low chase camera that tilts with the car on walls; flips that complete a full rotation and land on the wheels in under ~1.2 s.

- **Stuck upside down (fixed):** the hitbox now reports contact with the arena. A car resting on its roof regains its jump and flip, and pressing jump pushes it off the surface (1.6x a normal jump) so it can air-roll (Q/E) back onto its wheels. Tests cover jump + roll recovery and roll-only recovery.
- **Flip rotation (fixed):** flips were capped at 5.5 rad/s and damped hard, so they stopped mid-turn and the car landed on its side or back. Flips now allow 8.5 rad/s, apply torque for 0.5 s, then coast with `CAR.flip.rotationDamping` = 3.5. Measured with a tuning sweep: upside-down at ~0.5 s, back on the wheels by ~1.1 s, for front, back, left and right flips (tests added for all four).
- **Wheel spin (fixed):** the model spun the tyre around the wrong axis. Wheels are now steer-group > spin-group > tyre with five visible spokes; spin is about the axle and direction follows rolling-without-slip; front wheels steer correctly.
- **Wall camera tilt (fixed):** the camera "up" was snapping between the surface normal and world-up as wheel contact flickered, and a straight lerp collapses on the ceiling. It now uses a smoothed on-surface weight (with hysteresis), spherical interpolation, and never tilts more than 65 degrees from upright. Sampled wall climb: max change 14 degrees per 100 ms (was 57), horizon never inverted.
- **Look:** open sky dome, no rendered ceiling, striped grass, team-coloured solid lower walls with a wire cage above, floodlight towers, hills, bigger stands, orange hex pads, dark gunmetal ball with cyan glow, white supersonic ribbons, bigger boost flame, ring marker under the local car. All art remains original and procedural.
- **Bots:** the physics changes shifted the ladder, so bots now slow their approach when misaligned. Current 50-match ladder (120 s matches): Medium beats Easy 20-11, Hard beats Medium 22-11, Hard beats Easy 28-6.

## Round 3: reset key, automatic righting, closer match to the footage

- **R = "Reset car upright"** (rebindable). Works only when the car is tipped over (up axis z < 0.35) and touching a surface, keeps position and heading, 1 s cooldown, runs on the server too (new input flag). Backspace is the only skip-replay key now (R also skips while a replay is playing).
- **Automatic righting** (like the real game): a car that comes to rest tipped over (roof or side) for 0.55 s hops (230 uu/s away from the surface) and rolls itself back onto its wheels (6.5 rad/s about the roof-to-up axis, about the forward axis when exactly inverted), then stops when upright. No input needed. Constants: `CAR.recovery.autoRightDelay / autoRightHop / autoRightRate`. Tests: lands on roof, lies on side, no trigger on upright cars or within the delay.
- **Footage analysis (10 fps burst of a flip, 79.6-82.6 s of the reference video):** the car completes a flip and is level again within ~0.5 s of the flip's peak, the white ring decal stays on the ground under the player's car even while airborne, boost ignition produces big yellow-orange fireballs, tail lights glow red, and the pitch is dark and desaturated. Applied: ground ring (3 concentric rings, shrinks/fades with height), fireball puffs on boost ignition plus a trailing puff stream, red tail lights, a darker moodier grass colour, redder orange paint, darker team walls.
- **Jump/flip timing vs the footage:** the footage can only be compared by eye at 10 fps, so flip timing was tuned numerically (full rotation, upright by ~1.1 s) rather than frame-matched. If a specific flip still feels off, `CAR.flip.*` in the dev panel (F2) is the place to adjust it.
- Bot ladder after these changes (50 matches, 120 s): Medium beats Easy 23-8, Hard beats Medium 22-8, Hard beats Easy 22-10.
