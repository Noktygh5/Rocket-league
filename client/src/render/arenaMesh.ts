import * as THREE from 'three';
import { ARENA, PADS, mirrorPads } from '@turboball/shared';
import { buildCage } from './cage';
import { buildEnvironment } from './environment';

const BLUE_WALL = new THREE.Color(0x3a4cc4);
const ORANGE_WALL = new THREE.Color(0xd2632a);
const WOOD = new THREE.Color(0xb86d36);
const W = ARENA.halfWidth, L = ARENA.halfLength, H = ARENA.ceilingHeight;
const R = ARENA.rampRadius, RC = ARENA.cornerRadius;
const GW = ARENA.goal.halfWidth, GH = ARENA.goal.height, GD = ARENA.goal.backY;

interface OutPt { x: number; y: number; nx: number; ny: number }

/** Plan-view outline (CCW) with inward normals; extra vertices sit on the goal-post lines. */
function planOutline(): OutPt[] {
  const pts: OutPt[] = [];
  const cx = W - RC, cy = L - RC;
  const arc = (ox: number, oy: number, a0: number, a1: number): void => {
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push({ x: ox + Math.cos(a) * RC, y: oy + Math.sin(a) * RC, nx: -Math.cos(a), ny: -Math.sin(a) });
    }
  };
  const line = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number, n: number, extra: number[] = []): void => {
    const ts = new Set<number>();
    for (let i = 1; i < n; i++) ts.add(i / n);
    for (const e of extra) ts.add(e);
    for (const t of [...ts].sort((a, b) => a - b)) pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, nx, ny });
  };
  line(W, -cy, W, cy, -1, 0, 10);
  arc(cx, cy, 0, Math.PI / 2);
  const span = 2 * cx;
  const f = (x: number) => (cx - x) / span;
  line(cx, L, -cx, L, 0, -1, 12, [f(GW), f(-GW), f(GW - 1), f(-GW + 1)]);
  arc(-cx, cy, Math.PI / 2, Math.PI);
  line(-W, cy, -W, -cy, 1, 0, 10);
  arc(-cx, -cy, Math.PI, Math.PI * 1.5);
  line(-cx, -L, cx, -L, 0, 1, 12, [(GW + cx) / span, (-GW + cx) / span, (GW - 1 + cx) / span, (-GW + 1 + cx) / span]);
  arc(cx, -cy, Math.PI * 1.5, Math.PI * 2);
  const out: OutPt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(q.x - p.x, q.y - p.y) > 0.5) out.push(p);
  }
  return out;
}

interface ProfPt { d: number; z: number; nd: number; nz: number }

function profile(): ProfPt[] {
  const prof: ProfPt[] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * (Math.PI / 2);
    prof.push({ d: R - R * Math.sin(t), z: R - R * Math.cos(t), nd: Math.sin(t), nz: Math.cos(t) });
  }
  const zs = [R, 400, GH, 900, 1200, 1500, H - R];
  for (const z of zs) {
    const last = prof[prof.length - 1];
    if (z > last.z + 1) prof.push({ d: 0, z, nd: 1, nz: 0 });
  }
  for (let i = n - 1; i >= 0; i--) {
    const t = (i / n) * (Math.PI / 2);
    prof.push({ d: R - R * Math.sin(t), z: H - R + R * Math.cos(t), nd: Math.sin(t), nz: -Math.cos(t) });
  }
  return prof;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  return t;
}

