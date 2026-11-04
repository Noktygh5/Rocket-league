import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARENA } from '@turboball/shared';
import { buildSunsetScenery } from './sunset';
import { buildAirships, buildBillboards, buildCityFog, buildHangingPipes, buildDrones, buildHaze, buildGantries, buildHeroCity, buildKanjiSigns, buildLightBeams, buildMonorail, buildTanks, nightSkyTexture } from './neoncity';

const W = ARENA.halfWidth, L = ARENA.halfLength;

/** Deterministic pseudo-random so the scenery is identical every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Night sky of the neon city (see neoncity.ts). */
export function skyTexture(): THREE.CanvasTexture {
  return nightSkyTexture();
}

function bake(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function lightTower(): { structure: THREE.BufferGeometry; lamps: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const H = 2900;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][]) {
    const leg = new THREE.CylinderGeometry(24, 46, H, 6);
    leg.translate(sx * 90, H / 2, sz * 90);
    // lean the legs inward toward the top
    const pos = leg.attributes.position;
    for (let i = 0; i < pos.count; i++) { const k = pos.getY(i) / H; pos.setX(i, pos.getX(i) - sx * 40 * k); pos.setZ(i, pos.getZ(i) - sz * 40 * k); }
    parts.push(bake(leg, 0x35393f));
  }
  for (let i = 1; i <= 8; i++) {
    const y = (i / 8) * H * 0.96, w = 180 - (i / 8) * 70;
    for (const [dx, dz, ry] of [[0, -w / 2 - 4, 0], [0, w / 2 + 4, 0], [-w / 2 - 4, 0, Math.PI / 2], [w / 2 + 4, 0, Math.PI / 2]] as [number, number, number][]) {
      const bar = new THREE.BoxGeometry(w * 1.3, 16, 16); bar.rotateY(ry); bar.translate(dx, y, dz); parts.push(bake(bar, 0x3d4148));
      const diag = new THREE.BoxGeometry(w * 1.5, 10, 10); diag.rotateZ(0.5); diag.rotateY(ry); diag.translate(dx, y - 120, dz); parts.push(bake(diag, 0x3d4148));
    }
  }
  const deck = new THREE.BoxGeometry(560, 40, 260); deck.translate(0, H + 20, 0); parts.push(bake(deck, 0x2a2d33));
  const lamps: THREE.BufferGeometry[] = [];
  // two round clusters of 19 bulbs on dark discs, like the stadium floodlights of the real map
  for (const cx of [-150, 150]) {
    const back = new THREE.CylinderGeometry(150, 150, 24, 28); back.rotateX(Math.PI / 2); back.translate(cx, H + 150, 118); parts.push(bake(back, 0x1d2026));
    const pts: [number, number][] = [[0, 0]];
    for (let k = 0; k < 6; k++) pts.push([Math.cos((k * Math.PI) / 3) * 58, Math.sin((k * Math.PI) / 3) * 58]);
    for (let k = 0; k < 12; k++) pts.push([Math.cos((k * Math.PI) / 6 + 0.26) * 112, Math.sin((k * Math.PI) / 6 + 0.26) * 112]);
    for (const [px, py] of pts) { const bulb = new THREE.CylinderGeometry(24, 24, 22, 12); bulb.rotateX(Math.PI / 2); bulb.translate(cx + px, H + 150 + py, 136); lamps.push(bake(bulb, 0xfff1cc)); }
  }
  return { structure: mergeGeometries(parts, false)!, lamps: mergeGeometries(lamps, false)! };
}

