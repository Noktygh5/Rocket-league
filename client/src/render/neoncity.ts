import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARENA } from '@turboball/shared';

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

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * Night sky for the neon city: deep teal-blue zenith, violet and magenta toward a hot orange horizon glow,
 * streaks of cloud, and a big white Voronoi wire dome like the holographic roof of the real cyberpunk arena.
 */
export function nightSkyTexture(): THREE.CanvasTexture {
  return canvasTex(2048, 1024, (g) => {
    const r = rng(11);
    const gr = g.createLinearGradient(0, 0, 0, 1024);
    gr.addColorStop(0.0, '#030b12');
    gr.addColorStop(0.2, '#07202a');
    gr.addColorStop(0.34, '#103540');
    gr.addColorStop(0.42, '#262f52');
    gr.addColorStop(0.47, '#6a3562');
    gr.addColorStop(0.495, '#e0704e');
    gr.addColorStop(0.505, '#ffb070');
    gr.addColorStop(0.52, '#10101c');
    gr.addColorStop(1.0, '#06060c');
    g.fillStyle = gr; g.fillRect(0, 0, 2048, 1024);
    // soft clouds, lit magenta/orange from below near the horizon (wrapped so the texture tiles)
    for (let i = 0; i < 140; i++) {
      const x = r() * 2048, y = 80 + r() * 400;
      const w = 120 + r() * 320, h = 10 + r() * 30;
      const near = Math.min(1, Math.max(0, (y - 120) / 330));
      const rr = Math.round(40 + 120 * near), gg = Math.round(70 + 10 * near), bb = Math.round(110 + 20 * near);
      const a = 0.06 + r() * 0.14;
      for (const dx of [-2048, 0, 2048]) {
        g.save();
        g.translate(x + dx, y); g.scale(w / h, 1);
        const cg = g.createRadialGradient(0, 0, 0, 0, 0, h);
        cg.addColorStop(0, `rgba(${rr},${gg},${bb},${a})`); cg.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
        g.fillStyle = cg; g.beginPath(); g.arc(0, 0, h, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    }
    // Voronoi wire dome: cell edges found on a coarse grid, drawn as thin glowing lines over the upper sky
    const sites: [number, number][] = [];
    for (let i = 0; i < 46; i++) sites.push([r() * 2048, 30 + r() * 450]);
    const GW = 1024, GH = 256, cw = 2048 / GW, ch = 512 / GH;
    const id = new Int16Array(GW * GH);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      let best = 1e9, bi = 0;
      for (let k = 0; k < sites.length; k++) {
        let dx = Math.abs(x * cw - sites[k][0]); if (dx > 1024) dx = 2048 - dx; // wrap horizontally
        const dy = y * ch - sites[k][1], d = dx * dx + dy * dy;
        if (d < best) { best = d; bi = k; }
      }
      id[y * GW + x] = bi;
    }
    // draw the edges on a scratch canvas, then composite once with a light blur (per-rect filters are far too slow)
    const scratch = document.createElement('canvas'); scratch.width = 2048; scratch.height = 1024;
    const sg = scratch.getContext('2d')!;
    sg.fillStyle = 'rgba(170,215,255,0.9)';
    for (let y = 0; y < GH - 1; y++) for (let x = 0; x < GW; x++) {
      const a = id[y * GW + x];
      if (a !== id[y * GW + ((x + 1) % GW)] || a !== id[(y + 1) * GW + x]) sg.fillRect(x * cw, y * ch, cw, ch);
    }
    g.save(); g.globalAlpha = 0.55; g.filter = 'blur(1.2px)'; g.drawImage(scratch, 0, 0); g.restore();
  }, true);
}

/**
 * Office-tower window atlas: a regular 12 x 12 grid of glass bays with thin frames. Glass is dark blue-grey; a minority of
 * bays are lit, clustered by floor so whole offices glow together (warm white, a few cool).
 */
function windowTexture(): THREE.CanvasTexture {
  return canvasTex(512, 512, (g) => {
    const r = rng(5);
    const N = 12, cell = 512 / N;
    g.fillStyle = '#0d121c'; g.fillRect(0, 0, 512, 512);
    for (let y = 0; y < N; y++) {
      const floorBias = r() < 0.4 ? 0.8 : r() < 0.5 ? 0.25 : 0.04;           // some floors busy, most quiet
      const warm = r() < 0.8;
      for (let x = 0; x < N; x++) {
        const wx = x * cell + 3, wy = y * cell + 4, ww = cell - 6, wh = cell - 9;
        if (r() < floorBias) {
          const lg = g.createLinearGradient(0, wy, 0, wy + wh);
          lg.addColorStop(0, warm ? '#ffe6bd' : '#d8ecff'); lg.addColorStop(1, warm ? '#f0b774' : '#9fc4e6');
          g.fillStyle = lg;
        } else {
          const dg = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
          dg.addColorStop(0, 'rgba(58,78,112,0.8)'); dg.addColorStop(1, 'rgba(26,36,58,0.9)');
          g.fillStyle = dg;
        }
        g.fillRect(wx, wy, ww, wh);
      }
    }
    g.fillStyle = 'rgba(8,10,16,0.9)';                                          // spandrel bands under each floor
    for (let y = 0; y < N; y++) g.fillRect(0, y * cell + cell - 5, 512, 5);
  }, true);
}

/** Rings of skyscrapers merged into one mesh with world-scale UVs so windows keep a constant size. */
export function buildSkyline(low: boolean, inner = 21000, outer = 32000, minH = 3000, maxH = 19000, base = low ? 70 : 150, seed = 404): THREE.Group {
  const r = rng(seed);
  const group = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const crownCols = [0xff4fd0, 0x36e0ff, 0xff8a2a, 0x8a6bff];
  const addColor = (g: THREE.BufferGeometry, c: THREE.Color): void => {
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let k = 0; k < col.length; k += 3) { col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  };
  for (let i = 0; i < base; i++) {
    const a = (i / base) * Math.PI * 2 + (r() - 0.5) * 0.05;
    const dist = inner + r() * (outer - inner);
    const w = 1300 + r() * 2500, d = 1300 + r() * 2500, h = minH + Math.pow(r(), 1.6) * (maxH - minH);
    const round = r() < 0.32;
    const g = round ? new THREE.CylinderGeometry(w * 0.5, w * 0.55, h, 26) : new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv as THREE.BufferAttribute, nrm = g.attributes.normal as THREE.BufferAttribute, pos = g.attributes.position as THREE.BufferAttribute;
    const tint = new THREE.Color().setHSL(0.58 + r() * 0.2, 0.35, 0.34 + r() * 0.2);
    const col = new Float32Array(pos.count * 3);
    for (let k = 0; k < uv.count; k++) {
      const ny = Math.abs(nrm.getY(k));
      if (round) {
        if (ny > 0.5) uv.setXY(k, 0.5, 0.5); else uv.setXY(k, uv.getX(k) * (Math.PI * w) / 4200, uv.getY(k) * h / 4200);
      } else {
        const nx = Math.abs(nrm.getX(k));
        if (ny > 0.5) uv.setXY(k, uv.getX(k) * w / 4200, uv.getY(k) * d / 4200);
        else uv.setXY(k, uv.getX(k) * (nx > 0.5 ? d : w) / 4200, uv.getY(k) * h / 4200);
      }
      const t = (pos.getY(k) + h / 2) / h;                       // 0 at the street, 1 at the roof: streets glow, roofs fade into the night
      const f = 1.15 - 0.6 * t;
      col[k * 3] = tint.r * f; col[k * 3 + 1] = tint.g * f; col[k * 3 + 2] = tint.b * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.rotateY(r() * Math.PI);
    const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
    g.translate(x, h / 2 - 200, z);
    parts.push(g);
    // roof furniture: antenna, red aircraft light, neon crown frame on the taller towers
    const roof = h - 200;
    if (r() < 0.55) {
      const ah = 500 + r() * 1400, ant = new THREE.CylinderGeometry(14, 22, ah, 5); ant.translate(x, roof + ah / 2, z);
      const dark = new THREE.BufferGeometry(); dark.setAttribute('position', ant.attributes.position); dark.setAttribute('normal', ant.attributes.normal); dark.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ant.attributes.position.count * 2), 2)); dark.setIndex(ant.index);
      addColor(dark, new THREE.Color(0x0a0c14)); parts.push(dark.toNonIndexed());
      const bulb = new THREE.BoxGeometry(70, 70, 70); bulb.translate(x, roof + ah, z); addColor(bulb, new THREE.Color(1, 0.12, 0.1)); glow.push(bulb);
    }
    if (round && h > maxH * 0.35 && r() < 0.7) {
      const c = new THREE.Color(crownCols[Math.floor(r() * crownCols.length)]);
      if (round) { const ring = new THREE.TorusGeometry(w * 0.52, 24, 6, 28); ring.rotateX(Math.PI / 2); ring.translate(x, roof - 30, z); addColor(ring, c); glow.push(ring); }
    }
  }
  const wt = windowTexture(); wt.minFilter = THREE.LinearMipmapLinearFilter; wt.anisotropy = 16;
  const norm = (g: THREE.BufferGeometry): THREE.BufferGeometry => { const t = g.index ? g.toNonIndexed() : g; if (!t.attributes.uv) t.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(t.attributes.position.count * 2), 2)); return t; };
  group.add(new THREE.Mesh(mergeGeometries(parts.map(norm), false)!, new THREE.MeshBasicMaterial({ map: wt, vertexColors: true, fog: true })));
  if (glow.length) group.add(new THREE.Mesh(mergeGeometries(glow.map((g) => { const t = norm(g); t.deleteAttribute('uv'); return t; }), false)!, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false })));
  return group;
}

