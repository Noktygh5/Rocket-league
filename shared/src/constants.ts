// Every tunable number lives here. Units: "uu" (1 uu ~ 1 cm), seconds, radians.
// Sim axes: X right, Y toward Orange goal, Z up. Curves are flat [x0, y0, x1, y1, ...] tables
// consumed by `curve()` in math/scalar.ts.

/** Beta 3v3 map: the standard field (8192 x 10240) scaled in plan view. Goals, ceiling and ramps keep their size. */
export const MAP_SCALE = 1.5;

export const PHYSICS = {
  /** Fixed tick rate. */
  tickRate: 120,
  dt: 1 / 120,
  /** Max sub-steps per rendered frame (spiral-of-death guard). */
  maxSubSteps: 5,
  /** Gravity on Z, shared by car and ball. */
  gravity: -650,
};

export const CAR = {
  /** Hitbox size (length, width, height). */
  hitboxSize: { x: 118.007, y: 84.1994, z: 36.1591 },
  /** Hitbox centre offset from the body origin. */
  hitboxOffset: { x: 13.8757, y: 0, z: 20.755 },
  mass: 180,
  /** Resting hitbox-centre (= centre of mass) height above the floor; body origin rests at 17.01. */
  restHeight: 37.77,
  maxAngularSpeed: 5.5,
  /** Angular speed cap while wheels are on a surface (needed to follow the 256 uu ramps at speed). */
  maxAngularSpeedGround: 14,
  maxSpeed: 2300,
  supersonicOn: 2200,
  supersonicOff: 2100,

  wheels: {
    front: { radius: 12.5, restLength: 38.755, connection: { x: 51.25, y: 25.9, z: 20.755 } },
    rear: { radius: 15.0, restLength: 37.055, connection: { x: -33.75, y: 29.5, z: 20.755 } },
    suspensionStiffness: 500,
    dampingCompression: 25,
    dampingRelaxation: 40,
    maxTravel: 12,
  },

  drive: {
    /** Throttle accel (uu/s^2) by forward speed: 1600 at 0, 160 at 1400, 0 at 1410. */
    throttleAccelCurve: [0, 1600, 1400, 160, 1410, 0],
    brakeDecel: 3500,
    coastDecel: 525,
    /** Front-wheel steer angle (rad) by forward speed (uu/s). */
    steerCurve: [0, 0.5336, 500, 0.3193, 1000, 0.182, 1500, 0.1078, 1750, 0.085, 3000, 0.0345],
    /** Lateral friction scale: normal vs powersliding. */
    /** Lateral velocity decay rate (1/s): gripping vs powersliding. */
    lateralGripRate: 60,
    /** Lateral grip rate (1/s) at full powerslide; 10% of the normal rate. */
    handbrakeGripRate: 6,
    /** Hard cap on sideways deceleration (uu/s^2): normal grip vs 10% of it at full powerslide (friction is force-limited). */
    lateralMaxDecel: 12000,
    /** Speed lost while cornering: decel = factor * lateral acceleration. Tuned so full-lock turning settles near 1234 uu/s. */
    turnDrag: 0.095,
    /** Roll levelling while driving on a surface (rad/s^2 per unit of sideways tilt) and extra roll damping (1/s). Keeps the car from sitting tilted on three wheels. */
    rollLevel: 40,
    rollDamping: 7,
    /** Planting: while on a surface the car's up axis is pulled onto the surface normal and tilt spin is killed. */
    plantLevel: 150,
    plantDamping: 18,
    powerslideGripFactor: 0.1,
    /** Powerslide input ramps up / down at these rates (1/s). */
    powerslideRise: 5,
    powerslideFall: 2,
    /** Steer angle (rad) by speed while powersliding. */
    powerslideSteerCurve: [0, 0.39235, 2500, 0.1261],
    /** How fast yaw rate converges to the steering target (1/s). */
    steerResponse: 30,
    /** Seconds after a jump during which wheel contact is ignored. */
    jumpGroundLockout: 0.06,
    /** Wheelbase used for steering: curvature = tan(steerAngle) / wheelbase. */
    wheelbase: 85,
    /** Sticky force relative to gravity: base with 3 wheels, up to max with 4. */
    stickyBase: 0.5,
    stickyMax: 1.5,
    minWheelsForSticky: 3,
  },

  boost: {
    max: 100,
    start: 33.333,
    useRate: 33.333,
    accel: 991.667,
    /** Thrust while airborne. */
    airAccel: 1058.333,
    /** A press consumes at least this long. */
    minHoldTime: 0.1,
  },

  jump: {
    impulse: 291.667,
    holdAccel: 1458.33,
    holdMaxTime: 0.2,
    holdMinTime: 0.025,
    /** Window after leaving the ground in which the second jump is allowed. */
    secondJumpWindow: 1.25,
  },

  flip: {
    /** Impulse magnitude of a directional flip (horizontal, uu/s). */
    impulse: 500,
    /** Forward flip impulse scale by forward speed so it's strongest near standing speeds. */
    /** Impulse multipliers at max speed (1 = no speed dependence). Scale grows linearly with |forward speed| / 2300. */
    forwardMaxSpeedScale: 1.0,
    sideMaxSpeedScale: 1.9,
    backwardMaxSpeedScale: 2.5,
    /** Extra multiplier on backward flips. */
    backwardScaleX: 16 / 15,
    duration: 0.65,
    torquePitch: 224,
    torqueRoll: 260,
    minTorqueTime: 0.5,
    /** Angular speed cap while a flip is rotating (the normal 5.5 cap makes flips far too slow). */
    maxAngularSpeed: 8.5,
    /** Vertical velocity damping ("flip hang"). */
    /** Per-tick (at 120 Hz) fractional vertical-speed loss during the hang window: vz *= 1 - factor * dt * 120. */
    zDampFactor: 0.35,
    zDampStart: 0.15,
    zDampEnd: 0.21,
    /** Pitch input is ignored after a flip. */
    pitchLockTime: 1.0,
    pitchLockExtra: 0.3,
    /** Input magnitude that counts as a directional flip. */
    deadzone: 0.5,
    /** Opposite pitch input above this magnitude cancels the flip rotation. */
    cancelThreshold: 0.5,
    /** Pitch/roll damping while a flip coasts (flip + pitch lock). Lower = more rotation after the torque stops. */
    rotationDamping: 3.5,
  },

  recovery: {
    /** Jump strength when resting on the roof, relative to a normal jump. */
    roofJumpScale: 1.6,
    /** A car resting tipped over for this long (s) hops and rolls itself back onto its wheels. */
    autoRightDelay: 0.25,
    /** Hop strength (uu/s) away from the surface when auto-righting starts. */
    autoRightHop: 230,
    /** Roll speed (rad/s) used while auto-righting. */
    autoRightRate: 6.5,
    /** In-air self-levelling blend rate (1/s) when the player gives no steering input; 0 disables it. */
    airLevel: 7,
    /** Fastest in-air self-levelling rotation (rad/s). */
    airLevelRate: 4.5,
    /** Extra angular damping (1/s) while self-levelling so the car settles instead of oscillating. */
    airLevelDamping: 1.6,
    /** Blend rate (1/s) of the settle assist that rights a slow car resting tilted on a surface (nose-down, two wheels); 0 disables it. */
    settle: 10,
    /** Fastest settle rotation (rad/s). */
    settleRate: 4.5,
    /** Settle only applies below this speed (uu/s), so it never fights a real in-air manoeuvre. */
    settleMaxSpeed: 400,
  },

  air: {
    /** Angular acceleration at full input (rad/s^2). */
    torque: { roll: 36.08, pitch: 12.15, yaw: 8.92 },
    /** Damping coefficients. Pitch/yaw damping scales by (1 - |input|); roll always applies. */
    damping: { roll: 4.47, pitch: 2.8, yaw: 1.89 },
    throttleAccel: 66.667,
  },

  collision: {
    /** Car vs arena. */
    restitution: 0.3,
    friction: 0.3,
    /** Hitbox points may sink this far into a surface before colliding (wheel clearance). */
    arenaTolerance: 1.6,
    /** Below this closing speed collisions are perfectly inelastic. */
    restitutionSpeedThreshold: 120,
    /** Car vs car. */
    carRestitution: 0.1,
  },

  demo: {
    /** Respawn spots (blue; orange mirrors them), cycled by slot. */
    respawnSpots: [[-2304, -4608], [2304, -4608], [-2688, -4608], [2688, -4608]].map(([x, y]) => [x * MAP_SCALE, y * MAP_SCALE]),
    /** Attacker speed required for a demolition. */
    minSpeed: 2200,
    respawnTime: 3,
  },
};

