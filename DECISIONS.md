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
