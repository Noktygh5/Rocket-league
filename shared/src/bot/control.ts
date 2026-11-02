import { CarInput, CarState } from '../car';
import { clamp } from '../math/scalar';

/**
 * PD attitude control: rotate the nose toward (fx,fy,fz) with the roof toward (ux,uy,uz).
 * `noRoll` keeps the car's current roll instead of chasing the requested up vector.
 */
export function orientCar(
  car: CarState, out: CarInput,
  fx: number, fy: number, fz: number, ux: number, uy: number, uz: number, noRoll: boolean,
): void {
  const m = car.basis.m;
  // desired axes
  let dfx = fx, dfy = fy, dfz = fz;
  const fl = Math.hypot(dfx, dfy, dfz) || 1; dfx /= fl; dfy /= fl; dfz /= fl;
  // up orthogonalised against forward
  let dux = ux, duy = uy, duz = uz;
  const d = dux * dfx + duy * dfy + duz * dfz;
  dux -= dfx * d; duy -= dfy * d; duz -= dfz * d;
  const ul = Math.hypot(dux, duy, duz);
  if (ul < 1e-3 || noRoll) { dux = m[2]; duy = m[5]; duz = m[8]; const d2 = dux * dfx + duy * dfy + duz * dfz; dux -= dfx * d2; duy -= dfy * d2; duz -= dfz * d2; }
  const ul2 = Math.hypot(dux, duy, duz) || 1; dux /= ul2; duy /= ul2; duz /= ul2;
  // left = up x forward
  const dlx = duy * dfz - duz * dfy, dly = duz * dfx - dux * dfz, dlz = dux * dfy - duy * dfx;
  // error (world) = 0.5 * sum(cur_i x des_i)
  const cfx = m[0], cfy = m[3], cfz = m[6], clx = m[1], cly = m[4], clz = m[7], cux = m[2], cuy = m[5], cuz = m[8];
  const ex = 0.5 * ((cfy * dfz - cfz * dfy) + (cly * dlz - clz * dly) + (cuy * duz - cuz * duy));
  const ey = 0.5 * ((cfz * dfx - cfx * dfz) + (clz * dlx - clx * dlz) + (cuz * dux - cux * duz));
  const ez = 0.5 * ((cfx * dfy - cfy * dfx) + (clx * dly - cly * dlx) + (cux * duy - cuy * dux));
  // to local
  const elx = m[0] * ex + m[3] * ey + m[6] * ez; // about forward
  const ely = m[1] * ex + m[4] * ey + m[7] * ez; // about left
  const elz = m[2] * ex + m[5] * ey + m[8] * ez; // about up
  const wlx = m[0] * car.angVel.x + m[3] * car.angVel.y + m[6] * car.angVel.z;
  const wly = m[1] * car.angVel.x + m[4] * car.angVel.y + m[7] * car.angVel.z;
  const wlz = m[2] * car.angVel.x + m[5] * car.angVel.y + m[8] * car.angVel.z;
  // upside down: the error vector vanishes at exactly 180 degrees, so just roll over
  const upDot = cux * dux + cuy * duy + cuz * duz;
  if (upDot < -0.35 && !noRoll) {
    out.roll = (m[1] * dux + m[4] * duy + m[7] * duz) >= 0 ? -1 : 1;
    out.pitch = 0; out.yaw = 0; out.steer = 0;
    return;
  }
  const kp = 7, kd = 1.1;
  out.roll = clamp(kp * elx - kd * wlx, -1, 1);
  out.pitch = clamp(kp * ely - kd * wly, -1, 1);
  out.yaw = clamp(-(kp * elz - kd * wlz), -1, 1);
  out.steer = out.yaw;
}