function neonText(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  return canvasTex(w, h, draw);
}

/** Position on the arena-facing side of a tower, slightly proud of the surface, with a sideways spread. */
/** Every building (towers and street blocks) so signs can avoid being hidden behind one. */
let obstacles: Tower[] = [];
function onTower(towers: Tower[] | undefined, i: number, rnd: () => number, yMin: number, yMax: number, spread = 0.7): [number, number, number] {
  if (!towers || !towers.length) { const a = rnd() * Math.PI * 2, d = 11000 + rnd() * 3000; return [Math.cos(a) * d, yMin + rnd() * (yMax - yMin), Math.sin(a) * d]; }
  let best: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < towers.length; k++) {
    const t = towers[(i + k) % towers.length], len = Math.hypot(t.x, t.z) || 1, ux = -t.x / len, uz = -t.z / len;
    const side = (rnd() - 0.5) * 2 * t.r * spread, off = t.r * 1.32 + 120;      // clear of the tower's bulge
    const px = t.x + ux * off - uz * side, pz = t.z + uz * off + ux * side;
    const py = yMin + rnd() * Math.min(yMax - yMin, t.h * 0.7 - yMin);
    best = [px, py, pz];
    // reject spots that a nearer building would cut off when seen from the arena
    const dx = px, dz = pz, L2 = dx * dx + dz * dz;
    const blocked = obstacles.some((o) => {
      if (o === t) return false;
      const u = Math.max(0, Math.min(1, (o.x * dx + o.z * dz) / L2));
      const cx = dx * u, cz = dz * u;
      return u < 0.995 && Math.hypot(o.x - cx, o.z - cz) < o.r * 1.35 + 500 && o.h > py - 300;
    });
    if (!blocked) return best;
  }
  return best;
}

/** Glowing billboards: score leaderboard, katakana signs, colour-block ads. */
/**
 * Pushes a point straight outward until it clears the stadium footprint (stands, canopies and floodlight towers) plus `pad`,
 * so scenery can never poke into the arena. The footprint is a rectangle, not a circle, so ring-placed objects need this.
 */
function clearOfStadium(x: number, z: number, pad: number): [number, number] {
  const hx = ARENA.halfWidth + 3400 + pad, hz = ARENA.halfLength + 4000 + pad;
  const k = Math.max(Math.abs(x) / hx, Math.abs(z) / hz);
  return k >= 1 ? [x, z] : [x / (k || 1e-6), z / (k || 1e-6)];
}

