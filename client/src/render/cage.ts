import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface OutPt { x: number; y: number; nx: number; ny: number }
export interface ProfPt { d: number; z: number }

/**
 * The see-through cage above the solid lower wall: thin curved steel ribs that follow the same
 * wall/ceiling profile as the collision surface, joined by horizontal cables. The sky shows through.
 */
export function buildCage(out: OutPt[], prof: ProfPt[], jSplit: number, goalHalf: number, halfLength: number, low: boolean): THREE.Group {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const spacing = low ? 900 : 620;

  // vertical arches
  let run = 0;
  let next = 0;
  for (let i = 0; i < out.length; i++) {
    if (i > 0) run += Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
    if (run < next) continue;
    next = run + spacing;
    const o = out[i];
    if (Math.abs(o.y) > halfLength - 90 && Math.abs(o.x) < goalHalf + 160) continue; // keep the goal mouth clear
    const pts: THREE.Vector3[] = [];
    for (let j = Math.max(0, jSplit - 1); j < prof.length; j++) {
      const p = prof[j];
      pts.push(new THREE.Vector3(o.x + o.nx * p.d, p.z, -(o.y + o.ny * p.d)));
    }
    if (pts.length < 3) continue;
    geos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), low ? 16 : 30, 7.5, 5, false));
  }

  // horizontal cables at three heights (wall mid, upper wall, ceiling edge)
  const levels = [jSplit + 2, Math.max(jSplit + 3, prof.length - 6), prof.length - 1];
  for (const j of levels) {
    if (j >= prof.length) continue;
    const p = prof[j];
    const pts = out.map((o) => new THREE.Vector3(o.x + o.nx * p.d, p.z, -(o.y + o.ny * p.d)));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.2);
    geos.push(new THREE.TubeGeometry(curve, out.length * 2, 5.5, 4, true));
  }

  const merged = mergeGeometries(geos, false)!;
  const mat = new THREE.MeshStandardMaterial({ color: 0xcfd3d9, roughness: 0.42, metalness: 0.65 });
  const mesh = new THREE.Mesh(merged, mat);
  group.add(mesh);
  return group;
}
