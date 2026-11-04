import * as THREE from 'three';
import { ARENA, PADS, mirrorPads } from '@turboball/shared';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { buildCage } from './cage';
import { buildEnvironment } from './environment';

const BLUE_WALL = new THREE.Color(0x3a4cc4);
const BLUE_GLOW = 0x3f86ff, ORANGE_GLOW = 0xff8a2a;
const ORANGE_WALL = new THREE.Color(0xd2632a);
const WOOD = new THREE.Color(0xd9ccae);
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
  const w = 2560, h = 3200; // same aspect as the field (halfWidth : halfLength = 4 : 5)
  const S = L / 5120, Wo = W / S, Lo = L / S; // markings below are written in standard-field units
  return canvasTex(w, h, (g) => {
    let seed = 3;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const px = (x: number) => ((x * S + W) / (2 * W)) * w;
    const py = (y: number) => ((L - y * S) / (2 * L)) * h; // +y (orange) at the top
    g.fillStyle = '#163820'; g.fillRect(0, 0, w, h);
    // mowing stripes across the pitch
    const stripe = (700 / (2 * Lo)) * h;
    for (let i = 0; i * stripe < h; i++) { g.fillStyle = i & 1 ? 'rgba(130,165,70,0.16)' : 'rgba(0,10,0,0.14)'; g.fillRect(0, i * stripe, w, stripe); }
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
    const lane = (x: number, y0: number, y1: number, col: string): void => { g.fillStyle = col; g.fillRect(px(x) - (100 / (2 * Wo)) * w, py(y1), (200 / (2 * Wo)) * w, py(y0) - py(y1)); };
    for (const x of [-3300, -2400, -1500, -700, 700, 1500, 2400, 3300]) { lane(x, 800, 3900, 'rgba(255,125,40,0.22)'); lane(x, -3900, -800, 'rgba(60,115,255,0.22)'); }
    // dark angular zones in front of each goal
    for (const sg of [-1, 1]) {
      g.fillStyle = 'rgba(8,10,14,0.55)'; g.beginPath();
      g.moveTo(px(-2300), py(sg * 5120)); g.lineTo(px(2300), py(sg * 5120)); g.lineTo(px(1500), py(sg * 3800)); g.lineTo(px(-1500), py(sg * 3800)); g.closePath(); g.fill();
      g.strokeStyle = sg < 0 ? 'rgba(90,150,255,0.8)' : 'rgba(255,160,80,0.8)'; g.lineWidth = 7; g.stroke();
    }
    // centre hub
    g.fillStyle = 'rgba(8,10,14,0.65)'; g.beginPath(); g.arc(px(0), py(0), (560 / (2 * Wo)) * w, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(190,200,215,0.85)'; g.lineWidth = 9; g.beginPath(); g.arc(px(0), py(0), (560 / (2 * Wo)) * w, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(220,225,235,0.55)'; g.lineWidth = 8; g.beginPath(); g.moveTo(px(0), py(-3900)); g.lineTo(px(0), py(3900)); g.stroke();
    // centre circle region is slightly bare / darker, like the reference
    const cg = g.createRadialGradient(px(0), py(0), 0, px(0), py(0), (1000 / (2 * Wo)) * w);
    cg.addColorStop(0, 'rgba(60,45,25,0.45)'); cg.addColorStop(0.8, 'rgba(30,38,20,0.25)'); cg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = cg; g.fillRect(0, 0, w, h);
    g.lineCap = 'round';
    g.lineWidth = 11; g.strokeStyle = 'rgba(232,232,216,0.88)';
    g.beginPath(); g.moveTo(0, py(0)); g.lineTo(w, py(0)); g.stroke();
    g.beginPath(); g.arc(px(0), py(0), (1000 / (2 * Wo)) * w, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(232,232,216,0.9)';
    g.beginPath(); g.arc(px(0), py(0), 16, 0, Math.PI * 2); g.fill();
    for (const s of [-1, 1]) {
      g.strokeStyle = 'rgba(190,255,235,0.9)';
      g.beginPath(); g.rect(px(-1500), py(s * Lo), (3000 / (2 * Wo)) * w, (1500 / (2 * Lo)) * h * (s < 0 ? -1 : 1)); g.stroke();
      g.beginPath(); g.arc(px(0), py(s * 2800), (700 / (2 * Wo)) * w, 0, Math.PI * 2); g.stroke();
    }
    g.strokeStyle = 'rgba(232,232,216,0.5)'; g.setLineDash([46, 38]); g.lineWidth = 8;
    for (const y of [-2560, 2560]) { g.beginPath(); g.moveTo(px(-Wo), py(y)); g.lineTo(px(Wo), py(y)); g.stroke(); }
    g.setLineDash([]);
  });
}

/** Dark worn asphalt with painted team lanes, scuffs and cracks: the pitch of the neon city. */
function floorTextureNeon(): THREE.CanvasTexture {
  const w = 2560, h = 3200;
  const S = L / 5120, Wo = W / S, Lo = L / S;
  return canvasTex(w, h, (g) => {
    let seed = 41;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const px = (x: number) => ((x * S + W) / (2 * W)) * w;
    const py = (y: number) => ((L - y * S) / (2 * L)) * h;
    g.fillStyle = '#3a3a3e'; g.fillRect(0, 0, w, h);
    // large soft stains and lighter wear in the driving lines
    for (let i = 0; i < 90; i++) {
      const x = rnd() * w, y = rnd() * h, r = 60 + rnd() * 260;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rnd() < 0.5 ? 'rgba(10,12,16,0.3)' : 'rgba(120,128,138,0.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // concrete plate seams
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3;
    for (let i = 0; i <= 10; i++) { g.beginPath(); g.moveTo((i / 10) * w, 0); g.lineTo((i / 10) * w, h); g.stroke(); }
    for (let j = 0; j <= 13; j++) { g.beginPath(); g.moveTo(0, (j / 13) * h); g.lineTo(w, (j / 13) * h); g.stroke(); }
    // aggregate speckle
    for (let i = 0; i < 380000; i++) {
      g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${0.08 + rnd() * 0.18})` : `rgba(150,165,185,${0.05 + rnd() * 0.12})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    // painted team lanes: orange on the orange half, blue on the blue half, chewed away by wear
    const paint = (x0: number, y0: number, x1: number, y1: number, col: string): void => {
      g.fillStyle = col; g.fillRect(px(x0), py(y1), px(x1) - px(x0), py(y0) - py(y1));
    };
    for (const x of [-3000, -1500, 0, 1500, 3000]) { paint(x - 170, 700, x + 170, 3700, 'rgba(255,112,36,0.5)'); paint(x - 170, -3700, x + 170, -700, 'rgba(70,115,200,0.26)'); }
    paint(-4000, 3300, 4000, 3500, 'rgba(255,112,36,0.4)'); paint(-4000, -3500, 4000, -3300, 'rgba(70,115,200,0.22)');
    // goal-front zones with a bold arrow chevron field
    for (const sg of [-1, 1]) {
      const col = sg > 0 ? 'rgba(255,122,38,0.6)' : 'rgba(80,130,220,0.5)';
      g.fillStyle = 'rgba(6,8,12,0.55)'; g.beginPath();
      g.moveTo(px(-2300), py(sg * 5120)); g.lineTo(px(2300), py(sg * 5120)); g.lineTo(px(1500), py(sg * 3800)); g.lineTo(px(-1500), py(sg * 3800)); g.closePath(); g.fill();
      g.strokeStyle = col; g.lineWidth = 12; g.stroke();
      for (let k = 0; k < 3; k++) {
        const yy = sg * (4700 - k * 300);
        g.strokeStyle = col; g.lineWidth = 16; g.beginPath(); g.moveTo(px(-500), py(yy + sg * 140)); g.lineTo(px(0), py(yy - sg * 140)); g.lineTo(px(500), py(yy + sg * 140)); g.stroke();
      }
    }
    // rusty brown wear stains
    for (let i = 0; i < 70; i++) {
      const x = rnd() * w, y = rnd() * h, r = 50 + rnd() * 200;
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${110 + rnd() * 40},${70 + rnd() * 25},${40 + rnd() * 20},${0.14 + rnd() * 0.14})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // wear: scratch away patches of the paint with the base asphalt
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(58,58,62,${0.3 + rnd() * 0.5})`;
      const x = rnd() * w, y = rnd() * h; g.save(); g.translate(x, y); g.rotate(rnd() * Math.PI); g.fillRect(0, 0, 8 + rnd() * 90, 1.5 + rnd() * 5); g.restore();
    }
    // cracks
    g.strokeStyle = 'rgba(2,3,5,0.7)'; g.lineWidth = 2;
    for (let i = 0; i < 70; i++) {
      let x = rnd() * w, y = rnd() * h; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 14; k++) { x += (rnd() - 0.5) * 70; y += (rnd() - 0.3) * 70; g.lineTo(x, y); }
      g.stroke();
    }
    // markings: centre line and circle in cyan neon, boxes and dashed lanes in worn white
    g.lineCap = 'round';
    g.shadowColor = '#36e0ff'; g.shadowBlur = 14; g.strokeStyle = 'rgba(120,235,255,0.95)'; g.lineWidth = 11;
    g.beginPath(); g.moveTo(0, py(0)); g.lineTo(w, py(0)); g.stroke();
    g.beginPath(); g.arc(px(0), py(0), (1000 / (2 * Wo)) * w, 0, Math.PI * 2); g.stroke();
    g.shadowBlur = 0; g.fillStyle = 'rgba(8,10,14,0.7)'; g.beginPath(); g.arc(px(0), py(0), (560 / (2 * Wo)) * w, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(220,232,245,0.8)'; g.lineWidth = 9;
    for (const s of [-1, 1]) {
      g.beginPath(); g.rect(px(-1500), py(s * Lo), (3000 / (2 * Wo)) * w, (1500 / (2 * Lo)) * h * (s < 0 ? -1 : 1)); g.stroke();
      g.beginPath(); g.arc(px(0), py(s * 2800), (700 / (2 * Wo)) * w, 0, Math.PI * 2); g.stroke();
    }
    g.strokeStyle = 'rgba(220,232,245,0.6)'; g.setLineDash([46, 38]); g.lineWidth = 8;
    for (const y of [-2560, 2560]) { g.beginPath(); g.moveTo(px(-Wo), py(y)); g.lineTo(px(Wo), py(y)); g.stroke(); }
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

/** Dark hexagonal floor plates with glowing outlines: one tile covers 540 x 312 uu. */
function hexPlateTexture(neonCss: string): THREE.CanvasTexture {
  return canvasTex(384, 222, (g) => {
    let seed = 7;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    g.fillStyle = '#10141c'; g.fillRect(0, 0, 384, 222);
    const r = 64, dx = r * 1.5, dy = r * Math.sqrt(3);
    for (let ix = -1; ix < 6; ix++) for (let iy = -1; iy < 4; iy++) {
      const cx = ix * dx, cy = iy * dy + (ix & 1 ? dy / 2 : 0);
      const path = (): void => { g.beginPath(); for (let k = 0; k < 6; k++) { const an = (k * Math.PI) / 3; g.lineTo(cx + Math.cos(an) * (r - 3), cy + Math.sin(an) * (r - 3)); } g.closePath(); };
      const sh = 34 + Math.floor(rnd() * 18);
      path(); g.fillStyle = `rgb(${sh},${sh + 4},${sh + 12})`; g.fill();
      path(); g.strokeStyle = 'rgba(150,164,188,0.85)'; g.lineWidth = 4; g.stroke();
      if (rnd() < 0.28) { path(); g.save(); g.strokeStyle = neonCss; g.shadowColor = neonCss; g.shadowBlur = 8; g.lineWidth = 3.5; g.stroke(); g.restore(); }
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
  /** Neon-city look on/off: trim, floor reflection and wall tint (off = original sunset stadium). */
  setNeonLook(on: boolean): void;
  /** Updates the big LED SCORE screens above the goals. */
  setScore(blue: number, orange: number): void;
  /** Per-frame animation: flame flicker, floating orbs. */
  animate(dt: number): void;
}

export function buildArena(low: boolean): ArenaView {
  const group = new THREE.Group();
  const neonParts: THREE.Object3D[] = [];
  let ledTex: THREE.CanvasTexture | null = null;
  const scoreDraws: ((b: number, o: number) => void)[] = [];
  let lastScore: [number, number] = [0, 0];
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
      const k = p.z < R * 0.98 ? 1 : p.z < 430 ? 0.62 * (1 - (p.z - R) / (430 - R)) : p.z < 900 ? 0.38 * (1 - (p.z - 430) / 470) : 0; // second, fainter team-coloured band like the real boards
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
      if (Math.abs(my) > L - R - 2 && Math.abs(mx) < GW + 0.5 && mz < GH + 0.5) continue; // goal mouth: no wall and no floor ramp, the floor runs flat into the goal
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

  // glowing neon trim along the top of the low wall and the head of the ramp, blue on the blue half and orange on the orange half
  {
    const inGoal = (o: OutPt): boolean => Math.abs(o.y) > L - R - 4 && Math.abs(o.x) < GW + 1000;   // leave room for the chevron screens
    const neonCol = (y: number): THREE.Color => new THREE.Color(0x35b6ff).lerp(new THREE.Color(0xff8a2a), THREE.MathUtils.smoothstep(y, -500, 500));
    for (const [h, rad, white] of [[466, 6, 0], [292, 4, 0.55]] as [number, number, number][]) {
      let run: OutPt[] = [];
      const flush = (): void => {
        if (run.length > 3) {
          const pts = run.map((o) => new THREE.Vector3(o.x + o.nx * 33, h, -(o.y + o.ny * 33)));
          const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.05), run.length * 2, rad, 6, false);
          const p = tube.attributes.position, c = new Float32Array(p.count * 3);
          for (let i = 0; i < p.count; i++) { const k = neonCol(-p.getZ(i)).lerp(new THREE.Color(1, 1, 1), white); c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b; }
          tube.setAttribute('color', new THREE.BufferAttribute(c, 3));
          const m = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
          neonParts.push(m); group.add(m);
        }
        run = [];
      };
      for (const o of out) { if (inGoal(o)) flush(); else run.push(o); }
      flush();
    }
  }

  // thick glossy tech-panel lip along the wall, with a chasing LED dash board on its face (blue half / orange half)
  {
    const lipTex = canvasTex(512, 128, (g) => {
      g.fillStyle = '#4a5468'; g.fillRect(0, 0, 512, 128);
      const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = gr; g.fillRect(0, 0, 512, 128);
      g.strokeStyle = 'rgba(8,10,16,0.9)'; g.lineWidth = 5;
      for (let x = 0; x <= 512; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
      g.beginPath(); g.moveTo(0, 64); g.lineTo(512, 64); g.stroke();
      g.fillStyle = 'rgba(10,12,18,0.85)'; for (let x = 12; x < 512; x += 128) { g.beginPath(); g.arc(x, 14, 3.2, 0, Math.PI * 2); g.arc(x, 114, 3.2, 0, Math.PI * 2); g.fill(); }
    }, true);
    const lipMat = new THREE.MeshStandardMaterial({ map: lipTex, color: 0xaab4c8, metalness: 0.8, roughness: 0.3, envMapIntensity: 1.5, side: THREE.DoubleSide });
    ledTex = canvasTex(256, 32, (g) => {
      g.fillStyle = '#04060a'; g.fillRect(0, 0, 256, 32);
      g.fillStyle = '#ffffff'; g.shadowColor = '#ffffff'; g.shadowBlur = 8;
      for (let i = 0; i < 8; i++) g.fillRect(i * 32 + 4, 6, 24, 20);
    }, true);
    const inGoal = (o: OutPt): boolean => Math.abs(o.y) > L - R - 4 && Math.abs(o.x) < GW + 1000;   // leave room for the chevron screens
    const col = (y: number): THREE.Color => new THREE.Color(0x35b6ff).lerp(new THREE.Color(0xff8a2a), THREE.MathUtils.smoothstep(y, -500, 500));
    /** A ribbon following the wall outline between two (distance-from-wall, height) edges. */
    const ribbon = (run: OutPt[], e0: [number, number], e1: [number, number], mat: THREE.Material, colored: boolean): void => {
      const pos: number[] = [], uv: number[] = [], cols: number[] = [], idx: number[] = [];
      let acc = 0;
      run.forEach((o, i) => {
        if (i > 0) acc += Math.hypot(o.x - run[i - 1].x, o.y - run[i - 1].y);
        [e0, e1].forEach((e, k) => {
          pos.push(o.x + o.nx * e[0], e[1], -(o.y + o.ny * e[0])); uv.push(acc / 480, k);
          const c = col(o.y); cols.push(c.r, c.g, c.b);
        });
        if (i > 0) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      if (colored) geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      neonParts.push(m); group.add(m);
    };
    const ledMat = new THREE.MeshBasicMaterial({ map: ledTex, vertexColors: true, toneMapped: false, side: THREE.DoubleSide });
    let run: OutPt[] = [];
    const flush = (): void => {
      if (run.length > 2) {
        ribbon(run, [30, 296], [30, 462], lipMat, false);      // front face
        ribbon(run, [0, 462], [30, 462], lipMat, false);       // top face
        ribbon(run, [30, 296], [0, 296], lipMat, false);       // underside
        ribbon(run, [31.5, 345], [31.5, 413], ledMat, true);   // LED dashes
      }
      run = [];
    };
    for (const o of out) { if (inGoal(o)) flush(); else run.push(o); }
    flush();
  }

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
  // tiled blade-level detail multiplied over the big pitch texture so the grass stays sharp up close
  const detailTex = canvasTex(256, 256, (g) => {
    let sd = 17; const rd = (): number => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) {
      const v = rd();
      g.fillStyle = v < 0.5 ? `rgba(30,40,20,${0.15 + rd() * 0.25})` : `rgba(210,230,150,${0.1 + rd() * 0.2})`;
      g.fillRect(rd() * 256, rd() * 256, 1 + rd(), 3 + rd() * 6);
    }
  }, true);
  detailTex.colorSpace = THREE.NoColorSpace;
  const grassTex = floorTexture(), asphaltTex = floorTextureNeon();
  const floorMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.85, metalness: 0.02, envMapIntensity: 0.35, side: THREE.DoubleSide });
  floorMat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detailTex };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        { float dtl = texture2D(uDetail, vMapUv * vec2(${(2 * W / 500).toFixed(1)}, ${(2 * L / 500).toFixed(1)})).r;
          diffuseColor.rgb *= 0.55 + 0.9 * dtl; }`);
  };
  floorMat.customProgramCacheKey = () => 'pitchdetail';
  const floor = new THREE.Mesh(fanGeo(0), floorMat);
  floor.receiveShadow = true;
  floor.renderOrder = -1;
  group.add(floor);
  if (!low) {
    // live mirror under the translucent pitch: the neon city, goals and cars reflect off the wet floor
    const mirror = new Reflector(new THREE.PlaneGeometry(2 * W, 2 * L), { textureWidth: 1024, textureHeight: 1024, color: 0x14161b, clipBias: 0.003 });
    mirror.rotation.x = -Math.PI / 2; mirror.position.y = -1.5;
    const before = mirror.onBeforeRender.bind(mirror);
    mirror.onBeforeRender = (...args: Parameters<typeof before>): void => { floor.visible = false; before(...args); floor.visible = true; };
    group.add(mirror); neonParts.push(mirror);
  }

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
    const metal = (rx: number, ry: number, tint = 0x707d96): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ map: tex(rx, ry), color: tint, metalness: 0.7, roughness: 0.4, envMapIntensity: 1.2, side: THREE.DoubleSide });
    const plane = (w: number, h: number, mat: THREE.Material, px: number, py: number, pz: number, rx = 0, ry = 0): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(px, py, pz); m.rotation.set(rx, ry, 0); return m;
    };
    // tunnel interior
    const hexFloor = hexPlateTexture(neonCss);
    const floorLen = depth + R + 2;
    hexFloor.repeat.set((2 * GW) / 540, floorLen / 312);
    g.add(plane(2 * GW, floorLen, new THREE.MeshStandardMaterial({ map: hexFloor, metalness: 0.5, roughness: 0.4, envMapIntensity: 0.9, side: THREE.DoubleSide }), 0, 0.5, -s * (mid - (R + 2) / 2), -Math.PI / 2));
    g.add(plane(2 * GW, depth, metal(3, 2, 0x56627a), 0, GH, -s * mid, -Math.PI / 2));
    g.add(plane(depth, GH, metal(2, 1.2), GW, GH / 2, -s * mid, 0, Math.PI / 2));
    g.add(plane(depth, GH, metal(2, 1.2), -GW, GH / 2, -s * mid, 0, Math.PI / 2));
    const hexTex = canvasTex(512, 256, (c) => {
      c.fillStyle = '#05070c'; c.fillRect(0, 0, 512, 256);
      c.strokeStyle = neonCss; c.shadowColor = neonCss; c.shadowBlur = 10; c.lineWidth = 3;
      const r = 26, dx = r * 1.5, dy = r * Math.sqrt(3);
      for (let ix = -1; ix < 22; ix++) for (let iy = -1; iy < 6; iy++) {
        const cx = ix * dx, cy = iy * dy + (ix & 1 ? dy / 2 : 0);
        c.beginPath(); for (let k = 0; k < 6; k++) { const an = (k * Math.PI) / 3; c.lineTo(cx + Math.cos(an) * r, cy + Math.sin(an) * r); } c.closePath(); c.stroke();
      }
      c.save(); c.shadowBlur = 0; c.strokeStyle = 'rgba(255,255,255,0.3)'; c.lineWidth = 4;
      c.beginPath(); c.moveTo(256, 36); c.lineTo(318, 54); c.lineTo(318, 128); c.quadraticCurveTo(318, 190, 256, 218); c.quadraticCurveTo(194, 190, 194, 128); c.lineTo(194, 54); c.closePath(); c.stroke(); c.restore();
      const gr = c.createRadialGradient(256, 128, 10, 256, 128, 280); gr.addColorStop(0, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0.6)');
      c.fillStyle = gr; c.fillRect(0, 0, 512, 256);
    });
    const backMat = new THREE.MeshBasicMaterial({ map: hexTex, toneMapped: false, side: THREE.DoubleSide });
    for (const k of [-1, 0, 1]) { const ls = new THREE.Mesh(new THREE.BoxGeometry(10, 6, depth - 60), new THREE.MeshBasicMaterial({ color: neon, toneMapped: false })); ls.position.set(k * GW * 0.55, GH - 8, -s * mid); g.add(ls); }
    g.add(plane(2 * GW, GH, backMat, 0, GH / 2, -s * GD, 0, 0));
    // white hex net lining the goal: roof, both sides and the back wall
    {
      const nt = (rx: number, ry: number): THREE.CanvasTexture => { const t = netTexture(); t.repeat.set(rx, ry); return t; };
      const netMat = (rx: number, ry: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ map: nt(rx, ry), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
      const np = (w: number, h: number, m: THREE.Material, px: number, py: number, pz: number, rx = 0, ry = 0): THREE.Mesh => { const me = plane(w, h, m, px, py, pz, rx, ry); me.renderOrder = 3; return me; };
      g.add(np(2 * GW - 20, depth, netMat(2 * GW / 160, depth / 160), 0, GH - 6, -s * mid, -Math.PI / 2));
      g.add(np(depth, GH - 8, netMat(depth / 160, GH / 160), GW - 8, GH / 2, -s * mid, 0, Math.PI / 2));
      g.add(np(depth, GH - 8, netMat(depth / 160, GH / 160), -GW + 8, GH / 2, -s * mid, 0, Math.PI / 2));
      g.add(np(2 * GW - 20, GH - 8, netMat(2 * GW / 160, GH / 160), 0, GH / 2, -s * (GD - 8), 0, 0));
    }
    // glowing base strips along the tunnel walls
    const strip = new THREE.MeshBasicMaterial({ color: neon, toneMapped: false });
    for (const px of [-GW + 10, GW - 10]) { const st = new THREE.Mesh(new THREE.BoxGeometry(8, 12, depth - 40), strip); st.position.set(px, 14, -s * mid); g.add(st); }
    const stBack = new THREE.Mesh(new THREE.BoxGeometry(2 * GW - 40, 12, 8), strip); stBack.position.set(0, 14, -s * (GD - 10)); g.add(stBack);
    // thick, rounded, dark glossy frame around the opening with a neon outline, plus silver bevelled wings inside the mouth
    const rrPath = <T extends THREE.Path>(p: T, hw: number, y0: number, y1: number, rad: number): T => {
      p.moveTo(-hw + rad, y0); p.lineTo(hw - rad, y0); p.absarc(hw - rad, y0 + rad, rad, -Math.PI / 2, 0, false);
      p.lineTo(hw, y1 - rad); p.absarc(hw - rad, y1 - rad, rad, 0, Math.PI / 2, false);
      p.lineTo(-hw + rad, y1); p.absarc(-hw + rad, y1 - rad, rad, Math.PI / 2, Math.PI, false);
      p.lineTo(-hw, y0 + rad); p.absarc(-hw + rad, y0 + rad, rad, Math.PI, Math.PI * 1.5, false);
      return p;
    };
    const frameGeo = new THREE.ExtrudeGeometry(
      (() => { const sh = rrPath(new THREE.Shape(), GW + 190, -70, GH + 210, 240); sh.holes.push(rrPath(new THREE.Path(), GW + 10, 0, GH + 36, 140)); return sh; })(),
      { depth: 150, bevelEnabled: true, bevelThickness: 22, bevelSize: 20, bevelSegments: 4, curveSegments: 28 },
    );
    frameGeo.translate(0, 0, -75);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b2232, metalness: 0.85, roughness: 0.28, envMapIntensity: 1.7 });
    const frameMesh = new THREE.Mesh(frameGeo, frameMat); frameMesh.position.set(0, 0, -s * (L + 30)); g.add(frameMesh);
    const neonMat2 = new THREE.MeshBasicMaterial({ color: neon, toneMapped: false });
    const outline = (hw: number, y0: number, y1: number, rad: number, radius: number, zz: number): void => {
      const pts = roundedRect(hw, y0, y1, rad, zz);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.1), 200, radius, 8, true), neonMat2));
    };
    outline(GW + 194, -66, GH + 206, 242, 14, -s * (L - 72));       // outer neon outline
    outline(GW + 16, 4, GH + 32, 140, 10, -s * (L - 72));           // inner neon outline
    // glossy rounded liner lining the mouth of the tunnel (wide enough that nothing visually clips the ball), with a second neon outline deeper in
    const linerGeo = new THREE.ExtrudeGeometry(
      (() => { const sh = rrPath(new THREE.Shape(), GW + 74, -4, GH + 44, 150); sh.holes.push(rrPath(new THREE.Path(), GW + 6, 4, GH + 6, 120)); return sh; })(),
      { depth: 520, bevelEnabled: true, bevelThickness: 26, bevelSize: 22, bevelSegments: 5, curveSegments: 28 },
    );
    const linerMat = new THREE.MeshStandardMaterial({ color: 0xbcc4d2, metalness: 0.6, roughness: 0.36, envMapIntensity: 0.9 });
    const liner = new THREE.Mesh(linerGeo, linerMat); liner.position.set(0, 0, -s * L - (s > 0 ? 520 : 0)); g.add(liner);
    outline(GW + 22, 8, GH + 22, 128, 8, -s * (L + 500));
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) { const lamp = new THREE.Mesh(new THREE.SphereGeometry(24, 14, 10), neonMat2); lamp.position.set(sx * (GW - 150), GH - 110, -s * (L + 120 + k * 130)); g.add(lamp); }
    const bezel = new THREE.MeshStandardMaterial({ color: 0x2a303a, metalness: 0.8, roughness: 0.4, envMapIntensity: 1.1 });
    // LED screen above the goal and chevron panels either side; the group is turned to face the pitch
    const face = new THREE.Group();
    face.position.set(0, 0, -s * (L - 18));
    if (s < 0) face.rotation.y = Math.PI;
    // chevron screens either side of the goal, pointing in toward the net
    const chevTex = canvasTex(256, 160, (c) => {
      c.fillStyle = '#070a10'; c.fillRect(0, 0, 256, 160);
      c.strokeStyle = neonCss; c.shadowColor = neonCss; c.shadowBlur = 14; c.lineWidth = 14; c.lineJoin = 'miter';
      for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(60 + k * 58, 34); c.lineTo(110 + k * 58, 80); c.lineTo(60 + k * 58, 126); c.stroke(); }
      c.lineWidth = 6; c.strokeRect(5, 5, 246, 150);
    });
    for (const sx of [-1, 1]) {
      const m = plane(760, 480, new THREE.MeshBasicMaterial({ map: chevTex, toneMapped: false, side: THREE.DoubleSide }), sx * (GW + 760), GH * 0.75, 6);
      if (sx > 0) m.scale.x = -1;
      neonParts.push(m); face.add(m);
    }
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
    {
      const decalTex = hexPlateTexture(neonCss);
      decalTex.repeat.set(3600 / 540, 1900 / 312);
      const fade = canvasTex(8, 64, (c) => { const gr = c.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#c0c0c0'); gr.addColorStop(1, '#000000'); c.fillStyle = gr; c.fillRect(0, 0, 8, 64); });
      fade.colorSpace = THREE.NoColorSpace;
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(3600, 1900), new THREE.MeshStandardMaterial({ map: decalTex, alphaMap: fade, transparent: true, roughness: 0.55, metalness: 0.4, envMapIntensity: 0.8, depthWrite: false }));
      decal.rotation.x = -Math.PI / 2; decal.position.set(0, 3, -s * (L - 950)); decal.rotation.z = s > 0 ? 0 : Math.PI; decal.renderOrder = 1;
      neonParts.push(decal); g.add(decal);
    }
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
    setScore(b, o) { if (b !== lastScore[0] || o !== lastScore[1]) { lastScore = [b, o]; for (const d of scoreDraws) d(b, o); } },
    setNeonLook(on) {
      for (const p of neonParts) p.visible = on;
      // the translucent pitch lets only a faint reflection through (about a fifth of the first version)
      floorMat.map = on ? asphaltTex : grassTex; floorMat.roughness = on ? 0.62 : 0.85;
      floorMat.color.setRGB(on ? 1.35 : 1, on ? 1.15 : 1, on ? 0.92 : 1); // warm the cool night light so the asphalt reads grey-brown
      floorMat.transparent = on && !low; floorMat.opacity = on && !low ? 0.975 : 1; floorMat.needsUpdate = true;
      // cream panels in the neon city, the original warm wood in the sunset stadium
      (wall.material as THREE.MeshStandardMaterial).color.setRGB(on ? 1 : 0.85, on ? 1 : 0.53, on ? 1 : 0.31);
    },
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
      if (ledTex) ledTex.offset.x -= dt * 0.12;
      for (const r of recs) if (r.active) refreshJets(r);
      jetsS.instanceMatrix.needsUpdate = true; jetsL.instanceMatrix.needsUpdate = true;
      orbs.forEach((o, i) => { o.rotation.y += dt * 0.9; o.position.y = 120 + 8 * Math.sin(time * 1.7 + i); orbHalos[i].position.y = o.position.y; });
    },
  };
}