/** Positions already taken by billboards, so signs do not overlap them. */
const taken: [number, number, number][] = [];
export function buildBillboards(towers?: Tower[]): THREE.Group {
  const group = new THREE.Group();
  const r = rng(77);
  const mk = (tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, side: THREE.DoubleSide, fog: false }));
    m.position.set(x, y, z);
    m.lookAt(0, y * 0.5, 0);
    return m;
  };
  const leaderboard = neonText(512, 640, (g) => {
    g.fillStyle = '#05060f'; g.fillRect(0, 0, 512, 640);
    g.strokeStyle = '#4de8ff'; g.lineWidth = 8; g.strokeRect(8, 8, 496, 624);
    g.fillStyle = '#ffe24a'; g.font = 'bold 76px Impact, sans-serif'; g.textAlign = 'center'; g.fillText('HIGH', 256, 100); g.fillText('SCORE', 256, 180);
    g.font = 'bold 44px monospace'; g.textAlign = 'left';
    for (let i = 0; i < 9; i++) {
      g.fillStyle = i % 2 ? '#7fefff' : '#ff9ad8';
      g.fillText(`${i + 1}  ${String(Math.floor(r() * 900000 + 100000))}`, 40, 260 + i * 42);
    }
  });
  const kata = (text: string, color: string, bg: string): THREE.CanvasTexture => neonText(512, 256, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, 512, 256);
    g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(10, 10, 492, 236);
    g.shadowColor = color; g.shadowBlur = 24;
    g.fillStyle = '#ffffff'; g.font = 'bold 96px "Hiragino Sans", "Yu Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256, 132);
  });
  /** Dark ad panel: muted gradient glow, a thin neon frame, a title and a tagline. */
  const ad = (title: string, tag: string, c1: string, c2: string): THREE.CanvasTexture => neonText(512, 320, (g) => {
    g.fillStyle = '#080b14'; g.fillRect(0, 0, 512, 320);
    const gr = g.createLinearGradient(0, 0, 512, 320); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    g.globalAlpha = 0.28; g.fillStyle = gr; g.fillRect(0, 0, 512, 320); g.globalAlpha = 1;
    g.fillStyle = gr; g.fillRect(0, 0, 512, 10); g.fillRect(0, 310, 512, 10);
    g.strokeStyle = c1; g.lineWidth = 4; g.shadowColor = c1; g.shadowBlur = 12; g.strokeRect(14, 22, 484, 276);
    g.shadowColor = c2; g.shadowBlur = 14; g.fillStyle = '#ffe9c8'; g.textAlign = 'center';
    g.font = 'bold 74px "Avenir Next Condensed", "DIN Condensed", Impact, sans-serif';
    g.font = 'bold 120px "Avenir Next Condensed", "DIN Condensed", Impact, sans-serif';
    g.fillText(title, 256, 195);
    if (tag) { g.shadowBlur = 0; g.fillStyle = 'rgba(220,230,255,0.82)'; g.font = '600 26px "Avenir Next", "Segoe UI", sans-serif'; g.fillText(tag, 256, 250); }
  });
  const sets: [THREE.Texture, number, number][] = [
    [ad('IB 45!', '', '#35a7b8', '#4a7fb0'), 2600, 1600], [ad('W SPEED', '', '#d98a4a', '#b0603c'), 2600, 1600],
  ];
  sets.forEach(([tex, w, h], i) => {
    const [px, py, pz] = onTower(towers, i * 3 + 1, r, 2500, 7000, 0.35);
    taken.push([px, py, pz]);
    group.add(mk(tex, w, h, px, py, pz));
  });
  return group;
}

/** Soft glowing smog planes in magenta, violet and cyan hanging between the arena and the skyline. */
export function buildHaze(): THREE.Group {
  const group = new THREE.Group();
  const tex = canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
  const colors = [0xff3fa8, 0x7a3dff, 0x18c8ff, 0xff7a3d, 0x6a5cff];
  const r = rng(9);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + r() * 0.2, dist = 9500 + r() * 3500;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6500 + r() * 4000, 2600 + r() * 2200),
      new THREE.MeshBasicMaterial({ map: tex, color: colors[i % colors.length], transparent: true, opacity: 0.22 + r() * 0.16, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
    { const [hx, hz] = clearOfStadium(Math.cos(a) * dist, Math.sin(a) * dist, 4500); m.position.set(hx, 600 + r() * 4500, hz); }
    m.lookAt(0, m.position.y, 0);
    group.add(m);
  }
  return group;
}

/** Orange/red/cyan neon wire frames and vertical light bars hung around the stadium, like the holographic scaffolding of the real map. */
export function buildNeonWires(): THREE.Group {
  const group = new THREE.Group();
  const r = rng(1234);
  const pal = [0xff5a2a, 0xff2e5e, 0x35e6ff, 0xffb02e, 0xff4fd8];
  const lines: Record<number, number[]> = {};
  const push = (c: number, a: THREE.Vector3, b: THREE.Vector3): void => { (lines[c] ??= []).push(a.x, a.y, a.z, b.x, b.y, b.z); };
  for (let i = 0; i < 22; i++) {
    const ang = r() * Math.PI * 2, dist = 10500 + r() * 4500, y0 = 200 + r() * 5000;
    const c = pal[Math.floor(r() * pal.length)];
    const p = new THREE.Vector3(Math.cos(ang) * dist, y0, Math.sin(ang) * dist);
    const kind = r();
    if (kind < 0.4) push(c, p, p.clone().add(new THREE.Vector3(0, 700 + r() * 2500, 0)));                       // vertical bar
    else if (kind < 0.8) { const t = new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang)).multiplyScalar(900 + r() * 3200); push(c, p, p.clone().add(t)); } // horizontal
    else { // box frame
      const wd = 700 + r() * 1500, ht = 500 + r() * 1200, t = new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang)).multiplyScalar(wd);
      const a0 = p.clone(), a1 = p.clone().add(t), a2 = a1.clone().add(new THREE.Vector3(0, ht, 0)), a3 = a0.clone().add(new THREE.Vector3(0, ht, 0));
      push(c, a0, a1); push(c, a1, a2); push(c, a2, a3); push(c, a3, a0);
    }
  }
  for (const [c, arr] of Object.entries(lines)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: Number(c), toneMapped: false, fog: false })));
  }
  return group;
}

// ---------------------------------------------------------------------------------------------------------------------
// Street-level detail modelled on the cyberpunk concept art: kanji signs, neon-crowned towers, monorail, tanks, drones.
// ---------------------------------------------------------------------------------------------------------------------

const emissive = (color: number, opacity = 1): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color, toneMapped: false, fog: false, transparent: opacity < 1, opacity });

