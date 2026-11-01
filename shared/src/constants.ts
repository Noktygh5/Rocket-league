// Every tunable number lives here. Units: "uu" (1 uu ~ 1 cm), seconds, radians.
// Sim axes: X right, Y toward Orange goal, Z up. Curves are flat [x0, y0, x1, y1, ...] tables
// consumed by `curve()` in math/scalar.ts.

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
    handbrakeGripRate: 0.6,
    /** How fast yaw rate converges to the steering target (1/s). */
    steerResponse: 30,
    /** Seconds after a jump during which wheel contact is ignored. */
    jumpGroundLockout: 0.06,
    /** Wheelbase used for steering: curvature = tan(steerAngle) / wheelbase. */
    wheelbase: 85,
    handbrakeSteerScale: 1.4,
    /** Sticky force relative to gravity: base with 3 wheels, up to max with 4. */
    stickyBase: 0.5,
    stickyMax: 1.5,
    minWheelsForSticky: 3,
  },

  boost: {
    max: 100,
    start: 33,
    useRate: 33.333,
    accel: 991.667,
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
    forwardScaleCurve: [0, 1.0, 1400, 0.7, 2300, 0.55],
    sideScale: 0.9,
    backwardScale: 0.85,
    duration: 0.65,
    torquePitch: 224,
    torqueRoll: 260,
    minTorqueTime: 0.5,
    /** Angular speed cap while a flip is rotating (the normal 5.5 cap makes flips far too slow). */
    maxAngularSpeed: 8.5,
    /** Vertical velocity damping ("flip hang"). */
    zDampFactor: 0.35,
    zDampStart: 0.15,
    zDampEnd: 0.21,
    /** Pitch input is ignored after a flip. */
    pitchLockTime: 1.0,
    pitchLockExtra: 0.1,
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
    /** The reset-upright button only works when the car's up axis is below this (z component), i.e. clearly tipped over. */
    uprightThreshold: 0.35,
    /** Seconds before the reset-upright button can be used again. */
    cooldown: 1.0,
    /** A car resting tipped over for this long (s) hops and rolls itself back onto its wheels. */
    autoRightDelay: 0.55,
    /** Hop strength (uu/s) away from the surface when auto-righting starts. */
    autoRightHop: 230,
    /** Roll speed (rad/s) used while auto-righting. */
    autoRightRate: 6.5,
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
    restitution: 0.25,
    friction: 0.3,
    /** Hitbox points may sink this far into a surface before colliding (wheel clearance). */
    arenaTolerance: 1.6,
    /** Below this closing speed collisions are perfectly inelastic. */
    restitutionSpeedThreshold: 120,
    /** Car vs car. */
    carRestitution: 0.35,
  },

  demo: {
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
    friction: 0.2,
    /** Extra impulse scale by relative speed (uu/s). */
    extraImpulseCurve: [0, 0.65, 500, 0.65, 2300, 0.55, 4600, 0.3],
    /** Multiplier on contact-normal Z when forming the extra-impulse direction. */
    normalZScale: 0.35,
    /** Blend toward car-forward for the extra impulse. */
    forwardScale: 0.65,
  },
};

export const ARENA = {
  halfWidth: 4096,
  halfLength: 5120,
  ceilingHeight: 2044,
  /** Floor-wall and wall-ceiling ramp radius. */
  rampRadius: 256,
  /** Plan-view radius of the four vertical corners. */
  cornerRadius: 1152,
  goal: {
    halfWidth: 893,
    height: 642.775,
    depth: 880,
    /** Net extends to |y| = backY. */
    backY: 6000,
    postRadius: 20,
  },
};

export const PADS = {
  large: { amount: 100, respawn: 10, radius: 208, height: 168 },
  small: { amount: 12, respawn: 4, radius: 144, height: 165 },
  /** Base positions; mirrored on both axes (zero coordinates are not duplicated). */
  largeBase: [
    [3072, 4096],
    [3584, 0],
  ],
  smallBase: [
    [0, 4240],
    [1792, 4184],
    [940, 3308],
    [0, 2816],
    [3584, 2484],
    [1788, 2300],
    [2048, 1036],
    [0, 1024],
    [1024, 0],
  ],
};

export const SPAWN = {
  /** Blue kickoff spots (x, y, yaw). Orange mirrors (x, y, yaw) through the origin. */
  kickoff: [
    { x: -2048, y: -2560, yaw: 0.25 * Math.PI },
    { x: 2048, y: -2560, yaw: 0.75 * Math.PI },
    { x: -256, y: -3840, yaw: 0.5 * Math.PI },
    { x: 256, y: -3840, yaw: 0.5 * Math.PI },
    { x: 0, y: -4608, yaw: 0.5 * Math.PI },
  ],
  /** Car body-origin height at spawn. */
  z: 17,
  countdown: 3,
};

export const MATCH = {
  length: 300,
  goalCelebration: 3,
  replaySeconds: 6,
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
  protocolVersion: 1,
  inputRate: 60,
  snapshotRate: 60,
  inputRedundancy: 3,
  jitterBufferTicks: 2,
  interpDelaySnapshots: 2,
  maxPlayersPerRoom: 4,
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