function floorTexture(): THREE.CanvasTexture {
  const w = 2048, h = 2560; // aspect 8192 : 10240
  return canvasTex(w, h, (g) => {
    let seed = 3;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const px = (x: number) => ((x + W) / (2 * W)) * w;
    const py = (y: number) => ((L - y) / (2 * L)) * h; // +y (orange) at the top
    g.fillStyle = '#2a3b1f'; g.fillRect(0, 0, w, h);
    // mowing stripes across the pitch
    const stripe = (700 / (2 * L)) * h;
    for (let i = 0; i * stripe < h; i++) { g.fillStyle = i & 1 ? 'rgba(120,150,70,0.10)' : 'rgba(0,10,0,0.10)'; g.fillRect(0, i * stripe, w, stripe); }
    // worn patches and soft blotches
    for (let i = 0; i < 55; i++) {
      const x = rnd() * w, y = rnd() * h, r = 40 + rnd() * 170;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const dark = rnd() < 0.6;
      gr.addColorStop(0, dark ? 'rgba(10,20,8,0.22)' : 'rgba(150,140,70,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // blades
    for (let i = 0; i < 260000; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(14,26,10,0.10)' : 'rgba(150,170,80,0.07)';
      g.fillRect(rnd() * w, rnd() * h, 1, 1 + rnd() * 3);
    }
    // centre circle region is slightly bare / darker, like the reference
    const cg = g.createRadialGradient(px(0), py(0), 0, px(0), py(0), (1000 / (2 * W)) * w);
    cg.addColorStop(0, 'rgba(60,45,25,0.45)'); cg.addColorStop(0.8, 'rgba(30,38,20,0.25)'); cg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = cg; g.fillRect(0, 0, w, h);
    g.lineCap = 'round';
    g.lineWidth = 11; g.strokeStyle = 'rgba(232,232,216,0.88)';
    g.beginPath(); g.moveTo(0, py(0)); g.lineTo(w, py(0)); g.stroke();
    g.beginPath(); g.arc(px(0), py(0), (1000 / (2 * W)) * w, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(232,232,216,0.9)';
    g.beginPath(); g.arc(px(0), py(0), 16, 0, Math.PI * 2); g.fill();
    for (const s of [-1, 1]) {
      g.strokeStyle = 'rgba(232,232,216,0.85)';
      g.beginPath(); g.rect(px(-1500), py(s * L), (3000 / (2 * W)) * w, (1500 / (2 * L)) * h * (s < 0 ? -1 : 1)); g.stroke();
      g.beginPath(); g.arc(px(0), py(s * 2800), (700 / (2 * W)) * w, 0, Math.PI * 2); g.stroke();
    }
    g.strokeStyle = 'rgba(232,232,216,0.5)'; g.setLineDash([46, 38]); g.lineWidth = 8;
    for (const y of [-2560, 2560]) { g.beginPath(); g.moveTo(px(-W), py(y)); g.lineTo(px(W), py(y)); g.stroke(); }
    g.setLineDash([]);
  });
}

/** Horizontal wooden planks with grain, nail lines and weathering. */
function plankTexture(): THREE.CanvasTexture {
  return canvasTex(512, 512, (g) => {
    let seed = 9;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    g.fillStyle = '#d8d0c4'; g.fillRect(0, 0, 512, 512);
    const planks = 8, ph = 512 / planks;
    for (let p = 0; p < planks; p++) {
      const y = p * ph, tone = 0.82 + rnd() * 0.3;
      g.fillStyle = `rgb(${Math.round(200 * tone)},${Math.round(196 * tone)},${Math.round(188 * tone)})`; g.fillRect(0, y, 512, ph);
      for (let k = 0; k < 26; k++) { g.fillStyle = `rgba(40,20,5,${0.04 + rnd() * 0.09})`; g.fillRect(0, y + rnd() * ph, 512, 1 + rnd() * 2.5); }
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, y, 512, 3);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, y + 3, 512, 2);
      for (const nx of [24, 488]) { g.fillStyle = 'rgba(30,20,12,0.7)'; g.beginPath(); g.arc(nx, y + ph / 2, 3, 0, Math.PI * 2); g.fill(); }
      if (rnd() < 0.5) { g.fillStyle = 'rgba(20,10,0,0.25)'; g.beginPath(); g.ellipse(80 + rnd() * 350, y + ph / 2, 10 + rnd() * 10, 4, 0, 0, Math.PI * 2); g.fill(); }
    }
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 0, 4, 512); g.fillRect(508, 0, 4, 512);
  }, true);
}