/** Tall vertical neon signs with stacked kanji, like the shop signs between the towers. */
export function buildKanjiSigns(towers?: Tower[]): THREE.Group {
  const group = new THREE.Group();
  const r = rng(515);
  const words = ['防御', '铁壁', '电车站', '球', '爆', '飞', '東京', '雑貨', '拉面', '速度', '夜', '旅館'];
  const schemes: [string, string, string][] = [ // text, frame, background
    ['#fff6c8', '#ffc83a', '#1c1204'], ['#ffffff', '#ff4fa8', '#1a0516'], ['#d9fbff', '#36e0ff', '#04141c'],
    ['#ffe0d0', '#ff7a2a', '#1c0a04'], ['#e6ffd9', '#6bff7a', '#04180a'],
  ];
  const sign = (word: string, sc: [string, string, string]): THREE.CanvasTexture => canvasTex(160, 160 * (0.9 + word.length * 0.6), (g) => {
    const h = g.canvas.height;
    g.fillStyle = sc[2]; g.fillRect(0, 0, 160, h);
    g.strokeStyle = sc[1]; g.lineWidth = 7; g.shadowColor = sc[1]; g.shadowBlur = 16; g.strokeRect(6, 6, 148, h - 12);
    g.fillStyle = sc[0]; g.font = 'bold 96px "Hiragino Sans GB", "PingFang SC", "Yu Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    [...word].forEach((ch, i) => g.fillText(ch, 80, 90 + i * 96));
  });
  for (let i = 0; i < 22; i++) {
    const word = words[Math.floor(r() * words.length)], sc = schemes[Math.floor(r() * schemes.length)];
    const tex = sign(word, sc);
    const aspect = tex.image.height / tex.image.width, w = 420 + r() * 260;
    let [px, py, pz] = onTower(towers, i, r, 1200, 6500);
    for (let tries = 0; tries < 6 && taken.some((t) => Math.hypot(t[0] - px, t[1] - py, t[2] - pz) < 2600); tries++) [px, py, pz] = onTower(towers, i + tries + 1, r, 1200, 6500);
    taken.push([px, py, pz]);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * aspect), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false, side: THREE.DoubleSide }));
    m.position.set(px, py, pz); const y = py;
    m.lookAt(0, y, 0);
    group.add(m);
  }
  // round neon medallions with a ball glyph
  for (let i = 0; i < 6; i++) {
    const col = ['#ff3d7f', '#36e0ff', '#ffc83a'][i % 3];
    const tex = canvasTex(256, 256, (g) => {
      g.fillStyle = '#0a0612'; g.beginPath(); g.arc(128, 128, 120, 0, Math.PI * 2); g.fill();
      g.strokeStyle = col; g.lineWidth = 12; g.shadowColor = col; g.shadowBlur = 22; g.beginPath(); g.arc(128, 128, 108, 0, Math.PI * 2); g.stroke();
      g.fillStyle = col; g.font = 'bold 140px "PingFang SC", "Hiragino Sans GB", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('球', 128, 140);
    });
    const [px, py, pz] = onTower(towers, i * 2 + 5, r, 2200, 6500, 0.4);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, fog: false, side: THREE.DoubleSide }));
    m.position.set(px, py, pz); m.lookAt(0, py, 0);
    group.add(m);
  }
  return group;
}

/** Glowing cylindrical towers with neon crowns and glowing tops, plus slim neon-edged slabs. */
export function buildBeaconTowers(): THREE.Group {
  const group = new THREE.Group();
  const r = rng(808);
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b1430, metalness: 0.85, roughness: 0.25, envMapIntensity: 1.6 });
  const crowns = [0xff3da8, 0x36e0ff, 0xff8a2a, 0x8a5bff];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + r() * 0.2, dist = 13500 + r() * 4500;
    const rad = 650 + r() * 700, h = 4500 + r() * 9000;
    const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.92, rad, h, 28), glass);
    body.position.set(x, h / 2 - 100, z);
    group.add(body);
    const col = crowns[i % crowns.length];
    for (let k = 0; k < 3; k++) { // neon rings up the shaft
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rad * (1.0 - k * 0.01), 16, 8, 40), emissive(col));
      ring.rotation.x = Math.PI / 2; ring.position.set(x, h * (0.55 + k * 0.17), z);
      group.add(ring);
    }
    // vertical neon light strips
    for (let s = 0; s < 4; s++) {
      const ang = (s / 4) * Math.PI * 2 + i;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(34, h * 0.8, 34), emissive(i % 2 ? 0x36e0ff : 0xff5ac8, 0.9));
      strip.position.set(x + Math.cos(ang) * rad * 0.98, h * 0.45, z + Math.sin(ang) * rad * 0.98);
      group.add(strip);
    }
    if (i % 3 === 0) { // glowing cap, like the lit pink tower in the concept art
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.8, rad * 0.9, 700, 28), emissive(0xff4fd0, 0.85));
      cap.position.set(x, h + 250, z);
      group.add(cap);
    }
  }
  return group;
}

/** Elevated monorail loop with a blue neon line, on supports, seen behind the stands. */
export function buildMonorail(): THREE.Group {
  const group = new THREE.Group();
  const R = 13800, y = 4300, segs = 110, arc = Math.PI * 1.55, start = 0.7;
  const parts: THREE.BufferGeometry[] = [];
  const neon: THREE.BufferGeometry[] = [];
  for (let i = 0; i < segs; i++) {
    const a = start + (i / segs) * arc, len = (R * arc) / segs * 1.04;
    const b = new THREE.BoxGeometry(len, 230, 520);
    b.rotateY(-a - Math.PI / 2); b.translate(Math.cos(a) * R, y, Math.sin(a) * R);
    parts.push(b);
    const n = new THREE.BoxGeometry(len * 0.98, 34, 30);
    n.rotateY(-a - Math.PI / 2); n.translate(Math.cos(a) * (R - 262), y + 40, Math.sin(a) * (R - 262));
    neon.push(n);
    if (i % 8 === 0) { const p = new THREE.CylinderGeometry(120, 160, y, 10); p.translate(Math.cos(a) * R, y / 2 - 100, Math.sin(a) * R); parts.push(p); }
  }
  group.add(new THREE.Mesh(mergeGeometries(parts.map((g) => g.index ? g.toNonIndexed() : g), false)!, new THREE.MeshStandardMaterial({ color: 0x1a2038, metalness: 0.7, roughness: 0.4, envMapIntensity: 1.2 })));
  group.add(new THREE.Mesh(mergeGeometries(neon.map((g) => g.index ? g.toNonIndexed() : g), false)!, emissive(0x3aa0ff)));
  return group;
}