/** Everything outside the cage: sky, hills, stands, crowd, floodlights, buildings, power lines. */
export function buildEnvironment(low: boolean): THREE.Group {
  const group = new THREE.Group();
  const neon = new THREE.Group();
  neon.name = 'neonScenery';
  const r = rng(77);

  // sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 20), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
  sky.renderOrder = -10;
  neon.add(sky);

  // wet black ground of the city plaza around the arena (the pitch itself is in arenaMesh)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshStandardMaterial({ color: 0x07080d, roughness: 0.35, metalness: 0.6, envMapIntensity: 0.8 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -40;
  neon.add(ground);

  // stands with crowd
  const m4 = new THREE.Matrix4(), cc = new THREE.Color();
  const rows = low ? 3 : 6;
  const perSide = Math.floor((2 * L) / 120), perEnd = Math.floor((2 * W) / 120);
  const fanTex = canvasTex(128, 128, (g) => {
    g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, 128, 128);
    const rr = rng(3);
    for (let k = 0; k < 2; k++) {
      const cx = 32 + k * 64;
      g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(cx, 98, 28, 36, 0, Math.PI, 0); g.fill();            // shoulders
      g.fillStyle = `rgb(${200 + Math.round(rr() * 55)},${170 + Math.round(rr() * 60)},${140 + Math.round(rr() * 60)})`;
      g.beginPath(); g.arc(cx, 42, 15, 0, Math.PI * 2); g.fill();                                              // head
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(cx - 28, 100, 56, 28);
    }
  });
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(70, 105, 60), new THREE.MeshLambertMaterial({ color: 0xffffff, map: fanTex }), rows * (perSide * 2 + perEnd * 2));
  const stand = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x2a211d, roughness: 0.9 }), rows * 4);
  let ci = 0, si = 0;
  const crowdColor = (side: number): void => {
    const k = r();
    if (k < 0.62) cc.setHSL(0.045 + r() * 0.03, 0.8, 0.25 + r() * 0.2);        // orange / red fans
    else if (k < 0.8) cc.setHSL(0.6, 0.7, 0.28 + r() * 0.18);                    // blue fans
    else cc.setHSL(0.08, 0.15, 0.1 + r() * 0.2);                                 // dark clothing
    if (side !== 0 && r() < 0.5) cc.lerp(new THREE.Color(side < 0 ? 0x2c5cd0 : 0xd8681e), 0.5);
  };
  for (let row = 0; row < rows; row++) {
    const y = 130 + row * 250, off = W + 520 + row * 300;
    for (const sx of [-1, 1]) {
      for (let k = 0; k < perSide; k++) {
        const yy = -L + 60 + k * 120;
        m4.makeTranslation(sx * (off + (r() - 0.5) * 30), y + r() * 16, -yy);
        crowd.setMatrixAt(ci, m4); crowdColor(yy < 0 ? -1 : 1); crowd.setColorAt(ci++, cc);
      }
      m4.compose(new THREE.Vector3(sx * (off + 120), y - 70, 0), new THREE.Quaternion(), new THREE.Vector3(260, 50, 2 * L + 500));
      stand.setMatrixAt(si++, m4);
    }
    for (const sy of [-1, 1]) {
      const eoff = L + 1150 + row * 300;
      for (let k = 0; k < perEnd; k++) {
        m4.makeTranslation(-W + 60 + k * 120 + (r() - 0.5) * 30, y + r() * 16, -sy * eoff);
        crowd.setMatrixAt(ci, m4); crowdColor(sy); crowd.setColorAt(ci++, cc);
      }
      m4.compose(new THREE.Vector3(0, y - 70, -sy * (eoff + 120)), new THREE.Quaternion(), new THREE.Vector3(2 * W + 500, 50, 260));
      stand.setMatrixAt(si++, m4);
    }
  }
  crowd.count = ci; stand.count = si; crowd.instanceMatrix.needsUpdate = true;
  // dense sloped seating: one textured raked quad per side instead of floating boxes
  const crowdTile = (seed: number): THREE.CanvasTexture => {
    const t = canvasTex(512, 512, (g) => {
      const rr = rng(seed);
      g.fillStyle = '#1a1412'; g.fillRect(0, 0, 512, 512);
      const cols = 11, rowsN = 11, cw = 512 / cols, ch = 512 / rowsN;
      for (let ry = 0; ry < rowsN; ry++) {
        g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, ry * ch + ch - 4, 512, 4);                       // bench edge shadow
        for (let cx = 0; cx < cols; cx++) {
          const x = cx * cw + cw / 2 + (rr() - 0.5) * 6, y = ry * ch + ch * 0.58;
          const k = rr();
          const shirt = k < 0.45 ? `hsl(${14 + rr() * 14},${70 + rr() * 20}%,${34 + rr() * 22}%)` : k < 0.78 ? `hsl(${215 + rr() * 14},${60 + rr() * 25}%,${30 + rr() * 22}%)` : `hsl(${rr() * 60},${8 + rr() * 20}%,${14 + rr() * 38}%)`;
          g.fillStyle = shirt; g.beginPath(); g.ellipse(x, y + ch * 0.2, cw * 0.42, ch * 0.42, 0, Math.PI, 0); g.fill();
          g.fillStyle = `rgb(${150 + rr() * 80},${110 + rr() * 70},${85 + rr() * 60})`; g.beginPath(); g.arc(x, y - ch * 0.12, cw * 0.17, 0, Math.PI * 2); g.fill();
          if (rr() < 0.5) { g.fillStyle = `rgb(${20 + rr() * 60},${15 + rr() * 40},${10 + rr() * 30})`; g.beginPath(); g.arc(x, y - ch * 0.2, cw * 0.17, Math.PI, 0); g.fill(); }
        }
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  };
  const makeStand = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, lenU: number, lenV: number, tile: THREE.CanvasTexture): THREE.Mesh => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([a, b, c, d].flatMap((p) => [p.x, p.y, p.z]), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, lenV, lenU, lenV, lenU, 0], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]); geo.computeVertexNormals();
    const t = tile.clone(); t.needsUpdate = true;
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide, color: 0xe6dccf, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.42 }));
  };
  {
    const o0 = 520, o1 = 520 + 1500, y0 = 130, y1 = 130 + 1355;
    const zl = L + 250, xl = W + 250;
    for (const sx of [-1, 1]) {
      const tile = crowdTile(31 + sx);
      group.add(makeStand(new THREE.Vector3(sx * (W + o0), y0, -zl), new THREE.Vector3(sx * (W + o1), y1, -zl), new THREE.Vector3(sx * (W + o1), y1, zl), new THREE.Vector3(sx * (W + o0), y0, zl), (2 * zl) / 560, 2020 / 330, tile));
    }
    for (const sy of [-1, 1]) {
      const tile = crowdTile(41 + sy);
      const e0 = L + 1150, e1 = L + 1150 + 1500;
      group.add(makeStand(new THREE.Vector3(-xl, y0, -sy * e0), new THREE.Vector3(-xl, y1, -sy * e1), new THREE.Vector3(xl, y1, -sy * e1), new THREE.Vector3(xl, y0, -sy * e0), (2 * xl) / 560, 2020 / 330, tile));
    }
  }
  // stand structure: a dark canopy over the rear seating on support columns, with an LED lip (neon city only)
  {
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1b1d27, roughness: 0.6, metalness: 0.6, side: THREE.DoubleSide, envMapIntensity: 0.6 });
    const lipCols = [0x35b6ff, 0xff8a2a];
    const make = (S0: THREE.Vector3, S1: THREE.Vector3, axis: THREE.Vector3, half: number, lipColor: number): void => {
      const P = (t: number, up = 0): THREE.Vector3 => S0.clone().lerp(S1, t).add(new THREE.Vector3(0, up, 0));
      const A = P(0.58, 330), B = P(1.12, 380);
      const verts = [A.clone().addScaledVector(axis, -half), B.clone().addScaledVector(axis, -half), B.clone().addScaledVector(axis, half), A.clone().addScaledVector(axis, half)];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts.flatMap((v) => [v.x, v.y, v.z]), 3));
      geo.setIndex([0, 1, 2, 0, 2, 3]); geo.computeVertexNormals();
      group.add(new THREE.Mesh(geo, roofMat));
      // columns every ~1000 uu at the front and back of the canopy
      const cols: THREE.BufferGeometry[] = [];
      for (let k = -Math.floor(half / 1000); k <= Math.floor(half / 1000); k++) {
        for (const t of [0.58, 1.1]) {
          const base = P(t).addScaledVector(axis, k * 1000), top = P(t, t < 1 ? 330 : 378);
          const hgt = top.y - base.y + 20, c = new THREE.BoxGeometry(34, hgt, 34); c.translate(base.x, base.y + hgt / 2 - 10, base.z); cols.push(c.toNonIndexed());
        }
      }
      for (const c of cols) c.deleteAttribute('uv');
      group.add(new THREE.Mesh(mergeGeometries(cols, false)!, roofMat));
      const lip = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(axis.x) * 2 * half + 28, 30, Math.abs(axis.z) * 2 * half + 28), new THREE.MeshBasicMaterial({ color: lipColor, toneMapped: false }));
      lip.position.copy(A).add(new THREE.Vector3(0, -25, 0));
      neon.add(lip);
    };
    const o0 = 520, o1 = 520 + 1500, y0 = 130, y1 = 130 + 1355, zl = L + 250, xl = W + 250;
    for (const sx of [-1, 1]) make(new THREE.Vector3(sx * (W + o0), y0, 0), new THREE.Vector3(sx * (W + o1), y1, 0), new THREE.Vector3(0, 0, 1), zl, lipCols[sx < 0 ? 0 : 1]);
    for (const sy of [-1, 1]) make(new THREE.Vector3(0, y0, -sy * (L + 1150)), new THREE.Vector3(0, y1, -sy * (L + 1150 + 1500)), new THREE.Vector3(1, 0, 0), xl, lipCols[sy < 0 ? 0 : 1]);
  }

  // floodlight towers
  const tower = lightTower();
  const towers = new THREE.InstancedMesh(tower.structure, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.5 }), 8);
  const lamps = new THREE.InstancedMesh(tower.lamps, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color(3.2, 3.0, 2.5) }), 8);
  const spots: [number, number][] = [[-1, -0.75], [1, -0.75], [-1, 0.75], [1, 0.75], [-1, 0], [1, 0], [-0.55, -1], [0.55, 1]];
  spots.forEach(([tx, ty], i) => {
    const px = Math.abs(tx) === 1 ? tx * (W + 3000) : tx * W * 2.4, pz = Math.abs(ty) === 1 ? -ty * (L + 3500) : -ty * L;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-px, -pz) + Math.PI);
    m4.compose(new THREE.Vector3(px, 0, pz), q, new THREE.Vector3(1, 1, 1));
    towers.setMatrixAt(i, m4); lamps.setMatrixAt(i, m4);
  });
  group.add(towers, lamps);

  // the neon city beyond the stadium
  const city = buildHeroCity(low);
  neon.add(city.group, buildHaze());
  if (!low) neon.add(buildBillboards(city.towers), buildKanjiSigns(city.towers), buildAirships(), buildCityFog(), buildTanks(), buildLightBeams(), buildDrones());
  group.add(neon, buildSunsetScenery(low));
  return group;
}
