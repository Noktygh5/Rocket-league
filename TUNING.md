# TUNING

Every physical number lives in `shared/src/constants.ts`. This table is generated from that file
(`npm run tuning-doc`), so it always lists the current values.

**Live tuning:** run the game (`npm run dev`), open it with `?dev` (or press F2) and edit any value in the
panel; changes apply to the running simulation immediately. The panel also has network-condition sliders
(latency, jitter, loss). Offline matches show a physics debug overlay (speed, boost, grounded, flip state).

**Saying "it feels off":** name the behaviour, find it in the table below, and change that constant.
Quick map:

| Complaint | Start with |
| --- | --- |
| Flips too strong / weak | `CAR.flip.impulse`, `CAR.flip.torquePitch`, `CAR.flip.torqueRoll` |
| Flips hang too long / too short | `CAR.flip.zDampFactor`, `CAR.flip.zDampStart/End` |
| Car turns too wide / tight | `CAR.drive.steerCurve` |
| Powerslide too grippy / too loose | `CAR.drive.handbrakeGripRate`, `CAR.drive.handbrakeSteerScale` |
| Jump too low / high | `CAR.jump.impulse`, `CAR.jump.holdAccel` |
| Boost too slow / fast | `CAR.boost.accel`, `CAR.boost.useRate` |
| Falls off walls or ceiling | `CAR.drive.stickyMax`, `CAR.drive.stickyBase` |
| Ball too floaty / bouncy | `PHYSICS.gravity`, `BALL.restitution`, `BALL.drag` |
| Hits too weak / strong | `BALL.carHit.extraImpulseCurve` |
| Camera too loose / twitchy | `CAMERA_DEFAULTS.stiffness`, `CAMERA_DEFAULTS.swivelSpeed` |

Bot difficulty (reaction time, prediction horizon, aerials, ...) is configured in `shared/src/bot/bot.ts` (`BOT_CONFIGS`).