function netTexture(): THREE.CanvasTexture {
  return canvasTex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(235,235,235,0.9)'; g.lineWidth = 3.2;
    // hexagonal wire
    const r = 22, dx = r * 1.5, dy = r * Math.sqrt(3);
    for (let ix = -1; ix < 6; ix++) for (let iy = -1; iy < 4; iy++) {
      const cx = ix * dx, cy = iy * dy + (ix & 1 ? dy / 2 : 0);
      g.beginPath();
      for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      g.closePath(); g.stroke();
    }
  }, true);
}

export interface ArenaView {
  group: THREE.Group;
  floor: THREE.Mesh;
  smallPads: THREE.InstancedMesh;
  largePads: THREE.InstancedMesh;
  padIndex: { large: boolean; i: number }[];
  setPadActive(idx: number, active: boolean, t01: number): void;
}

export function buildArena(low: boolean): ArenaView {
  const group = new THREE.Group();
  const out = planOutline();
  const prof = profile();
  const nOut = out.length, nProf = prof.length;

  // ---- wall/ramp ring -----------------------------------------------------------------------------
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [];
  const idxLow: number[] = [], idxFence: number[] = [];
  let run = 0;
  const arcLen: number[] = [0];
  for (let i = 1; i <= nOut; i++) {
    const a = out[i - 1], b = out[i % nOut];
    run += Math.hypot(b.x - a.x, b.y - a.y);
    arcLen.push(run);
  }
  const pLen: number[] = [0];
  for (let j = 1; j < nProf; j++) pLen.push(pLen[j - 1] + Math.hypot(prof[j].d - prof[j - 1].d, prof[j].z - prof[j - 1].z));
  let jSplit = prof.findIndex((p) => p.d === 0 && p.z >= 399);
  if (jSplit < 0) jSplit = 1;
  const tmpC = new THREE.Color();
  for (let i = 0; i <= nOut; i++) {
    const o = out[i % nOut];
    for (let j = 0; j < nProf; j++) {
      const p = prof[j];
      const x = o.x + o.nx * p.d, y = o.y + o.ny * p.d;
      pos.push(x, p.z, -y);
      nor.push(o.nx * p.nd, p.nz, -o.ny * p.nd);
      uv.push(arcLen[i] / 640, pLen[j] / 640);
      // wood planks; the curved ramp is painted in the team colour, fading into bare wood higher up
      const team = y < 0 ? BLUE_WALL : ORANGE_WALL;
      const k = p.z < R * 0.98 ? 1 : p.z < 430 ? 0.62 * (1 - (p.z - R) / (430 - R)) : 0;
      tmpC.copy(WOOD).lerp(team, k);
      const shade = p.z < 430 ? 1.0 - 0.18 * (p.z / 430) : 1;
      col.push(tmpC.r * shade, tmpC.g * shade, tmpC.b * shade);
    }
  }
  for (let i = 0; i < nOut; i++) {
    for (let j = 0; j < nProf - 1; j++) {
      const a = i * nProf + j, b = (i + 1) * nProf + j, c = (i + 1) * nProf + j + 1, d = i * nProf + j + 1;
      const mx = (pos[a * 3] + pos[c * 3]) / 2, mz = (pos[a * 3 + 1] + pos[c * 3 + 1]) / 2;
      const my = -(pos[a * 3 + 2] + pos[c * 3 + 2]) / 2;
      if (Math.abs(my) > L - 60 && Math.abs(mx) < GW + 0.5 && mz < GH + 0.5) continue;
      (j < jSplit ? idxLow : idxFence).push(a, b, c, a, c, d);
    }
  }
  const mkGeo = (index: number[]): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(index);
    return g;
  };
  const woodTex = plankTexture();
  const wall = new THREE.Mesh(mkGeo(idxLow), new THREE.MeshStandardMaterial({ map: woodTex, vertexColors: true, roughness: 0.82, metalness: 0.05, side: THREE.DoubleSide }));
  group.add(wall);

  // faint wire mesh between the ribs (barely visible in the reference)
  const meshTex = netTexture();
  meshTex.repeat.set(1 / 0.7, 1 / 0.7);
  const fence = new THREE.Mesh(mkGeo(idxFence), new THREE.MeshBasicMaterial({ map: meshTex, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, color: 0xdde4ee }));
  fence.renderOrder = 2;
  group.add(fence);
  group.add(buildCage(out, prof, jSplit, GW, L, low));

  // ---- floor ---------------------------------------------------------------------------------------
  const fanGeo = (z: number): THREE.BufferGeometry => {
    const p: number[] = [0, z, 0], u: number[] = [0.5, 0.5], ix: number[] = [];
    for (const o of out) {
      const x = o.x + o.nx * R, y = o.y + o.ny * R;
      p.push(x, z, -y);
      u.push((x + W) / (2 * W), (y + L) / (2 * L));
    }
    for (let i = 1; i <= out.length; i++) ix.push(0, i, (i % out.length) + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    g.setIndex(ix);
    g.computeVertexNormals();
    return g;
  };
  const floor = new THREE.Mesh(fanGeo(0), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.95, metalness: 0, side: THREE.DoubleSide }));
  floor.receiveShadow = true;
  group.add(floor);

  // ---- goals -----------------------------------------------------------------------------------------
  const netTex = netTexture();
  for (const s of [-1, 1]) {
    const team = s < 0 ? BLUE_WALL : ORANGE_WALL;
    const g = new THREE.Group();
    const depth = GD - L;
    const mid = L + depth / 2;
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.95, side: THREE.DoubleSide });
    const mk = (w: number, h: number, mat: THREE.Material, px: number, py: number, pz: number, rx = 0, ry = 0): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(px, py, pz); m.rotation.set(rx, ry, 0);
      return m;
    };
    const netMat = (rx: number, ry: number): THREE.MeshBasicMaterial => {
      const t = netTex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry);
      return new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.62, side: THREE.DoubleSide, color: 0xeef0f2, depthWrite: false });
    };
    g.add(mk(2 * GW, depth, dark, 0, 0.5, -s * mid, -Math.PI / 2));
    g.add(mk(2 * GW, depth, netMat(7, 3), 0, GH, -s * mid, -Math.PI / 2));
    g.add(mk(depth, GH, netMat(3, 2), GW, GH / 2, -s * mid, 0, Math.PI / 2));
    g.add(mk(depth, GH, netMat(3, 2), -GW, GH / 2, -s * mid, 0, Math.PI / 2));
    g.add(mk(2 * GW, GH, netMat(7, 2), 0, GH / 2, -s * GD, 0, 0));
    // steel posts/crossbar with a team-coloured light strip, and heavy timber behind the goal
    const steel = new THREE.MeshStandardMaterial({ color: 0xdfe2e6, roughness: 0.35, metalness: 0.7 });
    const strip = new THREE.MeshBasicMaterial({ color: team, toneMapped: false });
    for (const px of [-GW, GW]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, GH, 10), steel); post.position.set(px, GH / 2, -s * L); g.add(post);
      const led = new THREE.Mesh(new THREE.BoxGeometry(5, GH - 20, 5), strip); led.position.set(px + (px > 0 ? -14 : 14), GH / 2, -s * (L - 12)); g.add(led);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 2 * GW, 10), steel); bar.rotation.z = Math.PI / 2; bar.position.set(0, GH, -s * L); g.add(bar);
    const barLed = new THREE.Mesh(new THREE.BoxGeometry(2 * GW - 40, 5, 5), strip); barLed.position.set(0, GH - 14, -s * (L - 12)); g.add(barLed);
    const timber = new THREE.MeshStandardMaterial({ color: 0x6a3f22, roughness: 0.9 });
    for (const px of [-GW - 70, GW + 70]) { const beam = new THREE.Mesh(new THREE.BoxGeometry(60, GH + 160, 60), timber); beam.position.set(px, (GH + 160) / 2, -s * (L + 40)); g.add(beam); }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2 * GW + 200, 70, 70), timber); lintel.position.set(0, GH + 120, -s * (L + 40)); g.add(lintel);
    group.add(g);
  }

  // ---- scenery beyond the cage -----------------------------------------------------------------------
  group.add(buildEnvironment(low));

  // ---- boost pads -------------------------------------------------------------------------------------
  const largeSpots = mirrorPads(PADS.largeBase), smallSpots = mirrorPads(PADS.smallBase);
  const hex = (r: number, hgt: number) => new THREE.CylinderGeometry(r, r * 1.06, hgt, 6);
  const padMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.9 });
  const smallPads = new THREE.InstancedMesh(hex(66, 6), padMat, smallSpots.length);
  const largePads = new THREE.InstancedMesh(hex(150, 10), padMat, largeSpots.length);
  const glowTex = canvasTex(64, 64, (c) => {
    const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,190,70,0.85)'); gr.addColorStop(0.5, 'rgba(255,150,40,0.3)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
    c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
  });
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const glowGeo = new THREE.PlaneGeometry(1, 1); glowGeo.rotateX(-Math.PI / 2);
  const beamTex = canvasTex(32, 128, (c) => {
    const gr = c.createLinearGradient(0, 128, 0, 0);
    gr.addColorStop(0, 'rgba(255,200,90,0.75)'); gr.addColorStop(1, 'rgba(255,170,60,0)');
    c.fillStyle = gr; c.fillRect(0, 0, 32, 128);
  });
  const beamMat = new THREE.MeshBasicMaterial({ map: beamTex, opacity: 0.5, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const beams: THREE.Mesh[] = [];
  const padIndex: { large: boolean; i: number }[] = [];
  const m4 = new THREE.Matrix4(), cc = new THREE.Color();
  const glows: THREE.Mesh[] = [];
  const glowMatSmall = glowMat.clone(); glowMatSmall.opacity = 0.5;
  const placeGlow = (x: number, y: number, size: number): THREE.Mesh => {
    const gm = new THREE.Mesh(glowGeo, size > 400 ? glowMat : glowMatSmall); gm.scale.set(size, 1, size); gm.position.set(x, 3, -y); group.add(gm); return gm;
  };
  largeSpots.forEach((p, i) => {
    m4.makeTranslation(p.x, 8, -p.y); largePads.setMatrixAt(i, m4); largePads.setColorAt(i, cc.set(0xffb02e)); padIndex.push({ large: true, i });
    glows.push(placeGlow(p.x, p.y, 640));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(120, 150, 600, 16, 1, true), beamMat); beam.position.set(p.x, 300, -p.y); group.add(beam); beams.push(beam);
  });
  smallSpots.forEach((p, i) => {
    m4.makeTranslation(p.x, 5, -p.y); smallPads.setMatrixAt(i, m4); smallPads.setColorAt(i, cc.set(0xffb02e)); padIndex.push({ large: false, i });
    glows.push(placeGlow(p.x, p.y, 230));
  });
  group.add(smallPads, largePads);

  const pc = new THREE.Color();
  return {
    group, floor, smallPads, largePads, padIndex,
    setPadActive(idx, active, t01) {
      const e = padIndex[idx];
      const mesh = e.large ? largePads : smallPads;
      const k = active ? 1 : 0.1 + 0.25 * t01;
      pc.setRGB(1.0 * k, 0.62 * k, 0.12 * k);
      mesh.setColorAt(e.i, pc);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      glows[idx].visible = active;
      if (idx < beams.length) beams[idx].visible = active;
    },
  };
}