/** Fat storage tanks with curved pipes, like the industrial plant in the foreground of the concept art. */
export function buildTanks(): THREE.Group {
  const group = new THREE.Group();
  const r = rng(321);
  const metal = new THREE.MeshStandardMaterial({ color: 0x232838, metalness: 0.8, roughness: 0.38, envMapIntensity: 1.4 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.25 + r() * 0.2, dist = 11200 + r() * 1800;
    const rad = 380 + r() * 260, h = 1600 + r() * 1800;
    const [x, z] = clearOfStadium(Math.cos(a) * dist, Math.sin(a) * dist, rad * 2 + 1500);   // leaves room for the pipe too
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, h, 24), metal);
    tank.position.set(x, h / 2 - 40, z);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(rad * 1.01, rad * 1.01, 60, 24), emissive(i % 2 ? 0xff4fd0 : 0x36e0ff));
    band.position.set(x, h * 0.62, z);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(rad, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), metal);
    dome.position.set(x, h - 40, z);
    group.add(tank, band, dome);
    // pipe: arcs out of the tank and back into the ground
    const dir = new THREE.Vector3(Math.cos(a + 0.5), 0, Math.sin(a + 0.5));
    const p0 = new THREE.Vector3(x, h * 0.8, z), p3 = p0.clone().addScaledVector(dir, rad * 4).setY(-40);
    const curve = new THREE.CubicBezierCurve3(p0, p0.clone().setY(h + 500), p3.clone().setY(h * 0.9), p3);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 70, 10, false), metal));
  }
  return group;
}

/** Tall orange columns of light around the stadium (like the four beams in the reference) with a bright core and a base glow. */
export function buildLightBeams(): THREE.Group {
  const group = new THREE.Group();
  const W = ARENA.halfWidth, L = ARENA.halfLength;
  const tex = canvasTex(32, 128, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.08, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0.12)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 128);
    const gx = g.createLinearGradient(0, 0, 32, 0); gx.addColorStop(0, 'rgba(0,0,0,0.9)'); gx.addColorStop(0.5, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,0.9)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = gx; g.fillRect(0, 0, 32, 128);                   // soft edges
  });
  const glowTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,200,120,1)'); gr.addColorStop(1, 'rgba(255,120,30,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
  const spots: [number, number][] = [[-0.55, -0.8], [0.55, -0.8], [-0.55, 0.8], [0.55, 0.8], [-1, 0], [1, 0]];
  for (const [fx, fz] of spots) {
    const x = fx * (W + 5200), z = fz * (L + 5600), h = 9000;       // well outside the stadium, behind the stands
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 0.55, 0.18).multiplyScalar(1.6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(70, 110, h, 10, 1, true), mat); beam.position.set(x, h / 2, z);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(16, 24, h, 8, 1, true), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 0.95, 0.8).multiplyScalar(2.2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide })); core.position.copy(beam.position);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.set(x, 30, z);
    group.add(beam, core, glow);
  }
  return group;
}

/** A few hovering delivery drones with cyan thrusters, like the flying machines over the concept-art street. */
export function buildDrones(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x3a3358, metalness: 0.7, roughness: 0.35, envMapIntensity: 1.5 });
  const glowTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(120,230,255,1)'); gr.addColorStop(1, 'rgba(120,230,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  const spots: [number, number, number][] = [[-5200, 5600, -9800], [7400, 6800, -8200], [9800, 4800, 6200], [-8800, 7600, 5400], [1500, 9400, 12200]];
  for (const [x, y, z] of spots) {
    const d = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.SphereGeometry(260, 18, 12), body); hull.scale.set(1.5, 0.7, 1.1);
    d.add(hull);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 480, 8), body); arm.rotation.z = Math.PI / 2; arm.position.set(0, 60, s * 190); arm.rotation.x = Math.PI / 2;
      d.add(arm);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
      glow.position.set(0, -140, s * 300); glow.rotation.x = -Math.PI / 2;
      d.add(glow);
    }
    d.position.set(x, y, z); d.lookAt(0, y, 0);
    group.add(d);
  }
  return group;
}


// ---------------------------------------------------------------------------------------------------------------------
// Hero towers: a handful of large, organic towers like the ones in the reference art (not a ring of boxes).
// ---------------------------------------------------------------------------------------------------------------------

/** Shared clock for the window flicker (set once per frame by the renderer). */
export const cityTime = { value: 0 };

function cityMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ map, vertexColors: true, fog: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCityTime = cityTime;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uCityTime;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // a share of the lit windows switch off and on over time, so the city feels alive
          vec2 cell = floor(vMapUv * 12.0);
          float hsh = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          float lum = dot(diffuseColor.rgb, vec3(0.333));
          float phase = floor(uCityTime * 0.35 + hsh * 40.0);
          float flip = fract(sin(dot(cell + phase, vec2(39.3468, 11.135))) * 24634.6345);
          float off = step(0.9, flip) * step(0.3, lum);
          diffuseColor.rgb *= 1.0 - 0.85 * off;
        }`);
  };
  mat.customProgramCacheKey = () => 'citywindows';
  return mat;
}

export interface Tower { x: number; z: number; r: number; h: number }

/** Lathe tower: bulging, tapering glass shaft with stepped shoulders and a glowing crown. Returns geometry with windows UVs and height-shaded vertex colours. */
function lathe(R: number, h: number, kind: number, tint: THREE.Color): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let k: number;
    if (kind === 0) k = 1 + 0.16 * Math.sin(Math.PI * t * 1.3) - 0.28 * t * t;               // belly then taper
    else if (kind === 1) k = 1 - 0.12 * t + 0.08 * Math.sin(t * Math.PI * 6) * (t > 0.55 ? 1 : 0.2); // ribbed shoulders
    else k = 0.78 + 0.22 * Math.pow(1 - t, 0.6) + (t > 0.9 ? -0.35 * (t - 0.9) * 10 : 0);       // slim, tapering crown
    pts.push(new THREE.Vector2(Math.max(20, R * k), t * h));
  }
  const g = new THREE.LatheGeometry(pts, 40);
  const uv = g.attributes.uv as THREE.BufferAttribute, pos = g.attributes.position as THREE.BufferAttribute;
  const circ = Math.PI * 2 * R;
  const col = new Float32Array(pos.count * 3);
  for (let k = 0; k < uv.count; k++) {
    uv.setXY(k, uv.getX(k) * circ / 3000, uv.getY(k) * h / 3000);
    const t = pos.getY(k) / h, f = 1.2 - 0.62 * t;
    col[k * 3] = tint.r * f; col[k * 3 + 1] = tint.g * f; col[k * 3 + 2] = tint.b * f;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Stepped slab tower: three stacked, narrowing blocks like the rectangular towers behind the arena in the in-game shot. */
function slab(w: number, d: number, h: number, tint: THREE.Color): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tiers: [number, number][] = [[1, 0.58], [0.82, 0.3], [0.58, 0.12]];
  let y = 0;
  for (const [s, frac] of tiers) {
    const hh = h * frac, g = new THREE.BoxGeometry(w * s, hh, d * s);
    const uv = g.attributes.uv as THREE.BufferAttribute, nrm = g.attributes.normal as THREE.BufferAttribute, pos = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    for (let k = 0; k < uv.count; k++) {
      const ny = Math.abs(nrm.getY(k)), nx = Math.abs(nrm.getX(k));
      if (ny > 0.5) uv.setXY(k, uv.getX(k) * w * s / 1700, uv.getY(k) * d * s / 1700);
      else uv.setXY(k, uv.getX(k) * (nx > 0.5 ? d * s : w * s) / 1700, uv.getY(k) * hh / 1700);
      const t = (y + pos.getY(k) + hh / 2) / h, f = 1.2 - 0.62 * t;
      col[k * 3] = tint.r * f; col[k * 3 + 1] = tint.g * f; col[k * 3 + 2] = tint.b * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.translate(0, y + hh / 2, 0);
    parts.push(g.toNonIndexed());
    y += hh;
  }
  return mergeGeometries(parts, false)!;
}

/**
 * The city: about a dozen big towers close to the arena plus a few hazy silhouettes behind them. Returns the group and the
 * tower list so signs can be hung on their faces.
 */
export function buildHeroCity(low: boolean): { group: THREE.Group; towers: Tower[] } {
  const group = new THREE.Group();
  const r = rng(2024);
  const wt = windowTexture(); wt.minFilter = THREE.LinearMipmapLinearFilter; wt.anisotropy = 16;
  const mat = cityMaterial(wt);
  const neonMat = (c: number, o = 1): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: c, toneMapped: false, fog: false, transparent: o < 1, opacity: o });
  const towers: Tower[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const glow: THREE.Mesh[] = [];
  const roofParts: THREE.BufferGeometry[] = [];
  const tints = [0xffb070, 0x6fb4ff, 0xffd09a, 0x7fd0e8, 0xff9ac0, 0x8fa4ff, 0xffa860];   // warm amber and cool cyan/blue lit-window tints, a little magenta
  const COUNT = low ? 9 : 13;
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2 + (r() - 0.5) * 0.25;
    const dist = 10200 + r() * 3600;
    const shape = i % 4;                                   // 0 tall slab, 1 tapered round tower, 2 low wide block, 3 stepped tower
    const R = (shape === 2 ? 1500 : 800) + r() * 700, h = shape === 2 ? 3500 + r() * 2500 : 6500 + r() * 10500;
    const round = shape === 1;
    const tint = new THREE.Color(tints[Math.floor(r() * tints.length)]).multiplyScalar(0.5);   // dimmer so the city stays calm behind the play
    const [x, z] = clearOfStadium(Math.cos(a) * dist, Math.sin(a) * dist, R * 1.4 + 300);
    let g: THREE.BufferGeometry;
    if (round) {
      // plain glass cylinder with a flat roof
      g = new THREE.CylinderGeometry(R * (0.55 + r() * 0.2), R * 1.05, h, 36);   // tapers toward the top
      const uv = g.attributes.uv as THREE.BufferAttribute, pos = g.attributes.position as THREE.BufferAttribute, nrm = g.attributes.normal as THREE.BufferAttribute;
      const col = new Float32Array(pos.count * 3);
      for (let k = 0; k < uv.count; k++) {
        if (Math.abs(nrm.getY(k)) > 0.5) uv.setXY(k, 0.5, 0.5); else uv.setXY(k, uv.getX(k) * (Math.PI * 2 * R) / 1700, uv.getY(k) * h / 1700);
        const f = 1.15 - 0.55 * ((pos.getY(k) + h / 2) / h);
        col[k * 3] = tint.r * f; col[k * 3 + 1] = tint.g * f; col[k * 3 + 2] = tint.b * f;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.translate(0, h / 2, 0);
    } else {
      g = shape === 2 ? slab(R * 2.4, R * 1.8, h, tint) : slab(R * (shape === 0 ? 1.2 : 1.8) + r() * 300, R * (shape === 0 ? 1.1 : 1.6) + r() * 300, h, tint);
    }
    g.rotateY(r() * Math.PI); g.translate(x, -300, z);
    geos.push(g.index ? g.toNonIndexed() : g);
    towers.push({ x, z, r: round ? R : R * 1.2, h });
    // rooftop plant: a machinery box and a small tank
    const roofBox = new THREE.BoxGeometry(R * 0.7, 260, R * 0.5); roofBox.translate(x, h - 300 + 130, z);
    const roofTank = new THREE.CylinderGeometry(R * 0.14, R * 0.14, 300, 12); roofTank.translate(x + R * 0.35, h - 300 + 150 + 260, z - R * 0.1);
    for (const rg of [roofBox, roofTank]) {
      const t = rg.toNonIndexed(); t.deleteAttribute('uv');
      const dark = new Float32Array(t.attributes.position.count * 3).fill(0.12);
      t.setAttribute('color', new THREE.BufferAttribute(dark, 3));
      roofParts.push(t);
    }
  }
  // dense street blocks hugging the stadium: the packed, warm-lit foreground of the real map
  const BL = low ? 14 : 30;
  for (let i = 0; i < BL; i++) {
    const a = (i / BL) * Math.PI * 2 + r() * 0.1;
    const ex = ARENA.halfWidth + 3500 + r() * 1500, ey = ARENA.halfLength + 3700 + r() * 2000;
    const w = 1300 + r() * 1200, d = 1200 + r() * 1000, h = 2800 + r() * 4800;
    const [x, z] = clearOfStadium(Math.cos(a) * ex, Math.sin(a) * ey, Math.max(w, d) * 0.8 + 600);
    const warm = new THREE.Color().setHSL(0.06 + r() * 0.08, 0.5, 0.42);
    const g = slab(w, d, h, warm);
    const ry = Math.atan2(-x, -z);
    g.rotateY(ry); g.translate(x, -300, z);
    geos.push(g.index ? g.toNonIndexed() : g);
    towers.push({ x, z, r: w * 0.5, h });
    const band = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, 70, d * 1.04), neonMat([0xff8a2a, 0xff4fd0, 0x36e0ff, 0xffd34a][i % 4], 0.95));
    band.position.set(x, h * 0.3 - 300, z); band.rotation.y = ry; glow.push(band);
  }
  // facade detail: balcony slabs with rails, vertical pipes with brackets, rooftop tanks and AC units on the street blocks
  const detail: THREE.BufferGeometry[] = [];
  const addDetail = (g: THREE.BufferGeometry, ry: number, x: number, z: number): void => {
    g.rotateY(ry); g.translate(x, -300, z);
    const t = g.index ? g.toNonIndexed() : g; t.deleteAttribute('uv'); detail.push(t);
  };
  for (const t of towers.slice(towers.length - BL)) {
    const ry = Math.atan2(-t.x, -t.z), w = t.r * 2, h1 = t.h * 0.58, dd = w * 0.8;
    const fz = dd * 0.5 + 60;                                        // facade plane in block-local space
    for (let y = 700; y < h1 - 200; y += 420) {
      addDetail(new THREE.BoxGeometry(w * 0.96, 26, 150).translate(0, y, fz), ry, t.x, t.z);                                  // balcony slab
      addDetail(new THREE.BoxGeometry(w * 0.96, 70, 8).translate(0, y + 46, fz + 72), ry, t.x, t.z);                           // rail
    }
    for (const sx of [-0.38, 0.38]) {
      addDetail(new THREE.CylinderGeometry(34, 34, h1, 10).translate(w * sx, h1 / 2, fz + 20), ry, t.x, t.z);                  // pipe
      for (let y = 500; y < h1; y += 1100) addDetail(new THREE.BoxGeometry(80, 24, 70).translate(w * sx, y, fz + 8), ry, t.x, t.z); // bracket
    }
    addDetail(new THREE.CylinderGeometry(190, 190, 380, 16).translate(w * 0.22, t.h + 190 - 100, -dd * 0.1), ry, t.x, t.z);   // roof water tank
    addDetail(new THREE.BoxGeometry(260, 120, 200).translate(-w * 0.25, t.h + 20, dd * 0.1), ry, t.x, t.z);                   // AC unit
  }
  // great curved pipes leaving the hero towers, like the plant in the concept art
  for (const t of towers.slice(0, COUNT)) {
    const len = Math.hypot(t.x, t.z) || 1, ux = t.x / len, uz = t.z / len, p0 = new THREE.Vector3(t.x + ux * t.r, t.h * 0.3 - 300, t.z + uz * t.r);   // pipes leave the far side of the tower, away from the arena and its billboards
    const p3 = new THREE.Vector3(t.x + ux * (t.r + 250), -100, t.z + uz * (t.r + 250));
    const curve = new THREE.CubicBezierCurve3(p0, p0.clone().add(new THREE.Vector3(ux * 900, 700, uz * 900)), p3.clone().add(new THREE.Vector3(-ux * 300, 1400, -uz * 300)), p3);
    const tube = new THREE.TubeGeometry(curve, 28, 60, 10, false); detail.push(tube.toNonIndexed()); tube.deleteAttribute('uv');
  }
  const detailMat = new THREE.MeshStandardMaterial({ color: 0x232838, metalness: 0.8, roughness: 0.38, envMapIntensity: 1.3 });
  for (const d of detail) d.deleteAttribute('uv');
  if (detail.length) group.add(new THREE.Mesh(mergeGeometries(detail.map((d) => { const t = d.index ? d.toNonIndexed() : d; t.deleteAttribute('uv'); return t; }), false)!, detailMat));
  group.add(new THREE.Mesh(mergeGeometries(geos, false)!, mat));
  if (roofParts.length) group.add(new THREE.Mesh(mergeGeometries(roofParts, false)!, new THREE.MeshBasicMaterial({ vertexColors: true })));
  glow.forEach((m) => group.add(m));
  // far skyline layers: three rings of silhouettes at growing distance, each hazier and bluer, so the horizon is full
  const far: THREE.BufferGeometry[] = [];
  const layers: [number, number, number, number][] = [[20000, 26000, 0.2, 18], [28000, 34000, 0.15, 22], [36000, 44000, 0.11, 26]];
  const layerCount = low ? 0.5 : 1;
  for (const [d0, d1, shade, cnt] of layers) for (let i = 0; i < Math.round(cnt * layerCount); i++) {
    const a = (i / Math.round(cnt * layerCount)) * Math.PI * 2 + r() * 0.3, dist = d0 + r() * (d1 - d0), w = 1800 + r() * 3200, h = 5000 + r() * 16000;
    const g = r() < 0.4 ? new THREE.CylinderGeometry(w * 0.3, w * 0.45, h, 12) : new THREE.BoxGeometry(w, h, w * (0.6 + r() * 0.6));
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let k = 0; k < col.length; k += 3) { col[k] = shade * 0.7; col[k + 1] = shade * 0.85; col[k + 2] = shade * 1.5; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.translate(Math.cos(a) * dist, h / 2 - 300, Math.sin(a) * dist);
    const t = g.toNonIndexed(); far.push(t);
  }
  group.add(new THREE.Mesh(mergeGeometries(far, false)!, new THREE.MeshBasicMaterial({ vertexColors: true, map: wt, fog: true })));
  return { group, towers: towers.slice(0, COUNT) };   // signs and billboards only go on the big towers (the street blocks have pipes on their faces)
}


/** Long elevated gantries behind each goal, with a glowing blue neon edge, like the monorail beam crossing the real map's sky. */
export function buildGantries(): THREE.Group {
  const group = new THREE.Group();
  const W = ARENA.halfWidth, L = ARENA.halfLength;
  const metal = new THREE.MeshStandardMaterial({ color: 0x151a28, metalness: 0.75, roughness: 0.4, envMapIntensity: 1.1 });
  for (const sz of [-1, 1]) {
    const z = sz * (L + 4300), len = 2 * W + 9000;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(len, 340, 700), metal); beam.position.set(0, 4600, z);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 46, 36), new THREE.MeshBasicMaterial({ color: 0x3aa0ff, toneMapped: false, fog: false })); strip.position.set(0, 4640, z - sz * 360);
    const strip2 = new THREE.Mesh(new THREE.BoxGeometry(len, 30, 30), new THREE.MeshBasicMaterial({ color: 0xff8a2a, toneMapped: false, fog: false })); strip2.position.set(0, 4440, z - sz * 360);
    group.add(beam, strip, strip2);
  }
  return group;
}


/**
 * Reflection environment for the neon city: the night sky plus ring of bright coloured light panels and overhead strips,
 * so glossy paint and glass pick up pink, cyan and orange streaks instead of a flat dark sky.
 */
export function neonEnvScene(sky: THREE.Texture): THREE.Scene {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, toneMapped: false })));
  const r = rng(31337);
  const cols = [0xff3fa8, 0x36e0ff, 0xff8a2a, 0xffffff, 0x8a5bff, 0x36e0ff, 0xff3fa8];
  const panel = (w: number, h: number, az: number, el: number, col: number, gain: number): void => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(gain), side: THREE.DoubleSide, toneMapped: false }));
    const R = 88;
    m.position.set(Math.cos(az) * Math.cos(el) * R, Math.sin(el) * R, Math.sin(az) * Math.cos(el) * R);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  for (let i = 0; i < 22; i++) panel(14 + r() * 26, 5 + r() * 10, (i / 22) * Math.PI * 2 + r() * 0.2, 0.05 + r() * 0.55, cols[i % cols.length], 3.5 + r() * 2);
  for (let i = 0; i < 4; i++) panel(60, 4, (i / 4) * Math.PI * 2, 1.15, 0xffffff, 4);          // overhead light bars (glint along the roof and hood)
  return scene;
}


/** Low drifting fog banks around the plaza (outside the pitch), tinted by the neon light, slowly moving. */
export const cityFog: THREE.Texture[] = [];
export function buildCityFog(): THREE.Group {
  const group = new THREE.Group();
  const mkTex = (seed: number): THREE.CanvasTexture => {
    const r = rng(seed);
    const t = canvasTex(256, 256, (g) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 90; i++) {
        const x = r() * 256, y = r() * 256, rad = 20 + r() * 50;
        for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) {
          const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad); gr.addColorStop(0, `rgba(255,255,255,${0.1 + r() * 0.16})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
        }
      }
    }, true);
    t.repeat.set(7, 7);
    return t;
  };
  const cols = [0x2fd0ff, 0xff3fa8, 0xff8a2a];
  [160, 520, 1000].forEach((y, i) => {
    const tex = mkTex(70 + i); cityFog.push(tex);
    const m = new THREE.Mesh(new THREE.RingGeometry(9800, 42000, 72, 1), new THREE.MeshBasicMaterial({ map: tex, color: cols[i], transparent: true, opacity: 0.16 - i * 0.03, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.y = y;
    group.add(m);
  });
  return group;
}

/** Big airships cruising over the city with glowing undersides and side screens. */
export function buildAirships(): THREE.Group {
  const group = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0x2a2e3f, metalness: 0.7, roughness: 0.4, envMapIntensity: 1.4 });
  const glowTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
  const spots: [number, number, number, number, number][] = [[-12000, 9800, -17000, 0.6, 0xff4fd0], [15500, 11800, -9000, -0.4, 0x36e0ff], [3000, 10200, 19000, 2.6, 0xffb02e]];
  for (const [x, y, z, rot, c] of spots) {
    const ship = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), hull); body.scale.set(1700, 420, 480);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 8, 40), new THREE.MeshBasicMaterial({ color: c, toneMapped: false })); belt.scale.set(1700, 420, 480); belt.rotation.y = Math.PI / 2; belt.rotation.x = Math.PI / 2; belt.scale.set(480, 1700, 420);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(520, 520, 40), hull); fin.position.set(-1500, 0, 0);
    const fin2 = fin.clone(); fin2.rotation.x = Math.PI / 2;
    const gondola = new THREE.Mesh(new THREE.BoxGeometry(520, 140, 200), hull); gondola.position.set(80, -430, 0);
    const underglow = new THREE.Mesh(new THREE.PlaneGeometry(2400, 800), new THREE.MeshBasicMaterial({ map: glowTex, color: c, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
    underglow.rotation.x = -Math.PI / 2; underglow.position.y = -520;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1000, 300), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.2), toneMapped: false, fog: false, side: THREE.DoubleSide })); screen.position.set(100, 40, 485);
    ship.add(body, fin, fin2, gondola, underglow, screen);
    ship.position.set(x, y, z); ship.rotation.y = rot;
    group.add(ship);
  }
  return group;
}

