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

const BODY_BLUE = new THREE.Color(0x1a78ff), BODY_ORANGE = new THREE.Color(0xff5a10);
const NEON_BLUE = new THREE.Color(0x3fd0ff), NEON_ORANGE = new THREE.Color(0xffb02e);
// secondary colours: gold on the blue team, electric violet on the orange team (roof, hood, spoiler, accent lines, rims)
const SEC_BLUE = new THREE.Color(0x6a4cc8), SEC_ORANGE = new THREE.Color(0xb02a2a);
const ACC_BLUE = new THREE.Color(0xa78bff), ACC_ORANGE = new THREE.Color(0xff6a5a);
const TILE_BLUE = new THREE.Color(0x19d6ff), TILE_ORANGE = new THREE.Color(0xffc21a);   // per-plate colour drift of the tile pattern

/** Armour-plate livery: irregular Voronoi tiles (tri-planar, object space) with per-plate shade and hue drift and bevelled, darker seams. */
function addTileLivery(mat: THREE.MeshPhysicalMaterial, tint: THREE.Color): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTint = { value: tint };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos; varying vec3 vObjNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position; vObjNrm = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObjPos; varying vec3 vObjNrm; uniform vec3 uTint;
        vec2 hash22(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
        float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        vec3 voronoi(vec2 x) {
          vec2 n = floor(x), f = fract(x);
          float d1 = 8.0, d2 = 8.0; vec2 cell = vec2(0.0);
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 r = g + hash22(n + g) - f;
            float d = dot(r, r);
            if (d < d1) { d2 = d1; d1 = d; cell = n + g; } else if (d < d2) { d2 = d; }
          }
          return vec3(d1, d2, hash21(cell));
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 n = abs(normalize(vObjNrm));
          vec2 uv = (n.x > n.y && n.x > n.z) ? vObjPos.zy : (n.y > n.z ? vObjPos.xz : vObjPos.xy);
          vec3 vr = voronoi(uv / 12.5);
          float edgeD = sqrt(vr.y) - sqrt(vr.x);
          float edge = smoothstep(0.0, 0.07, edgeD);              // dark seam between plates
          float bevel = smoothstep(0.1, 0.34, edgeD);            // lighter bevel band hugging the seam
          vec3 cellCol = mix(diffuseColor.rgb, uTint, 0.7 * vr.z);
          float shade = 0.85 + 0.55 * fract(vr.z * 7.31);
          vec3 base = cellCol * shade * mix(1.3, 1.0, bevel);
          diffuseColor.rgb = mix(base * 0.5, base, edge);
        }`);
  };
  mat.customProgramCacheKey = () => 'tilelivery';
}

function wheelFaceTexture(accent: string, hi: string): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0c0d10'; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
  const rim = g.createRadialGradient(128, 128, 96, 128, 128, 124); rim.addColorStop(0, accent); rim.addColorStop(0.55, hi); rim.addColorStop(1, accent);
  g.fillStyle = rim; g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.arc(128, 128, 100, 0, Math.PI * 2, true); g.fill();          // bright rim lip
  g.fillStyle = '#17130f'; g.beginPath(); g.arc(128, 128, 100, 0, Math.PI * 2); g.fill();                                                  // dark dish
  g.strokeStyle = accent; g.lineWidth = 3;                                                                                                // meander key ring
  for (let i = 0; i < 40; i++) {
    g.save(); g.translate(128, 128); g.rotate((i / 40) * Math.PI * 2);
    g.beginPath(); g.moveTo(80, -3); g.lineTo(92, -3); g.lineTo(92, 5); g.lineTo(84, 5); g.lineTo(84, 0); g.lineTo(88, 0); g.stroke();
    g.restore();
  }
  g.lineWidth = 2; g.beginPath(); g.arc(128, 128, 78, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(128, 128, 94, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 24; i++) {                                                                                                          // sunburst
    g.save(); g.translate(128, 128); g.rotate((i / 24) * Math.PI * 2);
    g.fillStyle = i % 2 ? accent : hi; g.beginPath(); g.moveTo(-5, -14); g.lineTo(0, -(60 + (i % 3) * 5)); g.lineTo(5, -14); g.closePath(); g.fill();
    g.restore();
  }
  g.fillStyle = hi; g.beginPath(); g.arc(128, 128, 17, 0, Math.PI * 2); g.fill();
  g.fillStyle = accent; g.beginPath(); g.arc(128, 128, 9, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export function createCarVisual(team: 0 | 1, quality: 'low' | 'medium' | 'high'): CarVisual {
  const root = new THREE.Group();
  const body = (team === 0 ? BODY_BLUE : BODY_ORANGE).clone();
  const cast = quality !== 'low';

  // ---- materials (team colour paint, black plastic trim, dark glass) ---------------------------------------------------
  // pearly metallic paint: strong reflections of the city, a colour-shifting sheen, and a soft (not mirror-hot) sun highlight
  const paintMat = new THREE.MeshPhysicalMaterial({ color: body, metalness: 0.62, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1.5, specularIntensity: 0.55, iridescence: 0.2, iridescenceIOR: 1.3, iridescenceThicknessRange: [160, 420] });
  const tileTint = (team === 0 ? TILE_BLUE : TILE_ORANGE).clone();
  addTileLivery(paintMat, tileTint);
  // secondary paint: flat glossy gold (blue team) or electric violet (orange team) on the roof, hood and spoiler
  const secMat = new THREE.MeshPhysicalMaterial({ color: (team === 0 ? SEC_BLUE : SEC_ORANGE).clone(), metalness: 0.75, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.1, specularIntensity: 0.5 });
  const accentMat = new THREE.MeshBasicMaterial({ color: (team === 0 ? ACC_BLUE : ACC_ORANGE).clone(), toneMapped: false });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x0f1114, metalness: 0.45, roughness: 0.36, envMapIntensity: 1.0 });
  const bumperMat = new THREE.MeshStandardMaterial({ color: 0x1b1e24, metalness: 0.85, roughness: 0.26, envMapIntensity: 1.3 });
  const slatMat = new THREE.MeshStandardMaterial({ color: 0x4a4f5a, metalness: 0.8, roughness: 0.35, envMapIntensity: 0.6 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x05070b, metalness: 0.7, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.3, specularIntensity: 0.45 });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, toneMapped: false });
  const tailMat = new THREE.MeshBasicMaterial({ color: team === 0 ? 0xff2a6a : 0xff2c9a, toneMapped: false });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcfd6e2, metalness: 1, roughness: 0.16, envMapIntensity: 1.4 });

  // wheel stations (visual); the body is drawn around them
  const FX = 49, RX = -55, FR = 14.5, RR = 17;

  // ---- body shell: a boxy wagon. Lower body and cabin are straight-edged side profiles extruded across the width ---------
  const lower = shapeGeo((s) => {
    s.moveTo(X(-62), -19);
    s.lineTo(X(-66.5), -14);
    s.lineTo(X(-67), 3);
    s.lineTo(X(-63.5), 7.4);
    s.lineTo(X(24), 7.6);
    s.lineTo(X(30), 6.4);                 // cowl
    s.lineTo(X(58), 4.2);                 // flat hood
    s.lineTo(X(65.5), 2);
    s.lineTo(X(67.5), -3);                // blunt nose
    s.lineTo(X(67.5), -14);
    s.lineTo(X(63), -19);
    s.closePath();
  }, 84, 3.2, 0.6);
  const cabin = shapeGeo((s) => {
    s.moveTo(X(27), 6);
    s.lineTo(X(8), 24.2);                 // raked windscreen
    s.lineTo(X(-44), 25.2);               // flat roof
    s.lineTo(X(-60), 22);                 // short, steep tailgate
    s.lineTo(X(-63), 6);
    s.closePath();
  }, 64, 2.4, 0.6);
  const paintParts: THREE.BufferGeometry[] = [lower, cabin];
  // raised centre hood with two vents, side ridges
  // hood scoops (black, angled) and a deeper centre bulge
  // roof spoiler with end plates
  const paint = merge(paintParts);
  // secondary-colour panels: roof skin, hood skin, spoiler with end plates
  const second = merge([
    bx(46, 0.9, 56, -19, 27.9, 0),
    bx(34, 1.3, 60, 42, 9.4, 0, -0.1),
    bx(7, 1.6, 58, -62, 28.4, 0, 0.08), bx(7, 4, 1.6, -62, 26.6, 28.4), bx(7, 4, 1.6, -62, 26.6, -28.4),
  ]);

  // neon accent lines: sills, belt line, hood bulge edges, grille brow, wheel-arch rims
  const accentParts: THREE.BufferGeometry[] = [
    bx(70, 1.2, 1.3, -3, -17.2, 42.7), bx(70, 1.2, 1.3, -3, -17.2, -42.7),
    bx(78, 0.8, 0.9, -12, 7.9, 42.6), bx(78, 0.8, 0.9, -12, 7.9, -42.6),
    bx(30, 0.9, 0.9, 41, 8.6, 18.3, -0.045), bx(30, 0.9, 0.9, 41, 8.6, -18.3, -0.045),
    box(1.2, 0.9, 62, X(67.4) + 3.4, 6.9, 0),
  ];
  for (const [x, r] of [[FX, FR], [RX, RR]] as [number, number][]) for (const z of [-46.5, 46.5]) {
    const rim = new THREE.TorusGeometry(r + 4.6, 0.6, 6, 32, Math.PI); rim.translate(x, -37.77 + r, z); accentParts.push(rim.toNonIndexed());
  }
  const gold = merge(accentParts);

  // glass: windscreen, door and quarter windows, tailgate
  const sideGlass = (z: number): THREE.BufferGeometry => {
    const front = shapeGeo((s) => { s.moveTo(X(24), 8.2); s.lineTo(X(9.5), 22.6); s.lineTo(X(-17), 23.2); s.lineTo(X(-17), 8.2); s.closePath(); }, 1.3, 0, 0.2); front.translate(0, 0, z);
    const rear = shapeGeo((s) => { s.moveTo(X(-20), 8.2); s.lineTo(X(-20), 23.2); s.lineTo(X(-45), 23.4); s.lineTo(X(-57), 20); s.lineTo(X(-60), 8.2); s.closePath(); }, 1.3, 0, 0.2); rear.translate(0, 0, z);
    return merge([front, rear]);
  };
  const glass = merge([sideGlass(32.8), sideGlass(-32.8), bx(27.3, 1.2, 56, 21.6, 15.8, 0, -0.728), bx(1.3, 14.4, 52, -61.8, 14.2, 0, 0.1)]);

  // trim: dark fascia, grille surround, bumpers, splitter, fender flares, side vents, mirrors, skirts
  const trimParts: THREE.BufferGeometry[] = [];
  trimParts.push(box(3.4, 15, 68, X(67.4) + 1.4, -4.8, 0));                                     // front fascia (grille + headlight surround)
  for (const z of [-26.5, 26.5]) trimParts.push(box(5.5, 11.5, 17, X(67.4) + 2.4, 0.4, z));     // headlight housings
  for (const z of [-14.5, 14.5]) trimParts.push(box(3, 2.6, 3.2, X(67.4) + 2.6, 4.4, z));       // marker lights housing
  trimParts.push(box(2.6, 4, 40, X(67.4) + 2.9, 4.4, 0));                                       // brow above the grille
  for (const z of [-11, 11]) { const sc = box(11, 1.8, 7.5, X(46), 10.8, z); trimParts.push(sc); }  // hood scoops
  trimParts.push(box(9, 2.6, 78, X(63.5) + 2, -20.3, 0));                                       // splitter lip
  trimParts.push(box(7, 3.4, 52, X(-64) - 3, -19.5, 0));                                            // rear lip
  trimParts.push(box(5, 6.5, 80, X(-66.6) - 4.4, -11.2, 0));                                    // rear bumper
  for (const sgn of [-1, 1]) {
    trimParts.push(box(2.2, 15, 5.5, X(30), -5.5, sgn * 42.4));                                 // side vent slot
    for (const k of [0, 1, 2, 3]) trimParts.push(box(2.6, 0.9, 5.6, X(30), -11.5 + k * 3.2, sgn * 42.6));
    trimParts.push(box(70 * LEN * 0.9, 2.8, 2.2, X(-4), -18.4, sgn * 42.4));                    // side skirt
    trimParts.push(box(7, 3.4, 5.5, X(10), 14, sgn * 37));                                       // mirror
  }
  for (const [x, r] of [[FX, FR], [RX, RR]] as [number, number][]) for (const z of [-44.5, 44.5]) {
    // flared wheel arch: thick dark half-rings, a wheel-well liner behind
    for (const k of [0, 1, 2, 3]) { const arch = new THREE.TorusGeometry(r + 5.6 + k * 0.35, 3.1, 6, 30, Math.PI); arch.translate(x, -37.77 + r, z + (z > 0 ? -k * 1.5 : k * 1.5)); trimParts.push(arch.toNonIndexed()); }
    const well = new THREE.CircleGeometry(r + 4.6, 28, 0, Math.PI); well.translate(x, -37.77 + r, z * 0.972); trimParts.push(well.toNonIndexed());
  }
  const trim = merge(trimParts);
  const bumper = merge([box(8, 9.5, 86, X(66) + 3.4, -14.6, 0)]);
  const slats = merge([0, 1, 2, 3, 4, 5].map((i) => box(1.2, 0.9, 36, X(67.4) + 3.4, -9.4 + i * 1.9, 0)));
  const lampLens = (z: number): THREE.BufferGeometry => { const g = new THREE.CylinderGeometry(4.5, 4.5, 2.4, 24); g.rotateZ(Math.PI / 2); g.translate(X(67.4) + 5.4, 0.4, z); return g.toNonIndexed(); };
  const lampRing = (z: number): THREE.BufferGeometry => { const g = new THREE.TorusGeometry(5.5, 0.9, 6, 24); g.rotateY(Math.PI / 2); g.translate(X(67.4) + 5.6, 0.4, z); return g.toNonIndexed(); };
  const lights = merge([lampLens(-26.5), lampLens(26.5), box(1.4, 2.4, 2.4, X(67.4) + 4.3, 4.4, -14.5), box(1.4, 2.4, 2.4, X(67.4) + 4.3, 4.4, 14.5)]);
  const lampRings = merge([lampRing(-26.5), lampRing(26.5)]);
  const drl = merge([box(1.4, 1.5, 15, X(66) + 7.3, -12.2, -22), box(1.4, 1.5, 15, X(66) + 7.3, -12.2, 22)]);
  const tails = merge([box(2, 3.8, 22, X(-67) - 4.3, 2.8, -28), box(2, 3.8, 22, X(-67) - 4.3, 2.8, 28), box(1.8, 1.8, 34, X(-67) - 4.3, 3.2, 0)]);
  const exhaust = merge([cyl(3.2, 7, X(-67) - 6, -14, -16, 12), cyl(3.2, 7, X(-67) - 6, -14, 16, 12)]);

  const mk = (g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh => { const me = new THREE.Mesh(g, m); me.castShadow = cast; return me; };
  root.add(mk(paint, paintMat), mk(second, secMat), new THREE.Mesh(gold, accentMat), mk(glass, glassMat), mk(trim, trimMat), mk(bumper, bumperMat), mk(slats, slatMat));
  root.add(new THREE.Mesh(lights, headMat), new THREE.Mesh(lampRings, chromeMat), new THREE.Mesh(drl, headMat), new THREE.Mesh(tails, tailMat), new THREE.Mesh(exhaust, chromeMat));

  // ---- wheels -------------------------------------------------------------------------------------------------------
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.85, metalness: 0.05 });
  const gold2 = new THREE.MeshStandardMaterial({ color: (team === 0 ? SEC_BLUE : SEC_ORANGE).clone().multiplyScalar(0.55), roughness: 0.3, metalness: 0.9 });
  const faceTex = [wheelFaceTexture('#8a6bea', '#d2c4ff'), wheelFaceTexture('#d03a3a', '#ffb0a6')];
  const discMat = new THREE.MeshStandardMaterial({ color: 0x8a1c1c, roughness: 0.5, metalness: 0.6 });
  const face = new THREE.MeshStandardMaterial({ map: faceTex[team], roughness: 0.35, metalness: 0.45, envMapIntensity: 0.6 });
  const wheels: { steer: THREE.Group; spin: THREE.Group; r: number; front: boolean }[] = [];
  const spec = [
    { x: FX, r: FR, z: 38 }, { x: FX, r: FR, z: -38 },
    { x: RX, r: RR, z: 38 }, { x: RX, r: RR, z: -38 },
  ];
  const seg = quality === 'low' ? 14 : 28;
  for (const s of spec) {
    const steer = new THREE.Group();
    const spin = new THREE.Group();
    const side = s.z > 0 ? 1 : -1;
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r, 16, seg), tireMat);
    tire.rotation.x = Math.PI / 2; tire.castShadow = cast;
    const rimBand = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.86, s.r * 0.86, 16.4, seg), gold2);
    rimBand.rotation.x = Math.PI / 2;
    const outer = new THREE.Mesh(new THREE.CircleGeometry(s.r * 0.86, seg), face);
    outer.position.z = side * 8.3; if (side < 0) outer.rotation.y = Math.PI;
    const inner = new THREE.Mesh(new THREE.CircleGeometry(s.r * 0.86, seg), face);
    inner.position.z = -side * 8.3; if (side > 0) inner.rotation.y = Math.PI;
    spin.add(tire, rimBand, outer, inner);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.6, s.r * 0.6, 1.6, 18), discMat);
    disc.rotation.x = Math.PI / 2; disc.position.z = -side * 4; steer.add(disc);
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
      glow.material.opacity = boosting ? 0.45 : 0.16;
    },
    setTeam(tm) {
      body.copy(tm === 0 ? BODY_BLUE : BODY_ORANGE);
      paintMat.color.copy(body);
      accentMat.color.copy(tm === 0 ? ACC_BLUE : ACC_ORANGE);
      tileTint.copy(tm === 0 ? TILE_BLUE : TILE_ORANGE);
      secMat.color.copy(tm === 0 ? SEC_BLUE : SEC_ORANGE);
      gold2.color.copy(tm === 0 ? SEC_BLUE : SEC_ORANGE).multiplyScalar(0.55);
      face.map = faceTex[tm]; face.needsUpdate = true;
      glow.material.color.copy(body);
    },
    dispose() {
      paint.dispose(); second.dispose(); glass.dispose(); trim.dispose(); gold.dispose(); bumper.dispose(); paintMat.dispose();
    },
  };
}
