import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Flame } from './flame';

// Car model is built in three.js axes centred on the hitbox: +x forward, +y up, +z right.
// Hitbox: 118 x 36 x 84. Wheels touch the ground 37.77 below centre.

function extrude(pts: [number, number][], width: number, bevel = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.1, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 3,
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

const BODY_BLUE = new THREE.Color(0x1fa6d8), BODY_ORANGE = new THREE.Color(0xe8501c);
const GOLD = 0xf2b830;

/** Adds a procedural hexagon-plate livery (tri-planar, in object space) to a standard material. */
function addHexLivery(mat: THREE.MeshPhysicalMaterial, lineColor: THREE.Color): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLine = { value: lineColor };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos; varying vec3 vObjNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position; vObjNrm = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObjPos; varying vec3 vObjNrm; uniform vec3 uLine;
        float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // returns (cell id.xy, distance to the cell edge)
        vec3 hexCell(vec2 p) {
          const vec2 r = vec2(1.0, 1.7320508);
          vec2 h = r * 0.5;
          vec2 a = mod(p, r) - h;
          vec2 b = mod(p - h, r) - h;
          vec2 gv = dot(a, a) < dot(b, b) ? a : b;
          vec2 id = p - gv;
          vec2 q = abs(gv);
          float e = max(dot(q, vec2(0.5, 0.8660254)), q.x);
          return vec3(id, 0.5 - e);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 n = abs(normalize(vObjNrm));
          vec2 uv = (n.x > n.y && n.x > n.z) ? vObjPos.zy : (n.y > n.z ? vObjPos.xz : vObjPos.xy);
          vec3 hc = hexCell(uv / 7.0);
          float shade = 0.80 + 0.36 * hash21(hc.xy);
          vec3 base = diffuseColor.rgb * shade;
          float edge = smoothstep(0.0, 0.085, hc.z);
          diffuseColor.rgb = mix(uLine, base, edge);
        }`);
  };
  mat.customProgramCacheKey = () => 'hexlivery';
}

function wheelFaceTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8b43a'; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
  // greek-key style band
  g.strokeStyle = '#3a2a08'; g.lineWidth = 3;
  for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2; g.beginPath(); g.moveTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); g.lineTo(128 + Math.cos(a + 0.11) * 112, 128 + Math.sin(a + 0.11) * 112); g.lineTo(128 + Math.cos(a + 0.11) * 100, 128 + Math.sin(a + 0.11) * 100); g.stroke(); }
  g.fillStyle = '#14120d'; g.beginPath(); g.arc(128, 128, 92, 0, Math.PI * 2); g.fill();
  // golden starburst
  g.fillStyle = '#f4c24a';
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; g.beginPath(); g.moveTo(128 + Math.cos(a) * 14, 128 + Math.sin(a) * 14); g.lineTo(128 + Math.cos(a - 0.12) * 78, 128 + Math.sin(a - 0.12) * 78); g.lineTo(128 + Math.cos(a + 0.12) * 78, 128 + Math.sin(a + 0.12) * 78); g.closePath(); g.fill(); }
  g.fillStyle = '#e8b43a'; g.beginPath(); g.arc(128, 128, 22, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export function createCarVisual(team: 0 | 1, quality: 'low' | 'medium' | 'high'): CarVisual {
  const root = new THREE.Group();
  const body = (team === 0 ? BODY_BLUE : BODY_ORANGE).clone();
  const cast = quality !== 'low';

  // ---- materials --------------------------------------------------------------------------------------------
  const lineCol = new THREE.Color(team === 0 ? 0x0a5f86 : 0x6a1a08);
  const paintMat = new THREE.MeshPhysicalMaterial({ color: body, metalness: 0.45, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.35 });
  addHexLivery(paintMat, lineCol);
  const goldMat = new THREE.MeshPhysicalMaterial({ color: GOLD, metalness: 0.9, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.5 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.25, roughness: 0.5 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x06080c, metalness: 0.9, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.8 });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xdff4ff, toneMapped: false });
  const tailMat = new THREE.MeshBasicMaterial({ color: team === 0 ? 0xff2a6a : 0xff2c9a, toneMapped: false });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcfd6e2, metalness: 1, roughness: 0.18 });

  // ---- body shell: angular SUV ---------------------------------------------------------------------------------
  const lower = extrude([
    [-62, -21], [-64, -3], [-62, 8], [-46, 10.5], [-12, 11], [22, 10], [48, 7], [63, 2], [65, -8], [65, -21],
  ], 84, 2);
  const cabin = extrude([[-53, 9], [-45, 22.5], [-6, 24.5], [24, 10.5]], 68, 2);
  const slab = (x: number, w: number): THREE.BufferGeometry => box(w, 16, 90, x, -14, 0); // door/fender slab to widen the stance
  const wing = (x: number, r: number, z: number): THREE.BufferGeometry => box(2 * r + 18, 13, 7, x, -37.77 + r + 6, z); // body-coloured fender top
  const paintParts: THREE.BufferGeometry[] = [lower, cabin, slab(-2, 62)];
  for (const [x, r] of [[37.4, 14], [-47.6, 16.5]] as [number, number][]) for (const z of [-42.5, 42.5]) paintParts.push(wing(x, r, z));
  // sculpted panels: hood bulge + side character lines
  paintParts.push(box(40, 3.5, 32, 38, 10.8, 0, -0.1), box(60, 2, 3, -2, -2, 43.2), box(60, 2, 3, -2, -2, -43.2));
  const paint = merge(paintParts);

  // gold accents (roof skin + hood centre + door sills) like the reference
  const goldParts: THREE.BufferGeometry[] = [
    extrude([[-42, 24.5], [-8, 25.5], [-9, 27.8], [-41, 27]], 58, 1), // roof skin
    box(34, 1.2, 22, 38, 12.7, 0, -0.1),                                // hood centre
    box(70, 3, 2, -2, -19, 43), box(70, 3, 2, -2, -19, -43),            // sills
    box(28, 2.2, 6, -61.5, 11, 0),                                      // tail trim
  ];
  const gold = merge(goldParts);

  // glass: raked windscreen, side windows with black frames, rear hatch
  const glassParts: THREE.BufferGeometry[] = [];
  const winSide = (z: number): THREE.BufferGeometry => {
    const e = extrude([[-44, 11.5], [-39, 21.2], [-8, 23], [10, 14.2], [20, 11.5]], 1.2, 0);
    e.translate(0, 0, z);
    return e;
  };
  glassParts.push(winSide(34.2), winSide(-34.2));
  const windscreen = box(1.5, 15.5, 52, 11.5, 18, 0, -0.78); // raked
  glassParts.push(windscreen, box(1.5, 12, 48, -49, 16, 0, 0.18));
  const glass = merge(glassParts);

  // trim: bumpers, grille, fender flares, vents, mirrors, spoiler, exhausts, headlight housings
  const trimParts: THREE.BufferGeometry[] = [];
  trimParts.push(box(9, 8, 86, 65.5, -15, 0), box(8, 7, 86, -63.5, -15, 0));        // bumpers
  trimParts.push(box(14, 2, 90, 64, -21.5, 0));                                        // splitter
  trimParts.push(box(5, 15, 52, 65.2, -1, 0));                                         // grille block
  trimParts.push(box(4, 5, 24, 66, -12, 0), box(5, 3, 14, -64.5, -11, 0));             // intake / diffuser
  for (const z of [-30, 30]) trimParts.push(box(6, 11, 17, 65, 3, z));                 // headlight housings
  for (const z of [-43, 43]) trimParts.push(box(11, 5, 7, 6, 13, z * 0.99));           // mirrors
  for (const sgn of [-1, 1]) {                                                          // side vent behind the front wheel
    trimParts.push(box(2, 11, 10, 15, -3, sgn * 43.4), box(2, 9, 2, 15, -3, sgn * 43.6, 0.45));
    trimParts.push(box(2, 8, 14, -22, 5, sgn * 43.4));                                  // B-pillar to C-pillar black band
  }
  // big fender flares with a thick black lip
  for (const [x, r] of [[37.4, 14], [-47.6, 16.5]] as [number, number][]) for (const z of [-44.5, 44.5]) {
    for (const k of [0, 1, 2]) { const arch = new THREE.TorusGeometry(r + 6 + k * 0.4, 3.4, 6, 24, Math.PI); arch.translate(x, -37.77 + r, z + (z > 0 ? -k * 1.6 : k * 1.6)); trimParts.push(arch.toNonIndexed()); }
    const lip = new THREE.CylinderGeometry(r + 4.5, r + 4.5, 2, 24, 1, false, 0, Math.PI); lip.rotateX(Math.PI / 2); lip.translate(x, -37.77 + r, z * 0.985); trimParts.push(lip.toNonIndexed());
  }
  // wing: tall spoiler with end plates
  trimParts.push(box(16, 2.6, 86, -62, 18, 0), box(8, 17, 2.6, -61, 9.5, 41), box(8, 17, 2.6, -61, 9.5, -41), box(6, 8, 3, -60, 12, 16), box(6, 8, 3, -60, 12, -16));
  const trim = merge(trimParts);
  // grille slats
  const slats = merge([0, 1, 2, 3, 4].map((i) => box(2, 1.4, 48, 67.7, -6 + i * 3, 0)));
  const lampLens = (z: number): THREE.BufferGeometry => { const g = new THREE.CylinderGeometry(6.4, 6.4, 3, 24); g.rotateZ(Math.PI / 2); g.translate(66.8, 3, z); return g.toNonIndexed(); };
  const lampRing = (z: number): THREE.BufferGeometry => { const g = new THREE.TorusGeometry(7.6, 1.5, 6, 24); g.rotateY(Math.PI / 2); g.translate(66.8, 3, z); return g.toNonIndexed(); };
  const lights = merge([lampLens(-30), lampLens(30)]);
  const lampRings = merge([lampRing(-30), lampRing(30)]);
  const drl = merge([box(2, 1.6, 20, 67.6, -9.5, -30), box(2, 1.6, 20, 67.6, -9.5, 30)]);
  const tails = merge([box(2.5, 5, 24, -64.4, 3, -30), box(2.5, 5, 24, -64.4, 3, 30), box(2, 2.6, 40, -64.4, 4, 0)]);
  const exhaust = merge([cyl(4.2, 7, -65, -14, -22, 12), cyl(4.2, 7, -65, -14, 22, 12)]);

  const mk = (g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh => { const me = new THREE.Mesh(g, m); me.castShadow = cast; return me; };
  root.add(mk(paint, paintMat), mk(gold, goldMat), mk(glass, glassMat), mk(trim, trimMat), mk(slats, new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.6, roughness: 0.4 })));
  root.add(new THREE.Mesh(lights, headMat), new THREE.Mesh(lampRings, chromeMat), new THREE.Mesh(drl, headMat), new THREE.Mesh(tails, tailMat), new THREE.Mesh(exhaust, chromeMat));

  // ---- wheels: big gold-faced wheels like the reference ---------------------------------------------------------
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.85, metalness: 0.05 });
  const gold2 = new THREE.MeshStandardMaterial({ color: 0xf0b838, roughness: 0.22, metalness: 1 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x70747c, roughness: 0.45, metalness: 0.8 });
  const face = new THREE.MeshStandardMaterial({ map: wheelFaceTexture(), roughness: 0.25, metalness: 0.85, envMapIntensity: 1.2 });
  const wheels: { steer: THREE.Group; spin: THREE.Group; r: number; front: boolean }[] = [];
  const spec = [
    { x: 37.4, r: 14.5, z: 40 }, { x: 37.4, r: 14.5, z: -40 },
    { x: -47.6, r: 17, z: 40 }, { x: -47.6, r: 17, z: -40 },
  ];
  const seg = quality === 'low' ? 14 : 28;
  for (const s of spec) {
    const steer = new THREE.Group();
    const spin = new THREE.Group();
    const side = s.z > 0 ? 1 : -1;
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r, 20, seg), tireMat);
    tire.rotation.x = Math.PI / 2; tire.castShadow = cast;
    const rimBand = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.86, s.r * 0.86, 20.6, seg), gold2);
    rimBand.rotation.x = Math.PI / 2;
    const outer = new THREE.Mesh(new THREE.CircleGeometry(s.r * 0.86, seg), face);
    outer.position.z = side * 10.4; if (side < 0) outer.rotation.y = Math.PI;
    const inner = new THREE.Mesh(new THREE.CircleGeometry(s.r * 0.86, seg), face);
    inner.position.z = -side * 10.4; if (side > 0) inner.rotation.y = Math.PI;
    spin.add(tire, rimBand, outer, inner);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.6, s.r * 0.6, 1.6, 18), discMat);
    disc.rotation.x = Math.PI / 2; disc.position.z = -side * 5; steer.add(disc);
    steer.add(spin);
    steer.position.set(s.x, -37.77 + s.r, s.z);
    root.add(steer);
    wheels.push({ steer, spin, r: s.r, front: s.x > 0 });
  }

  // ---- ground contact shadow + underglow ---------------------------------------------------------------------
  const blobTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 8, 64, 64, 62);
    gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(200, 150), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, toneMapped: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.set(-2, -37.2, 0); blob.renderOrder = 1;
  root.add(blob);
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(160, 124),
    new THREE.MeshBasicMaterial({ map: glowTex, color: body, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.set(0, -34.5, 0);
  root.add(glow);

  // ---- boost flame, supersonic streaks and ribbons ---------------------------------------------------------------
  const flame = new Flame();
  flame.group.position.set(-68, -12, 0);
  root.add(flame.group);
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
  for (const z of [-34, 34]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1300, 11), new THREE.MeshBasicMaterial({ map: ribbonTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI; m.position.set(-64 - 650, -33.5, z);
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
      lineCol.set(tm === 0 ? 0x0a5f86 : 0x6a1a08);
      glow.material.color.copy(body);
    },
    dispose() {
      paint.dispose(); glass.dispose(); trim.dispose(); gold.dispose(); paintMat.dispose();
    },
  };
}