export const BALL = {
  radius: 91.25,
  mass: 30,
  maxSpeed: 6000,
  maxAngularSpeed: 6,
  spawn: { x: 0, y: 0, z: 92.75 },
  /** Linear drag factor. */
  drag: 0.03,
  restitution: 0.6,
  friction: 0.35,

  carHit: {
    /** Restitution of the plain rigid-body part of a car hit (extra impulse adds the rest). */
    restitution: 0,
    friction: 2.0,
    /** Extra impulse scale by relative speed (uu/s). */
    extraImpulseCurve: [0, 0.65, 500, 0.65, 2300, 0.55, 4600, 0.3],
    /** Multiplier on contact-normal Z when forming the extra-impulse direction. */
    normalZScale: 0.35,
    /** Blend toward car-forward for the extra impulse. */
    forwardScale: 0.65,
  },
};

export const ARENA = {
  halfWidth: 4096 * MAP_SCALE,
  halfLength: 5120 * MAP_SCALE,
  ceilingHeight: 2044,
  /** Floor-wall and wall-ceiling ramp radius. */
  rampRadius: 256,
  /** Plan-view radius of the four vertical corners. */
  cornerRadius: 1152,
  goal: {
    halfWidth: 893,
    height: 642.775,
    depth: 880,
    /** Net extends to |y| = backY (goal line plus depth). */
    backY: 5120 * MAP_SCALE + 880,
    postRadius: 20,
  },
};

