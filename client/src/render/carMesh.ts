import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Flame } from './flame';

// Car model is built in three.js axes centred on the hitbox: +x forward, +y up, +z right.
// Hitbox: 118 x 36 x 84. Wheels touch the ground 37.77 below centre.

function extrude(pts: [number, number][], width: number, bevel = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.1, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  return g.index ? g.toNonIndexed() : g;
}
function box(w: number, h: number, d: number, x: number, y: number, z: number, rz = 0, ry = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g.toNonIndexed();
}
function cyl(r: number, len: number, x: number, y: number, z: number, seg = 14): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g.toNonIndexed();
}
const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  const m = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
  m.computeVertexNormals();
  return m;
};

export interface CarVisual {
  root: THREE.Group;
  /** Per-frame update. `forwardSpeed` signed (uu/s). */
  update(dt: number, boosting: boolean, supersonic: boolean, boostLevel: number, forwardSpeed: number, steer: number): void;
  setTeam(team: 0 | 1): void;
  dispose(): void;
}

const BODY_BLUE = new THREE.Color(0x2f6cf0), BODY_ORANGE = new THREE.Color(0xf0561f);

export function createCarVisual(team: 0 | 1, quality: 'low' | 'medium' | 'high'): CarVisual {
  const root = new THREE.Group();
  const body = (team === 0 ? BODY_BLUE : BODY_ORANGE).clone();
  const cast = quality !== 'low';

  // ---- paint: clear-coated metallic body ----------------------------------------------------------------
  const paintMat = new THREE.MeshPhysicalMaterial({ color: body, metalness: 0.35, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.0 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.2, roughness: 0.55 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x07090d, metalness: 0.9, roughness: 0.06, clearcoat: 1, envMapIntensity: 1.6 });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff1d0, toneMapped: false });
  const tailMat = new THREE.MeshBasicMaterial({ color: team === 0 ? 0xff2a6a : 0xff2c9a, toneMapped: false });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcfd6e2, metalness: 1, roughness: 0.18 });

  // lower body: side silhouette extruded across the width with softened edges
  const lower = extrude([
    [-61, -19], [-63, -7], [-60, 4], [-44, 7], [-8, 8.5], [24, 6.5], [57, 1], [63, -6], [62, -19],
  ], 84, 3);
  // cabin: sloped windscreen, short roof, steep rear hatch
  const cabinSide = extrude([[-51, 5], [-34, 19], [-6, 19.5], [17, 6]], 62, 2.5);
  // door panel lines / sills / hood bulge
  const sill = box(78, 4, 86, -2, -17, 0);
  const hoodBulge = box(46, 3.5, 30, 33, 8.2, 0, -0.12);
  const roofPanel = extrude([[-34, 20], [-8, 20.5], [-9, 23], [-33, 22.5]], 56, 1.5);
  const pillars: THREE.BufferGeometry[] = [];
  for (const z of [-31.5, 31.5]) {
    pillars.push(box(3, 16, 3, 10, 12.5, z, -0.62));   // A
    pillars.push(box(3, 16, 3, -30, 13, z, 0.5));       // C
    pillars.push(box(2, 15, 3, -13, 12.5, z));          // B
  }
  const paint = merge([lower, sill, hoodBulge, roofPanel, ...pillars,
    box(14, 3, 80, -61, 14, 0), // roof of the tail / tailgate lip
  ]);
  const glass = merge([cabinSide]);
  // accent stripe over hood + roof
  const stripeMat = new THREE.MeshPhysicalMaterial({ color: body.clone().multiplyScalar(0.28), metalness: 0.4, roughness: 0.35, clearcoat: 1 });
  const stripes = merge([box(70, 0.8, 8, 26, 9.9, -7, -0.12), box(70, 0.8, 8, 26, 9.9, 7, -0.12), box(26, 0.8, 8, -21, 23.3, -7), box(26, 0.8, 8, -21, 23.3, 7)]);

  // trim: bumpers, grille, wheel arches, mirrors, exhausts, spoiler
  const trimParts: THREE.BufferGeometry[] = [
    box(8, 7, 78, 62, -13, 0), box(7, 7, 76, -62, -14, 0),   // bumpers
    box(3, 8, 44, 63.5, -4, 0),                                // grille
    box(4, 3, 28, 63, -10, 0),                                 // splitter intake
    box(4, 3, 12, -62.5, -9, 0),                               // diffuser
  ];
  for (const z of [-41, 41]) trimParts.push(box(10, 5, 7, 6, 12, z * 0.98)); // mirrors
  for (const [x, r] of [[37.4, 16], [-47.6, 18.5]] as [number, number][]) for (const z of [-41.5, 41.5]) trimParts.push(cyl(r, 1.2, x, -37.77 + r * 0.95, z, 18)); // arches
  // spoiler wing + end plates
  trimParts.push(box(16, 2.6, 80, -60, 17, 0), box(7, 15, 2.5, -59, 9.5, 36), box(7, 15, 2.5, -59, 9.5, -36));
  const trim = merge(trimParts);
  const lights = merge([box(2.5, 5, 18, 63.3, 0, -26), box(2.5, 5, 18, 63.3, 0, 26)]);
  const tails = merge([box(2.5, 5, 22, -63.5, 1, -29), box(2.5, 5, 22, -63.5, 1, 29), box(2, 3.2, 40, -63.4, 2, 0)]);

  const mk = (g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh => { const me = new THREE.Mesh(g, m); me.castShadow = cast; return me; };
  const paintMesh = mk(paint, paintMat);
  root.add(paintMesh, mk(glass, glassMat), mk(stripes, stripeMat), mk(trim, trimMat));
  root.add(new THREE.Mesh(lights, headMat), new THREE.Mesh(tails, tailMat));
  const exhaust = merge([cyl(4, 7, -64, -13, -17, 10), cyl(4, 7, -64, -13, 17, 10)]);
  root.add(new THREE.Mesh(exhaust, chromeMat));

  // ---- wheels: tyre with sidewall, 5-spoke rim, brake disc -----------------------------------------------
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0e0f12, roughness: 0.85, metalness: 0.05 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xdfe5ef, roughness: 0.22, metalness: 1 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x6b6f77, roughness: 0.5, metalness: 0.8 });
  const wheels: { steer: THREE.Group; spin: THREE.Group; r: number; front: boolean }[] = [];
  const spec = [
    { x: 37.4, r: 12.5, z: 40 }, { x: 37.4, r: 12.5, z: -40 },
    { x: -47.6, r: 15, z: 40 }, { x: -47.6, r: 15, z: -40 },
  ];
  const seg = quality === 'low' ? 12 : 20;
  for (const s of spec) {
    const steer = new THREE.Group();
    const spin = new THREE.Group();
    const side = s.z > 0 ? 1 : -1;
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r, 17, seg), tireMat);
    tire.rotation.x = Math.PI / 2; tire.castShadow = cast;
    const rimDisc = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.72, s.r * 0.72, 17.4, seg), rimMat);
    rimDisc.rotation.x = Math.PI / 2;
    spin.add(tire, rimDisc);
    const dark = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.5, s.r * 0.5, 17.8, 10), tireMat);
    dark.rotation.x = Math.PI / 2; spin.add(dark);
    for (let k = 0; k < 5; k++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(s.r * 1.3, 2.4, 3), rimMat);
      spoke.rotation.z = (k * Math.PI * 2) / 5; spoke.position.z = side * 8.9; spin.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.2, s.r * 0.2, 19, 8), chromeMat);
    hub.rotation.x = Math.PI / 2; spin.add(hub);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.58, s.r * 0.58, 1.5, 16), discMat);
    disc.rotation.x = Math.PI / 2; disc.position.z = -side * 4; steer.add(disc);
    steer.add(spin);
    steer.position.set(s.x, -37.77 + s.r, s.z);
    root.add(steer);
    wheels.push({ steer, spin, r: s.r, front: s.x > 0 });
  }

  // ---- ground contact shadow (always present, keeps the car grounded even without shadow maps) -------------
  const blobTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 8, 64, 64, 62);
    gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(190, 140), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, toneMapped: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.set(-2, -37.2, 0); blob.renderOrder = 1;
  root.add(blob);

  // underglow
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(150, 118),
    new THREE.MeshBasicMaterial({ map: glowTex, color: body, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.set(0, -34.5, 0);
  root.add(glow);

  // ---- boost flame ------------------------------------------------------------------------------------------
  const flame = new Flame();
  flame.group.position.set(-66, -11, 0);
  root.add(flame.group);

  // supersonic streaks + two bright ribbons
  const streakGeo = new THREE.BufferGeometry();
  const N = 16;
  const sp = new Float32Array(N * 6);
  for (let i = 0; i < N; i++) {
    const y = (Math.random() - 0.3) * 50, z = (Math.random() - 0.5) * 110;
    sp[i * 6] = -60; sp[i * 6 + 1] = y; sp[i * 6 + 2] = z;
    sp[i * 6 + 3] = -60 - 140 - Math.random() * 200; sp[i * 6 + 4] = y; sp[i * 6 + 5] = z;
  }
  streakGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const streaks = new THREE.LineSegments(streakGeo, new THREE.LineBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  streaks.visible = false;
  root.add(streaks);
  const ribbonTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 16;
    const g = c.getContext('2d')!;
    const gr = g.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(235,245,255,0.7)'); gr.addColorStop(1, 'rgba(180,215,255,0)');
    g.fillStyle = gr; g.fillRect(0, 5, 256, 6);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 0, 256, 16);
    return new THREE.CanvasTexture(c);
  })();
  const ribbons = new THREE.Group();
  for (const z of [-33, 33]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1300, 11), new THREE.MeshBasicMaterial({ map: ribbonTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI; m.position.set(-62 - 650, -33.5, z);
    ribbons.add(m);
  }
  ribbons.visible = false;
  root.add(ribbons);

  return {
    root,
    update(dt, boosting, supersonic, boostLevel, forwardSpeed, steer) {
      for (const w of wheels) {
        w.spin.rotation.z -= (forwardSpeed * dt) / w.r; // rolling without slip about the axle
        if (w.front) w.steer.rotation.y = -steer * 0.38;
      }
      flame.update(dt, boosting, Math.min(1, boostLevel / 100));
      streaks.visible = supersonic;
      ribbons.visible = supersonic;
      glow.material.opacity = boosting ? 0.85 : 0.4;
    },
    setTeam(tm) {
      body.copy(tm === 0 ? BODY_BLUE : BODY_ORANGE);
      paintMat.color.copy(body);
      glow.material.color.copy(body);
    },
    dispose() {
      paint.dispose(); glass.dispose(); trim.dispose(); paintMat.dispose();
    },
  };
}