| Constant | Current value | What it changes |
| --- | --- | --- |
| `PHYSICS.tickRate` | `120` | Fixed tick rate. |
| `PHYSICS.dt` | `0.008333333333333333` |  |
| `PHYSICS.maxSubSteps` | `5` | Max sub-steps per rendered frame (spiral-of-death guard). |
| `PHYSICS.gravity` | `-650` | Gravity on Z, shared by car and ball. — Everything feels floatier (less negative) or heavier (more negative): jump height, ball hang time, aerial reach. |
| `CAR.hitboxSize.x` | `118.007` |  |
| `CAR.hitboxSize.y` | `84.1994` |  |
| `CAR.hitboxSize.z` | `36.1591` |  |
| `CAR.hitboxOffset.x` | `13.8757` |  |
| `CAR.hitboxOffset.y` | `0` |  |
| `CAR.hitboxOffset.z` | `20.755` |  |
| `CAR.mass` | `180` |  |
| `CAR.restHeight` | `37.77` | Resting hitbox-centre (= centre of mass) height above the floor; body origin rests at 17.01. |
| `CAR.maxAngularSpeed` | `5.5` |  |
| `CAR.maxAngularSpeedGround` | `14` | Angular speed cap while wheels are on a surface (needed to follow the 256 uu ramps at speed). |
| `CAR.maxSpeed` | `2300` |  |
| `CAR.supersonicOn` | `2200` |  |
| `CAR.supersonicOff` | `2100` |  |
| `CAR.wheels.front.radius` | `12.5` |  |
| `CAR.wheels.front.restLength` | `38.755` |  |
| `CAR.wheels.front.connection.x` | `51.25` |  |
| `CAR.wheels.front.connection.y` | `25.9` |  |
| `CAR.wheels.front.connection.z` | `20.755` |  |
| `CAR.wheels.rear.radius` | `15` |  |
| `CAR.wheels.rear.restLength` | `37.055` |  |
| `CAR.wheels.rear.connection.x` | `-33.75` |  |
| `CAR.wheels.rear.connection.y` | `29.5` |  |
| `CAR.wheels.rear.connection.z` | `20.755` |  |
| `CAR.wheels.suspensionStiffness` | `500` |  |
| `CAR.wheels.dampingCompression` | `25` |  |
| `CAR.wheels.dampingRelaxation` | `40` |  |
| `CAR.wheels.maxTravel` | `12` |  |
| `CAR.drive.throttleAccelCurve` | `[0, 1600, 1400, 160, 1410, 0]` | Throttle accel (uu/s^2) by forward speed: 1600 at 0, 160 at 1400, 0 at 1410. — Ground acceleration without boost. Raise the first value for snappier launches. |
| `CAR.drive.brakeDecel` | `3500` | How hard S / reverse brakes while moving forward. |
| `CAR.drive.coastDecel` | `525` | How fast the car slows when you let go of the throttle. |
| `CAR.drive.steerCurve` | `[0, 0.5336, 500, 0.3193, 1000, 0.182, 1500, 0.1078, 1750, 0.085, 3000, 0.0345]` | Front-wheel steer angle (rad) by forward speed (uu/s). — Turning radius by speed. Raise values for tighter turns at that speed. |
| `CAR.drive.lateralGripRate` | `60` | Lateral friction scale: normal vs powersliding. Lateral velocity decay rate (1/s): gripping vs powersliding. — How quickly sideways sliding is killed. Lower = more slippery. |
| `CAR.drive.handbrakeGripRate` | `0.6` | Powerslide slipperiness. Lower = longer drifts that keep more speed. |
| `CAR.drive.steerResponse` | `30` | How fast yaw rate converges to the steering target (1/s). |
| `CAR.drive.jumpGroundLockout` | `0.06` | Seconds after a jump during which wheel contact is ignored. |
| `CAR.drive.wheelbase` | `85` | Wheelbase used for steering: curvature = tan(steerAngle) / wheelbase. |
| `CAR.drive.handbrakeSteerScale` | `1.4` | Extra turn rate while holding powerslide. |
| `CAR.drive.stickyBase` | `0.5` | Sticky force relative to gravity: base with 3 wheels, up to max with 4. |
| `CAR.drive.stickyMax` | `1.5` | Wall / ceiling hold strength. If you fall off ceilings, raise it. |
| `CAR.drive.minWheelsForSticky` | `3` |  |
| `CAR.boost.max` | `100` |  |
| `CAR.boost.start` | `33` |  |
| `CAR.boost.useRate` | `33.333` | Boost drain per second. |
| `CAR.boost.accel` | `991.667` | Boost thrust. Raise for a faster supersonic ramp-up. |
| `CAR.boost.minHoldTime` | `0.1` | A press consumes at least this long. |
| `CAR.jump.impulse` | `291.667` | Instant jump strength (tap-jump height). |
| `CAR.jump.holdAccel` | `1458.33` | Extra push while holding jump (full-jump height). |
| `CAR.jump.holdMaxTime` | `0.2` |  |
| `CAR.jump.holdMinTime` | `0.025` |  |
| `CAR.jump.secondJumpWindow` | `1.25` | Window after leaving the ground in which the second jump is allowed. — How long you have to flip after leaving the ground. |
| `CAR.flip.impulse` | `500` | Impulse magnitude of a directional flip (horizontal, uu/s). — How far a flip launches the car. "Flips feel too strong / weak" -> change this first. |
| `CAR.flip.forwardScaleCurve` | `[0, 1, 1400, 0.7, 2300, 0.55]` | Forward flip impulse scale by forward speed so it's strongest near standing speeds. |
| `CAR.flip.sideScale` | `0.9` |  |
| `CAR.flip.backwardScale` | `0.85` |  |
| `CAR.flip.duration` | `0.65` |  |
| `CAR.flip.torquePitch` | `224` | Front/back flip rotation speed. |
| `CAR.flip.torqueRoll` | `260` | Side flip rotation speed. |
| `CAR.flip.minTorqueTime` | `0.5` |  |
| `CAR.flip.maxAngularSpeed` | `8.5` | Angular speed cap while a flip is rotating (the normal 5.5 cap makes flips far too slow). |
| `CAR.flip.zDampFactor` | `0.35` | Vertical velocity damping ("flip hang"). — Flip hang: lower = car hangs in the air more during a flip. |
| `CAR.flip.zDampStart` | `0.15` |  |
| `CAR.flip.zDampEnd` | `0.21` |  |
| `CAR.flip.pitchLockTime` | `1` | Pitch input is ignored after a flip. — How long pitch control is disabled after a flip. |
| `CAR.flip.pitchLockExtra` | `0.1` |  |
| `CAR.flip.deadzone` | `0.5` | Input magnitude that counts as a directional flip. |
| `CAR.flip.cancelThreshold` | `0.5` | Opposite pitch input above this magnitude cancels the flip rotation. |
| `CAR.flip.rotationDamping` | `3.5` | Pitch/roll damping while a flip coasts (flip + pitch lock). Lower = more rotation after the torque stops. |
| `CAR.recovery.roofJumpScale` | `1.6` | Jump strength when resting on the roof, relative to a normal jump. |
| `CAR.recovery.uprightThreshold` | `0.35` | The reset-upright button only works when the car's up axis is below this (z component), i.e. clearly tipped over. |
| `CAR.recovery.cooldown` | `1` | Seconds before the reset-upright button can be used again. |
| `CAR.recovery.autoRightDelay` | `0.55` | A car resting tipped over for this long (s) hops and rolls itself back onto its wheels. |
| `CAR.recovery.autoRightHop` | `230` | Hop strength (uu/s) away from the surface when auto-righting starts. |
| `CAR.recovery.autoRightRate` | `6.5` | Roll speed (rad/s) used while auto-righting. |
| `CAR.air.torque.roll` | `36.08` |  |
| `CAR.air.torque.pitch` | `12.15` |  |
| `CAR.air.torque.yaw` | `8.92` |  |
| `CAR.air.damping.roll` | `4.47` |  |
| `CAR.air.damping.pitch` | `2.8` |  |
| `CAR.air.damping.yaw` | `1.89` |  |
| `CAR.air.throttleAccel` | `66.667` |  |
| `CAR.collision.restitution` | `0.25` | Car vs arena. — Car bounciness against walls and floor. |
| `CAR.collision.friction` | `0.3` |  |
| `CAR.collision.arenaTolerance` | `1.6` | Hitbox points may sink this far into a surface before colliding (wheel clearance). |
| `CAR.collision.restitutionSpeedThreshold` | `120` | Below this closing speed collisions are perfectly inelastic. |
| `CAR.collision.carRestitution` | `0.35` | Car vs car. |
| `CAR.demo.minSpeed` | `2200` | Attacker speed required for a demolition. |
| `CAR.demo.respawnTime` | `3` |  |
| `BALL.radius` | `91.25` |  |
| `BALL.mass` | `30` |  |
| `BALL.maxSpeed` | `6000` |  |
| `BALL.maxAngularSpeed` | `6` |  |
| `BALL.spawn.x` | `0` |  |
| `BALL.spawn.y` | `0` |  |
| `BALL.spawn.z` | `92.75` |  |
| `BALL.drag` | `0.03` | Linear drag factor. — Air resistance on the ball. |
| `BALL.restitution` | `0.6` | How bouncy the ball is against walls and floor. |
| `BALL.friction` | `0.35` | How much the ball spins and grips when it rolls or bounces. |
| `BALL.carHit.restitution` | `0` | Restitution of the plain rigid-body part of a car hit (extra impulse adds the rest). — Rigid-body bounciness of a car-ball contact (before the extra impulse). |
| `BALL.carHit.friction` | `0.2` |  |
| `BALL.carHit.extraImpulseCurve` | `[0, 0.65, 500, 0.65, 2300, 0.55, 4600, 0.3]` | Extra impulse scale by relative speed (uu/s). — Extra push added to every car hit by relative speed. "Hits feel weak/strong" -> scale this. |
| `BALL.carHit.normalZScale` | `0.35` | Multiplier on contact-normal Z when forming the extra-impulse direction. — Lower = flatter shots; higher = more upward pops off the car. |
| `BALL.carHit.forwardScale` | `0.65` | Blend toward car-forward for the extra impulse. |
| `ARENA.halfWidth` | `4096` |  |
| `ARENA.halfLength` | `5120` |  |
| `ARENA.ceilingHeight` | `2044` |  |
| `ARENA.rampRadius` | `256` | Floor-wall and wall-ceiling ramp radius. |
| `ARENA.cornerRadius` | `1152` | Plan-view radius of the four vertical corners. |
| `ARENA.goal.halfWidth` | `893` |  |
| `ARENA.goal.height` | `642.775` |  |
| `ARENA.goal.depth` | `880` |  |
| `ARENA.goal.backY` | `6000` | Net extends to |y| = backY. |
| `ARENA.goal.postRadius` | `20` |  |
| `PADS.large.amount` | `100` |  |
| `PADS.large.respawn` | `10` |  |
| `PADS.large.radius` | `208` |  |
| `PADS.large.height` | `168` |  |
| `PADS.small.amount` | `12` |  |
| `PADS.small.respawn` | `4` |  |
| `PADS.small.radius` | `144` |  |
| `PADS.small.height` | `165` |  |
| `SPAWN.z` | `17` | Car body-origin height at spawn. |
| `SPAWN.countdown` | `3` |  |
| `MATCH.length` | `300` |  |
| `MATCH.goalCelebration` | `3` |  |
| `MATCH.replaySeconds` | `6` |  |
| `CAMERA_DEFAULTS.fov` | `110` |  |
| `CAMERA_DEFAULTS.distance` | `270` |  |
| `CAMERA_DEFAULTS.height` | `100` |  |
| `CAMERA_DEFAULTS.angle` | `-3` |  |
| `CAMERA_DEFAULTS.stiffness` | `0.45` | How tightly the camera follows the car. |
| `CAMERA_DEFAULTS.swivelSpeed` | `4.5` | How fast the camera turns to the ball or to the car heading. |
| `CAMERA_DEFAULTS.transitionSpeed` | `1.2` |  |
| `NET.protocolVersion` | `1` |  |
| `NET.inputRate` | `60` |  |
| `NET.snapshotRate` | `60` |  |
| `NET.inputRedundancy` | `3` |  |
| `NET.jitterBufferTicks` | `2` |  |
| `NET.interpDelaySnapshots` | `2` |  |
| `NET.maxPlayersPerRoom` | `4` |  |