export const PADS = {
  large: { amount: 100, respawn: 10, radius: 208, height: 168 },
  small: { amount: 12, respawn: 4, radius: 144, height: 165 },
  /** Base positions; mirrored on both axes (zero coordinates are not duplicated). */
  largeBase: [
    [3072 * MAP_SCALE, 4096 * MAP_SCALE],
  ],
  smallBase: [
    [0, 4240 * MAP_SCALE],
    [1788 * MAP_SCALE, 2300 * MAP_SCALE],
    [2048 * MAP_SCALE, 1036 * MAP_SCALE],
    [0, 1024 * MAP_SCALE],
    [1024 * MAP_SCALE, 0],
    // extra pads so six players are not starved on the larger field
    [3200, 0],
    [1536, 5200],
  ],
};

export const SPAWN = {
  /** Blue kickoff spots (x, y, yaw). Orange mirrors (x, y, yaw) through the origin. */
  kickoff: [
    { x: -2048 * MAP_SCALE, y: -2560 * MAP_SCALE, yaw: 0.25 * Math.PI },
    { x: 2048 * MAP_SCALE, y: -2560 * MAP_SCALE, yaw: 0.75 * Math.PI },
    { x: -256 * MAP_SCALE, y: -3840 * MAP_SCALE, yaw: 0.5 * Math.PI },
    { x: 256 * MAP_SCALE, y: -3840 * MAP_SCALE, yaw: 0.5 * Math.PI },
    { x: 0, y: -4608 * MAP_SCALE, yaw: 0.5 * Math.PI },
  ],
  /** Car body-origin height at spawn. */
  z: 17,
  countdown: 3,
};

export const MATCH = {
  length: 300,
  goalCelebration: 3,
  replaySeconds: 6,
  /** Goal explosion: speed thrown away from the goal at point-blank, and upward kick (uu/s). */
  goalBlast: 2300,
  goalBlastLift: 650,
  overtimeSudden: true,
};

export const CAMERA_DEFAULTS = {
  fov: 110,
  distance: 270,
  height: 100,
  angle: -3,
  stiffness: 0.45,
  swivelSpeed: 4.5,
  transitionSpeed: 1.2,
};

export const NET = {
  protocolVersion: 2,
  inputRate: 60,
  snapshotRate: 60,
  inputRedundancy: 3,
  jitterBufferTicks: 2,
  interpDelaySnapshots: 2,
  maxPlayersPerRoom: 6,
};

/** Expands a half-field table into all mirrored positions. */
export function mirrorPads(base: readonly (readonly number[])[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const [bx, by] of base) {
    const xs = bx === 0 ? [0] : [bx, -bx];
    const ys = by === 0 ? [0] : [by, -by];
    for (const x of xs) for (const y of ys) out.push({ x, y });
  }
  return out;
}

export const PAD_COUNT = mirrorPads(PADS.largeBase).length + mirrorPads(PADS.smallBase).length;
