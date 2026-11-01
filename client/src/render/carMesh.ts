import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Flame } from './flame';

// Car model is built in three.js axes centred on the hitbox: +x forward, +y up, +z right.
// The physics hitbox is 118 x 36 x 84; the body is drawn longer (LEN) so it looks like a real car with overhangs.
// Wheels touch the ground 37.77 below centre.

const LEN = 1.2; // visual length scale of the body relative to the hitbox
const X = (x: number): number => x * LEN;

function shapeGeo(build: (s: THREE.Shape) => void, width: number, bevel: number, crease = 0.75): THREE.BufferGeometry {
  const s = new THREE.Shape();
  build(s);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.1, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 16 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  return toCreasedNormals(g, crease);
}
function box(w: number, h: number, d: number, x: number, y: number, z: number, rz = 0, ry = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g.toNonIndexed();
}
/** A box that stretches with the body length. */
const bx = (w: number, h: number, d: number, x: number, y: number, z: number, rz = 0, ry = 0): THREE.BufferGeometry => box(w * LEN, h, d, X(x), y, z, rz, ry);
function cyl(r: number, len: number, x: number, y: number, z: number, seg = 14): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g.toNonIndexed();
}
const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry =>
  mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;

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
          float shade = 0.82 + 0.34 * hash21(hc.xy);
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
  g.strokeStyle = '#3a2a08'; g.lineWidth = 3;
  for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2; g.beginPath(); g.moveTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); g.lineTo(128 + Math.cos(a + 0.11) * 112, 128 + Math.sin(a + 0.11) * 112); g.lineTo(128 + Math.cos(a + 0.11) * 100, 128 + Math.sin(a + 0.11) * 100); g.stroke(); }
  g.fillStyle = '#14120d'; g.beginPath(); g.arc(128, 128, 92, 0, Math.PI * 2); g.fill();
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

  // wheel stations (visual); the body is drawn around them
  const FX = 49, RX = -55, FR = 14.5, RR = 17;

  // ---- body shell: smooth, long, with a sloped hood and rounded nose/tail ------------------------------------------
  const lower = shapeGeo((s) => {
    s.moveTo(X(-60), -21);
    s.lineTo(X(-61), -9);
    s.bezierCurveTo(X(-64), -3, X(-63.5), 5, X(-58), 8.5);   // rounded tail
    s.lineTo(X(-34), 10.5);
    s.lineTo(X(22), 10.5);
    s.bezierCurveTo(X(38), 10.5, X(53), 8.5, X(61.5), 4);    // long sloping hood
    s.bezierCurveTo(X(65), 2, X(65.5), -4, X(64.5), -10);    // rounded nose
    s.lineTo(X(64), -21);
    s.closePath();
  }, 82, 4);
  const cabin = shapeGeo((s) => {
    s.moveTo(X(-55), 8.5);
    s.bezierCurveTo(X(-52), 15, X(-47), 22, X(-37), 24.2);   // fastback hatch
    s.lineTo(X(-10), 25.2);
    s.bezierCurveTo(X(3), 25, X(13), 18.5, X(27), 10);       // raked windscreen
    s.closePath();
  }, 66, 4);
  const paintParts: THREE.BufferGeometry[] = [lower, cabin];
  // fender tops over the wheels and a sculpted hood
  for (const [x, r] of [[FX, FR], [RX, RR]] as [number, number][]) for (const z of [-42.5, 42.5]) paintParts.push(box(2 * r + 20, 12, 8, x, -37.77 + r + 7, z));
  paintParts.push(bx(34, 3, 30, 36, 11.5, 0, -0.1), bx(54, 2, 3, -2, -3, 43.2), bx(54, 2, 3, -2, -3, -43.2));
  const paint = merge(paintParts);

  const gold = merge([
    shapeGeo((s) => { s.moveTo(X(-42), 24.6); s.lineTo(X(-9), 25.6); s.lineTo(X(-10), 27.6); s.lineTo(X(-41), 26.8); s.closePath(); }, 56, 1.2, 0.5), // roof skin
    bx(30, 1.2, 22, 36, 12.8, 0, -0.1),                                  // hood centre
    bx(64, 3, 2, -2, -19.5, 42.5), bx(64, 3, 2, -2, -19.5, -42.5),       // sills
    bx(24, 2.2, 6, -64, 9.5, 0),                                         // tail trim
  ]);

  // glass: raked windscreen, side windows, rear hatch
  const sideGlass = (z: number): THREE.BufferGeometry => {
    const e = shapeGeo((s) => { s.moveTo(X(-46), 10.5); s.bezierCurveTo(X(-43), 16, X(-40), 21, X(-34), 22.4); s.lineTo(X(-10), 23.2); s.bezierCurveTo(X(0), 22.6, X(10), 16.5, X(22), 10.5); s.closePath(); }, 1.4, 0, 0.2);
    e.translate(0, 0, z);
    return e;
  };
  const glass = merge([sideGlass(33.4), sideGlass(-33.4), bx(1.5, 16, 50, 10, 17.6, 0, -0.85), bx(1.5, 12, 46, -50, 16, 0, 0.3)]);

  // trim: bumpers, grille, fender flares, vents, mirrors, spoiler, headlight housings
  const trimParts: THREE.BufferGeometry[] = [];
  trimParts.push(box(9, 8, 84, X(64.5), -15, 0), box(8, 7, 84, X(-62), -15, 0));      // bumpers
  trimParts.push(box(16, 2, 88, X(63), -21.5, 0));                                     // splitter
  trimParts.push(box(5, 14, 50, X(65), -1, 0));                                        // grille block
  trimParts.push(box(4, 5, 24, X(65.5), -12, 0), box(5, 3, 14, X(-63), -11, 0));       // intake / diffuser
  for (const z of [-30, 30]) trimParts.push(box(6, 10, 16, X(64.4), 3.5, z));          // headlight housings
  for (const z of [-43, 43]) trimParts.push(box(11, 5, 7, X(8), 14, z * 0.99));        // mirrors
  for (const sgn of [-1, 1]) {
    trimParts.push(box(2, 11, 10, X(20), -3, sgn * 43.4), box(2, 9, 2, X(20), -3, sgn * 43.6, 0.45)); // side vent
    trimParts.push(box(2, 8, 14, X(-24), 5, sgn * 43.4));
  }
  for (const [x, r] of [[FX, FR], [RX, RR]] as [number, number][]) for (const z of [-44.5, 44.5]) {
    for (const k of [0, 1, 2]) { const arch = new THREE.TorusGeometry(r + 6 + k * 0.4, 3.4, 6, 28, Math.PI); arch.translate(x, -37.77 + r, z + (z > 0 ? -k * 1.6 : k * 1.6)); trimParts.push(arch.toNonIndexed()); }
    const lip = new THREE.CylinderGeometry(r + 4.5, r + 4.5, 2, 28, 1, false, 0, Math.PI); lip.rotateX(Math.PI / 2); lip.translate(x, -37.77 + r, z * 0.985); trimParts.push(lip.toNonIndexed());
  }
  trimParts.push(box(16, 2.6, 84, X(-63), 17.5, 0), box(8, 16, 2.6, X(-62), 9.5, 40), box(8, 16, 2.6, X(-62), 9.5, -40), box(6, 8, 3, X(-61), 12, 16), box(6, 8, 3, X(-61), 12, -16));
  const trim = merge(trimParts);
  const slats = merge([0, 1, 2, 3, 4].map((i) => box(2, 1.4, 46, X(65.2) + 2.2, -6 + i * 3, 0)));
  const lampLens = (z: number): THREE.BufferGeometry => { const g = new THREE.CylinderGeometry(6.4, 6.4, 3, 24); g.rotateZ(Math.PI / 2); g.translate(X(64.4) + 3.5, 3.5, z); return g.toNonIndexed(); };
  const lampRing = (z: number): THREE.BufferGeometry => { const g = new THREE.TorusGeometry(7.6, 1.5, 6, 24); g.rotateY(Math.PI / 2); g.translate(X(64.4) + 3.5, 3.5, z); return g.toNonIndexed(); };
  const lights = merge([lampLens(-30), lampLens(30)]);
  const lampRings = merge([lampRing(-30), lampRing(30)]);
  const drl = merge([box(2, 1.6, 20, X(64.4) + 4.2, -9.5, -30), box(2, 1.6, 20, X(64.4) + 4.2, -9.5, 30)]);
  const tails = merge([box(2.5, 5, 24, X(-62) - 3.2, 3, -30), box(2.5, 5, 24, X(-62) - 3.2, 3, 30), box(2, 2.6, 40, X(-62) - 3.2, 4, 0)]);
  const exhaust = merge([cyl(4.2, 7, X(-63) - 2, -14, -22, 12), cyl(4.2, 7, X(-63) - 2, -14, 22, 12)]);

  const mk = (g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh => { const me = new THREE.Mesh(g, m); me.castShadow = cast; return me; };
  root.add(mk(paint, paintMat), mk(gold, goldMat), mk(glass, glassMat), mk(trim, trimMat), mk(slats, new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.6, roughness: 0.4 })));
  root.add(new THREE.Mesh(lights, headMat), new THREE.Mesh(lampRings, chromeMat), new THREE.Mesh(drl, headMat), new THREE.Mesh(tails, tailMat), new THREE.Mesh(exhaust, chromeMat));

  // ---- wheels -------------------------------------------------------------------------------------------------------
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.85, metalness: 0.05 });
  const gold2 = new THREE.MeshStandardMaterial({ color: 0xf0b838, roughness: 0.22, metalness: 1 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x70747c, roughness: 0.45, metalness: 0.8 });
  const face = new THREE.MeshStandardMaterial({ map: wheelFaceTexture(), roughness: 0.25, metalness: 0.85, envMapIntensity: 1.2 });
  const wheels: { steer: THREE.Group; spin: THREE.Group; r: number; front: boolean }[] = [];
  const spec = [
    { x: FX, r: FR, z: 40 }, { x: FX, r: FR, z: -40 },
    { x: RX, r: RR, z: 40 }, { x: RX, r: RR, z: -40 },
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

  // ---- ground contact shadow + underglow ----------------------------------------------------------------------------
  const blobTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 8, 64, 64, 62);
    gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(230, 150), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, toneMapped: false }));
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
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(190, 124),
    new THREE.MeshBasicMaterial({ map: glowTex, color: body, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.set(0, -34.5, 0);
  root.add(glow);

  // ---- boost flame, supersonic streaks and ribbons --------------------------------------------------------------------
  const flame = new Flame();
  flame.group.position.set(X(-64) - 3, -12, 0);
  root.add(flame.group);
  const tailX = X(-64);
  const streakGeo = new THREE.BufferGeometry();
  const N = 16;
  const sp = new Float32Array(N * 6);
  for (let i = 0; i < N; i++) {
    const y = (Math.random() - 0.3) * 50, z = (Math.random() - 0.5) * 110;
    sp[i * 6] = tailX; sp[i * 6 + 1] = y; sp[i * 6 + 2] = z;
    sp[i * 6 + 3] = tailX - 140 - Math.random() * 200; sp[i * 6 + 4] = y; sp[i * 6 + 5] = z;
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
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI; m.position.set(RX - 650, -33.5, z);
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