/** Big dark pipes looping down from the gantries, like the hanging machinery over the street in the concept art. */
export function buildHangingPipes(): THREE.Group {
  const group = new THREE.Group();
  const W = ARENA.halfWidth, L = ARENA.halfLength;
  const metal = new THREE.MeshStandardMaterial({ color: 0x1e2332, metalness: 0.8, roughness: 0.36, envMapIntensity: 1.3 });
  for (const sz of [-1, 1]) for (const sx of [-0.62, 0.05, 0.7]) {
    const x = sx * (W + 2000), z = sz * (L + 4300);
    const curve = new THREE.CubicBezierCurve3(new THREE.Vector3(x, 4440, z), new THREE.Vector3(x + 500, 2200, z - sz * 300), new THREE.Vector3(x - 700, 1700, z - sz * 700), new THREE.Vector3(x - 900, 300, z - sz * 1200));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 85, 10, false), metal));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(150, 150, 180, 14), metal); cap.position.set(x, 4300, z); group.add(cap);
    const band = new THREE.Mesh(new THREE.TorusGeometry(88, 12, 6, 16), new THREE.MeshBasicMaterial({ color: 0x36e0ff, toneMapped: false })); band.position.set(x - 300, 1950, z - sz * 400); band.rotation.x = 1.2; group.add(band);
  }
  return group;
}
