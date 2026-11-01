import * as THREE from 'three';
import { ARENA, PADS, mirrorPads } from '@turboball/shared';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildCage } from './cage';
import { buildEnvironment } from './environment';

const BLUE_WALL = new THREE.Color(0x3a4cc4);
const BLUE_GLOW = 0x3f86ff, ORANGE_GLOW = 0xff8a2a;
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
    // team-coloured lanes on the grass (from the field map): orange half and blue half
    const lane = (x: number, y0: number, y1: number, col: string): void => { g.fillStyle = col; g.fillRect(px(x) - (100 / (2 * W)) * w, py(y1), (200 / (2 * W)) * w, py(y0) - py(y1)); };
    for (const x of [-3300, -2400, -1500, -700, 700, 1500, 2400, 3300]) { lane(x, 800, 3900, 'rgba(255,125,40,0.40)'); lane(x, -3900, -800, 'rgba(60,115,255,0.40)'); }
    // dark angular zones in front of each goal
    for (const sg of [-1, 1]) {
      g.fillStyle = 'rgba(8,10,14,0.55)'; g.beginPath();
      g.moveTo(px(-2300), py(sg * 5120)); g.lineTo(px(2300), py(sg * 5120)); g.lineTo(px(1500), py(sg * 3800)); g.lineTo(px(-1500), py(sg * 3800)); g.closePath(); g.fill();
      g.strokeStyle = sg < 0 ? 'rgba(90,150,255,0.8)' : 'rgba(255,160,80,0.8)'; g.lineWidth = 7; g.stroke();
    }
    // centre hub
    g.fillStyle = 'rgba(8,10,14,0.65)'; g.beginPath(); g.arc(px(0), py(0), (560 / (2 * W)) * w, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(190,200,215,0.85)'; g.lineWidth = 9; g.beginPath(); g.arc(px(0), py(0), (560 / (2 * W)) * w, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(220,225,235,0.55)'; g.lineWidth = 8; g.beginPath(); g.moveTo(px(0), py(-3900)); g.lineTo(px(0), py(3900)); g.stroke();
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
  /** Per-frame animation: flame flicker, floating orbs. */
  animate(dt: number): void;
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

  // ---- goals: futuristic metal tunnel, neon frame, LED screens and chevrons ----------------------------------------
  const ledTexture = (cols: number, rows: number, cell: number, color: string, drawSmall: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture => {
    const small = document.createElement('canvas'); small.width = cols; small.height = rows;
    const sg = small.getContext('2d', { willReadFrequently: true })!;
    sg.fillStyle = '#000'; sg.fillRect(0, 0, cols, rows); sg.fillStyle = '#fff'; sg.strokeStyle = '#fff'; drawSmall(sg);
    const img = sg.getImageData(0, 0, cols, rows).data;
    return canvasTex(cols * cell, rows * cell, (g) => {
      g.fillStyle = '#05070c'; g.fillRect(0, 0, cols * cell, rows * cell);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const v = img[(y * cols + x) * 4] / 255;
        g.beginPath(); g.arc(x * cell + cell / 2, y * cell + cell / 2, cell * 0.38, 0, Math.PI * 2);
        if (v > 0.35) { g.fillStyle = color; g.shadowColor = color; g.shadowBlur = cell * 0.9; } else { g.fillStyle = 'rgba(120,150,200,0.10)'; g.shadowBlur = 0; }
        g.fill();
      }
    });
  };
  const panelTex = canvasTex(512, 512, (g) => {
    g.fillStyle = '#aab3bf'; g.fillRect(0, 0, 512, 512);
    const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.22)'); g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    g.strokeStyle = 'rgba(20,26,34,0.85)'; g.lineWidth = 5;
    for (let i = 0; i <= 512; i += 128) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
    for (let i = 4; i <= 512; i += 128) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
    g.fillStyle = 'rgba(30,36,46,0.8)';
    for (let x = 16; x < 512; x += 128) for (let y = 16; y < 512; y += 128) { g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(x + 96, y + 96, 3.5, 0, Math.PI * 2); g.fill(); }
  }, true);
  const roundedRect = (hw: number, y0: number, y1: number, r: number, z: number): THREE.Vector3[] => {
    const pts: THREE.Vector3[] = [];
    const corner = (cx: number, cy: number, a0: number): void => { for (let i = 0; i <= 8; i++) { const a = a0 + (i / 8) * (Math.PI / 2); pts.push(new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z)); } };
    corner(hw - r, y1 - r, 0); corner(-hw + r, y1 - r, Math.PI / 2); corner(-hw + r, y0 + r, Math.PI); corner(hw - r, y0 + r, Math.PI * 1.5);
    return pts;
  };
  for (const s of [-1, 1]) {
    const neon = s < 0 ? 0x3a86ff : 0xff8d2c;
    const neonCss = s < 0 ? '#4d95ff' : '#ff9a3c';
    const label = s < 0 ? 'BLUE GOAL' : 'ORANGE GOAL';
    const g = new THREE.Group();
    const depth = GD - L;
    const mid = L + depth / 2;
    const tex = (rx: number, ry: number): THREE.CanvasTexture => { const t = panelTex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return t; };
    const metal = (rx: number, ry: number, tint = 0xdfe5ee): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ map: tex(rx, ry), color: tint, metalness: 0.7, roughness: 0.4, envMapIntensity: 1.2, side: THREE.DoubleSide });
    const plane = (w: number, h: number, mat: THREE.Material, px: number, py: number, pz: number, rx = 0, ry = 0): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(px, py, pz); m.rotation.set(rx, ry, 0); return m;
    };
    // tunnel interior
    g.add(plane(2 * GW, depth, metal(3, 2), 0, 0.5, -s * mid, -Math.PI / 2));
    g.add(plane(2 * GW, depth, metal(3, 2, 0xc2c9d4), 0, GH, -s * mid, -Math.PI / 2));
    g.add(plane(depth, GH, metal(2, 1.2), GW, GH / 2, -s * mid, 0, Math.PI / 2));
    g.add(plane(depth, GH, metal(2, 1.2), -GW, GH / 2, -s * mid, 0, Math.PI / 2));
    const backMat = metal(3, 1.2, 0x7d8794);
    g.add(plane(2 * GW, GH, backMat, 0, GH / 2, -s * GD, 0, 0));
    // glowing base strips along the tunnel walls
    const strip = new THREE.MeshBasicMaterial({ color: neon, toneMapped: false });
    for (const px of [-GW + 10, GW - 10]) { const st = new THREE.Mesh(new THREE.BoxGeometry(8, 12, depth - 40), strip); st.position.set(px, 14, -s * mid); g.add(st); }
    const stBack = new THREE.Mesh(new THREE.BoxGeometry(2 * GW - 40, 12, 8), strip); stBack.position.set(0, 14, -s * (GD - 10)); g.add(stBack);
    // neon rounded frame around the opening (coloured tube with a white core)
    const pathPts = roundedRect(GW + 38, 4, GH + 52, 150, -s * (L - 3));
    const curve = new THREE.CatmullRomCurve3(pathPts, true, 'catmullrom', 0.1);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 14, 8, true), new THREE.MeshBasicMaterial({ color: neon, toneMapped: false })));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 5, 6, true), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })));
    // dark armoured bezel and header
    const bezel = new THREE.MeshStandardMaterial({ color: 0x2a303a, metalness: 0.8, roughness: 0.4, envMapIntensity: 1.1 });
    const zf = -s * (L + 6);
    for (const sx of [-1, 1]) { const col = new THREE.Mesh(new THREE.BoxGeometry(170, GH + 260, 90), bezel); col.position.set(sx * (GW + 230), (GH + 260) / 2, zf); g.add(col); }
    const header = new THREE.Mesh(new THREE.BoxGeometry(2 * GW + 620, 150, 90), bezel); header.position.set(0, GH + 150, zf); g.add(header);
    // LED screen above the goal and chevron panels either side; the group is turned to face the pitch
    const face = new THREE.Group();
    face.position.set(0, 0, -s * (L - 18));
    if (s < 0) face.rotation.y = Math.PI;
    const signTex = ledTexture(104, 20, 10, neonCss, (c) => { c.font = 'bold 14px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, 52, 11); });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1700, 230, 40), bezel); frame.position.set(0, GH + 400, -14); face.add(frame);
    face.add(plane(1600, 190, new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false }), 0, GH + 400, 8));
    g.add(face);
    // painted zone on the grass in front of the goal
    const zoneTex = canvasTex(256, 128, (c) => {
      const gr = c.createLinearGradient(0, 128, 0, 0);
      gr.addColorStop(0, s < 0 ? 'rgba(60,110,255,0.60)' : 'rgba(255,130,40,0.60)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gr; c.fillRect(0, 0, 256, 128);
    });
    const zone = new THREE.Mesh(new THREE.PlaneGeometry(3400, 1800), new THREE.MeshBasicMaterial({ map: zoneTex, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    zone.rotation.x = -Math.PI / 2; zone.position.set(0, 2.5, -s * (L - 900)); zone.rotation.z = s > 0 ? Math.PI : 0;
    g.add(zone);
    group.add(g);
  }

  // ---- scenery beyond the cage -----------------------------------------------------------------------
  group.add(buildEnvironment(low));

  // ---- boost pads: small silver tri-lobe pads and large dark cross pads with a floating orb --------------------------
  const largeSpots = mirrorPads(PADS.largeBase), smallSpots = mirrorPads(PADS.smallBase);
  const silver = new THREE.MeshStandardMaterial({ color: 0xe6ebf2, metalness: 0.55, roughness: 0.28, envMapIntensity: 1.4 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.75, roughness: 0.42, envMapIntensity: 1.2 });
  const midMetal = new THREE.MeshStandardMaterial({ color: 0x70757e, metalness: 0.7, roughness: 0.4, envMapIntensity: 1.2 });
  const polarShape = (r: (a: number) => number): THREE.Shape => { const sh = new THREE.Shape(); const n = 120; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; const rr = r(a); if (i === 0) sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } return sh; };
  const slab = (sh: THREE.Shape, depth: number): THREE.BufferGeometry => { const gg = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: 3, bevelThickness: 2, bevelSegments: 1, curveSegments: 6 }); gg.rotateX(-Math.PI / 2); return gg; };
  const lobeGeo = slab(polarShape((a) => 78 * (0.74 + 0.26 * Math.cos(3 * a))), 4);
  const crossGeo = slab(polarShape((a) => 170 * (0.5 + 0.5 * Math.pow(Math.abs(Math.cos(2 * a)), 1.6))), 7);
  const nS = smallSpots.length, nL = largeSpots.length;
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number): THREE.InstancedMesh => { const m = new THREE.InstancedMesh(geo, mat, n); m.frustumCulled = false; group.add(m); return m; };
  const baseS = instanced(lobeGeo, silver, nS), baseL = instanced(crossGeo, darkMetal, nL);
  const ringS = instanced(new THREE.CylinderGeometry(44, 46, 5, 36), midMetal, nS), ringL = instanced(new THREE.CylinderGeometry(78, 82, 7, 40), midMetal, nL);
  const pedS = instanced(new THREE.CylinderGeometry(32, 34, 12, 32), darkMetal, nS), pedL = instanced(new THREE.CylinderGeometry(58, 62, 20, 36), darkMetal, nL);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const coreS = instanced(new THREE.CylinderGeometry(27, 27, 3, 32), coreMat, nS), coreL = instanced(new THREE.CylinderGeometry(49, 49, 3, 36), coreMat, nL);
  const glowTex = canvasTex(64, 64, (c) => {
    const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,190,70,0.85)'); gr.addColorStop(0.5, 'rgba(255,150,40,0.3)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
    c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
  });
  const glowGeo = new THREE.PlaneGeometry(1, 1); glowGeo.rotateX(-Math.PI / 2);
  const decalMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const glowS = instanced(glowGeo, decalMat, nS), glowL = instanced(glowGeo, decalMat, nL);
  // flame jets: two crossed translucent tongues, base at the origin
  const jetTex = canvasTex(64, 128, (c) => {
    const img = c.createImageData(64, 128); let sd = 5; const rd = (): number => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
      const t = 1 - y / 127, dx = Math.abs(x / 63 - 0.5) * 2;
      const a = Math.max(0, 1 - dx * dx) * Math.pow(1 - t, 0.6) * (0.65 + 0.5 * rd()) * (t < 0.04 ? t / 0.04 : 1);
      const i = (y * 64 + x) * 4; img.data[i] = 255; img.data[i + 1] = 150 + 90 * (1 - t); img.data[i + 2] = 40 + 120 * (1 - t) * (1 - t); img.data[i + 3] = Math.min(255, a * 300);
    }
    c.putImageData(img, 0, 0);
  });
  const jetGeo = (() => { const a = new THREE.PlaneGeometry(1, 1); a.translate(0, 0.5, 0); const b = a.clone(); b.rotateY(Math.PI / 2); return mergeGeometries([a, b], false)!; })();
  const jetMat = new THREE.MeshBasicMaterial({ map: jetTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, opacity: 0.95 });
  const jetsS = instanced(jetGeo, jetMat, nS * 4), jetsL = instanced(jetGeo, jetMat, nL * 5);
  // floating golden orb above each large pad
  const orbTex = canvasTex(256, 128, (c) => {
    const gr = c.createLinearGradient(0, 0, 256, 128); gr.addColorStop(0, '#ffe08a'); gr.addColorStop(1, '#f2a21b'); c.fillStyle = gr; c.fillRect(0, 0, 256, 128);
    let sd = 9; const rd = (): number => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let i = 0; i < 40; i++) { const x = rd() * 256, y = rd() * 128, r = 10 + rd() * 34; const rg = c.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, 'rgba(120,60,0,0.55)'); rg.addColorStop(1, 'rgba(120,60,0,0)'); c.fillStyle = rg; c.fillRect(x - r, y - r, r * 2, r * 2); }
  });
  const orbs: THREE.Mesh[] = [];
  const orbHalos: THREE.Mesh[] = [];
  const haloTex = canvasTex(64, 64, (c) => { const gr = c.createRadialGradient(32, 32, 6, 32, 32, 32); gr.addColorStop(0, 'rgba(255,200,80,0.9)'); gr.addColorStop(1, 'rgba(255,170,40,0)'); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); });
  const haloMat = new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const orbMat = new THREE.MeshBasicMaterial({ map: orbTex, toneMapped: false });

  type PadRec = { large: boolean; i: number; x: number; y: number; active: boolean };
  const padIndex: { large: boolean; i: number }[] = [];
  const recs: PadRec[] = [];
  const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion(), v3 = new THREE.Vector3(), sc = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const place = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, h: number, scale = 1): void => { m4.compose(v3.set(x, h, -y), q0, sc.set(scale, scale, scale)); mesh.setMatrixAt(i, m4); };
  largeSpots.forEach((p, i) => {
    place(baseL, i, p.x, p.y, 0); place(ringL, i, p.x, p.y, 9); place(pedL, i, p.x, p.y, 19); place(coreL, i, p.x, p.y, 30); place(glowL, i, p.x, p.y, 3, 380);
    recs.push({ large: true, i, x: p.x, y: p.y, active: true }); padIndex.push({ large: true, i });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(30, 28, 20), orbMat); orb.position.set(p.x, 120, -p.y); group.add(orb); orbs.push(orb);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(190, 190), haloMat); halo.position.copy(orb.position); group.add(halo); orbHalos.push(halo);
  });
  smallSpots.forEach((p, i) => {
    place(baseS, i, p.x, p.y, 0); place(ringS, i, p.x, p.y, 6); place(pedS, i, p.x, p.y, 12); place(coreS, i, p.x, p.y, 19); place(glowS, i, p.x, p.y, 3, 170);
    recs.push({ large: false, i, x: p.x, y: p.y, active: true }); padIndex.push({ large: false, i });
  });
  for (const m of [baseS, baseL, ringS, ringL, pedS, pedL, glowS, glowL]) m.instanceMatrix.needsUpdate = true;

  const lobeAngles = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
  const setJet = (mesh: THREE.InstancedMesh, k: number, x: number, y: number, h: number, w: number, hh: number): void => { m4.compose(v3.set(x, h, -y), q0, sc.set(w, hh, w)); mesh.setMatrixAt(k, m4); };
  let time = 0;
  const refreshJets = (rec: PadRec): void => {
    const f = (j: number): number => 0.86 + 0.14 * Math.sin(time * 9 + rec.i * 1.9 + j * 1.3);
    if (rec.large) {
      const base = rec.i * 5;
      if (!rec.active) { for (let j = 0; j < 5; j++) jetsL.setMatrixAt(base + j, zero); return; }
      setJet(jetsL, base, rec.x, rec.y, 31, 60, 140 * f(0));
      for (let j = 0; j < 4; j++) { const a = (j * Math.PI) / 2; setJet(jetsL, base + 1 + j, rec.x + Math.cos(a) * 120, rec.y + Math.sin(a) * 120, 8, 28, 55 * f(j + 1)); }
    } else {
      const base = rec.i * 4;
      if (!rec.active) { for (let j = 0; j < 4; j++) jetsS.setMatrixAt(base + j, zero); return; }
      setJet(jetsS, base, rec.x, rec.y, 20, 34, 70 * f(0));
      for (let j = 0; j < 3; j++) setJet(jetsS, base + 1 + j, rec.x + Math.cos(lobeAngles[j]) * 54, rec.y + Math.sin(lobeAngles[j]) * 54, 6, 18, 32 * f(j + 1));
    }
  };
  const colActive = new THREE.Color(1, 0.8, 0.28), colOff = new THREE.Color(0.08, 0.07, 0.06), tmp = new THREE.Color();
  const refreshAll = (): void => { for (const r of recs) refreshJets(r); jetsS.instanceMatrix.needsUpdate = true; jetsL.instanceMatrix.needsUpdate = true; };
  for (const r of recs) { (r.large ? coreL : coreS).setColorAt(r.i, colActive); }
  refreshAll();

  return {
    group, floor, smallPads: baseS, largePads: baseL, padIndex,
    setPadActive(idx, active, t01) {
      const r = recs[idx];
      r.active = active;
      const core = r.large ? coreL : coreS, glow = r.large ? glowL : glowS;
      core.setColorAt(r.i, active ? colActive : tmp.copy(colOff).lerp(colActive, 0.25 * t01));
      if (core.instanceColor) core.instanceColor.needsUpdate = true;
      if (active) place(glow, r.i, r.x, r.y, 3, r.large ? 380 : 170); else glow.setMatrixAt(r.i, zero);
      glow.instanceMatrix.needsUpdate = true;
      if (r.large) { orbs[r.i].visible = active; orbHalos[r.i].visible = active; }
      refreshJets(r);
      jetsS.instanceMatrix.needsUpdate = true; jetsL.instanceMatrix.needsUpdate = true;
    },
    animate(dt) {
      time += dt;
      for (const r of recs) if (r.active) refreshJets(r);
      jetsS.instanceMatrix.needsUpdate = true; jetsL.instanceMatrix.needsUpdate = true;
      orbs.forEach((o, i) => { o.rotation.y += dt * 0.9; o.position.y = 120 + 8 * Math.sin(time * 1.7 + i); orbHalos[i].position.y = o.position.y; });
    },
  };
}
