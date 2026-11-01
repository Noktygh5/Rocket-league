import * as THREE from 'three';
import { ARENA, PADS, mirrorPads } from '@turboball/shared';

const BLUE = new THREE.Color(0x1f7bff);
const ORANGE = new THREE.Color(0xff8a1f);
const BLUE_WALL = new THREE.Color(0x2c55b8);
const ORANGE_WALL = new THREE.Color(0xc96a2c);
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
  // right wall (x = W), going +y
  line(W, -cy, W, cy, -1, 0, 10);
  arc(cx, cy, 0, Math.PI / 2);
  // back wall (y = L), going -x, with vertices on the goal posts
  const span = 2 * cx;
  const f = (x: number) => (cx - x) / span;
  line(cx, L, -cx, L, 0, -1, 12, [f(GW), f(-GW), f(GW - 1), f(-GW + 1)]);
  arc(-cx, cy, Math.PI / 2, Math.PI);
  line(-W, cy, -W, -cy, 1, 0, 10);
  arc(-cx, -cy, Math.PI, Math.PI * 1.5);
  line(-cx, -L, cx, -L, 0, 1, 12, [(GW + cx) / span, (-GW + cx) / span, (GW - 1 + cx) / span, (-GW + 1 + cx) / span]);
  arc(cx, -cy, Math.PI * 1.5, Math.PI * 2);
  // drop the duplicated joints
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
  const n = 8;
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
  t.anisotropy = 4;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  return t;
}

function floorTexture(): THREE.CanvasTexture {
  const w = 1024, h = 1280; // aspect 8192 : 10240
  return canvasTex(w, h, (g) => {
    const px = (x: number) => ((x + W) / (2 * W)) * w;
    const py = (y: number) => ((L - y) / (2 * L)) * h; // +y (orange) at the top
    g.fillStyle = '#244a2a';
    g.fillRect(0, 0, w, h);
    const stripe = (640 / (2 * L)) * h;
    for (let i = 0; i * stripe < h; i++) {
      if (i & 1) { g.fillStyle = 'rgba(170,230,140,0.07)'; g.fillRect(0, i * stripe, w, stripe); }
    }
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(10,40,10,0.10)' : 'rgba(200,255,160,0.07)';
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 1);
    }
    const ge = g.createLinearGradient(0, 0, 0, h);
    ge.addColorStop(0, 'rgba(0,0,0,0.30)'); ge.addColorStop(0.18, 'rgba(0,0,0,0)'); ge.addColorStop(0.82, 'rgba(0,0,0,0)'); ge.addColorStop(1, 'rgba(0,0,0,0.30)');
    g.fillStyle = ge; g.fillRect(0, 0, w, h);
    g.lineWidth = 4; g.strokeStyle = 'rgba(235,245,235,0.85)';
    g.beginPath(); g.moveTo(0, py(0)); g.lineTo(w, py(0)); g.stroke();
    g.beginPath(); g.arc(px(0), py(0), (1000 / (2 * W)) * w, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(235,245,235,0.9)';
    g.beginPath(); g.arc(px(0), py(0), 6, 0, Math.PI * 2); g.fill();
    for (const s of [-1, 1]) {
      g.strokeStyle = s < 0 ? 'rgba(130,180,255,0.9)' : 'rgba(255,190,120,0.9)';
      g.beginPath();
      g.rect(px(-1500), py(s * L), (3000 / (2 * W)) * w, (1500 / (2 * L)) * h * (s < 0 ? -1 : 1));
      g.stroke();
      g.beginPath(); g.arc(px(0), py(s * 2800), (700 / (2 * W)) * w, 0, Math.PI * 2); g.stroke();
    }
    g.strokeStyle = 'rgba(235,245,235,0.55)'; g.setLineDash([22, 18]); g.lineWidth = 3;
    for (const y of [-2560, 2560]) { g.beginPath(); g.moveTo(px(-W), py(y)); g.lineTo(px(W), py(y)); g.stroke(); }
    g.setLineDash([]);
  });
}

function wallTexture(): THREE.CanvasTexture {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#c9ced8'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.06})`;
      g.fillRect(0, Math.random() * 256, 256, 2 + Math.random() * 6);
    }
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0, 256, 5); g.fillRect(0, 0, 4, 256);
    g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(5, 5, 2, 251);
    g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 3;
    g.strokeRect(30, 30, 196, 196);
  }, true);
}

function fenceTexture(): THREE.CanvasTexture {
  return canvasTex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(205,215,230,0.62)'; g.lineWidth = 1.3;
    g.beginPath();
    for (let i = -128; i < 256; i += 32) { g.moveTo(i, 0); g.lineTo(i + 128, 128); g.moveTo(i + 128, 0); g.lineTo(i, 128); }
    g.stroke();
    g.strokeStyle = 'rgba(120,130,150,0.8)'; g.lineWidth = 2;
    g.strokeRect(0, 0, 128, 128);
  }, true);
}

function skyTexture(): THREE.CanvasTexture {
  return canvasTex(16, 512, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0.00, '#1b2554'); gr.addColorStop(0.30, '#4a4a92'); gr.addColorStop(0.46, '#c76f86');
    gr.addColorStop(0.50, '#ffb36e'); gr.addColorStop(0.53, '#ffcf93'); gr.addColorStop(0.56, '#3a3320'); gr.addColorStop(1.00, '#161a12');
    g.fillStyle = gr; g.fillRect(0, 0, 16, 512);
  });
}

function netTexture(): THREE.CanvasTexture {
  return canvasTex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2;
    g.beginPath();
    for (let i = -128; i < 256; i += 32) { g.moveTo(i, 0); g.lineTo(i + 128, 128); g.moveTo(i + 128, 0); g.lineTo(i, 128); }
    g.stroke();
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
  // the solid lower wall ends where the wire cage begins
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
      uv.push(arcLen[i] / 512, pLen[j] / 512);
      tmpC.copy(y < 0 ? BLUE_WALL : ORANGE_WALL);
      const shade = p.z < 420 ? THREE.MathUtils.lerp(1.05, 0.7, p.z / 420) : 1;
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
  group.add(new THREE.Mesh(mkGeo(idxLow), new THREE.MeshBasicMaterial({ map: wallTexture(), vertexColors: true, side: THREE.DoubleSide })));
  const fenceTex = fenceTexture();
  fenceTex.repeat.set(1 / 1.0, 1 / 1.0);
  const fenceMesh = new THREE.Mesh(mkGeo(idxFence), new THREE.MeshBasicMaterial({ map: fenceTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, color: 0xe6edf8 }));
  fenceMesh.renderOrder = 2;
  group.add(fenceMesh);

  // ---- floor (open sky above: no ceiling is drawn) ---------------------------------------------------
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
  const floor = new THREE.Mesh(fanGeo(0), new THREE.MeshBasicMaterial({ map: floorTexture(), side: THREE.DoubleSide }));
  group.add(floor);

  // ---- goals ---------------------------------------------------------------------------------------
  const netTex = netTexture();
  for (const s of [-1, 1]) {
    const team = s < 0 ? BLUE : ORANGE;
    const g = new THREE.Group();
    const depth = GD - L;
    const mid = L + depth / 2;
    const dark = new THREE.MeshBasicMaterial({ color: 0x0b1018, side: THREE.DoubleSide });
    const mk = (w: number, h: number, mat: THREE.Material, px: number, py: number, pz: number, rx = 0, ry = 0): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(px, py, pz); m.rotation.set(rx, ry, 0);
      return m;
    };
    const netMat = (rx: number, ry: number): THREE.MeshBasicMaterial => {
      const t = netTex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry);
      return new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.55, side: THREE.DoubleSide, color: 0xdfeaff, depthWrite: false });
    };
    g.add(mk(2 * GW, depth, dark, 0, 0.5, -s * mid, -Math.PI / 2)); // floor
    g.add(mk(2 * GW, depth, netMat(8, 4), 0, GH, -s * mid, -Math.PI / 2)); // roof (net)
    g.add(mk(depth, GH, netMat(4, 3), GW, GH / 2, -s * mid, 0, Math.PI / 2));
    g.add(mk(depth, GH, netMat(4, 3), -GW, GH / 2, -s * mid, 0, Math.PI / 2));
    g.add(mk(2 * GW, GH, netMat(8, 3), 0, GH / 2, -s * GD, 0, 0)); // back net
    // glowing frame
    const frame = new THREE.MeshBasicMaterial({ color: team });
    for (const px of [-GW, GW]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, GH, 8), frame);
      post.position.set(px, GH / 2, -s * L);
      g.add(post);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 2 * GW, 8), frame);
    bar.rotation.z = Math.PI / 2; bar.position.set(0, GH, -s * L);
    g.add(bar);
    // soft team panel above the goal on the back wall
    const panelTex = canvasTex(64, 64, (c) => {
      const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, s < 0 ? 'rgba(60,150,255,0.95)' : 'rgba(255,150,50,0.95)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1800, 700), new THREE.MeshBasicMaterial({ map: panelTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    panel.position.set(0, 1050, -s * (L - 6));
    panel.rotation.y = s < 0 ? 0 : Math.PI;
    g.add(panel);
    group.add(g);
  }

  // ---- sky, ground, hills, floodlights ---------------------------------------------------------------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 24, 16), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  group.add(sky);
  const m4 = new THREE.Matrix4();
  const back = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshBasicMaterial({ color: 0x2d4524 }));
  back.rotation.x = -Math.PI / 2; back.position.y = -30;
  group.add(back);
  const hillMat = new THREE.MeshBasicMaterial({ color: 0x2a3d22 });
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * Math.PI * 2 + 0.3, rad = 15000 + (i % 3) * 2500;
    const hill = new THREE.Mesh(new THREE.ConeGeometry(2600 + (i % 4) * 700, 1500 + (i % 5) * 400, 7), hillMat);
    hill.position.set(Math.cos(ang) * rad, 450, Math.sin(ang) * rad);
    group.add(hill);
  }
  const towerMat = new THREE.MeshBasicMaterial({ color: 0x2a2f3a });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3d0 });
  for (const [tx, ty] of [[-1, -0.6], [1, -0.6], [-1, 0.6], [1, 0.6], [-1, 0], [1, 0]] as [number, number][]) {
    const x = tx * (W + 1100), y = ty * L;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(35, 55, 2600, 6), towerMat);
    pole.position.set(x, 1300, -y);
    const head = new THREE.Mesh(new THREE.BoxGeometry(520, 300, 90), lampMat);
    head.position.set(x, 2700, -y); head.rotation.y = tx > 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(pole, head);
  }

  const rows = low ? 2 : 4;
  const crowdGeo = new THREE.BoxGeometry(80, 110, 80);
  const sideN = Math.floor((2 * L) / 110) * rows;
  const endN = Math.floor((2 * W) / 110) * rows;
  const crowd = new THREE.InstancedMesh(crowdGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), sideN * 2 + endN * 2);
  const stand = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x0d121b }), rows * 4);
  let ci = 0, si = 0;
  const cc = new THREE.Color();
  const place = (x: number, y: number, z: number, team: number): void => {
    m4.makeTranslation(x, y, z);
    crowd.setMatrixAt(ci, m4);
    const base = 0.08 + Math.random() * 0.16;
    cc.setRGB(base, base, base * 1.2);
    if (Math.random() < 0.5) cc.lerp(team < 0 ? BLUE : ORANGE, 0.35 + Math.random() * 0.25).multiplyScalar(0.6);
    if (Math.random() < 0.02) cc.set(0xffffff);
    crowd.setColorAt(ci++, cc);
  };
  for (let r = 0; r < rows; r++) {
    const y = 220 + r * 280, off = W + 480 + r * 340;
    for (const sx of [-1, 1]) {
      for (let k = 0; k < Math.floor((2 * L) / 110); k++) {
        const yy = -L + 60 + k * 110;
        place(sx * off, y, -yy, yy);
      }
      m4.compose(new THREE.Vector3(sx * (off + 120), y - 60, 0), new THREE.Quaternion(), new THREE.Vector3(260, 40, 2 * L + 400));
      stand.setMatrixAt(si++, m4);
    }
    for (const sy of [-1, 1]) {
      const eoff = L + 1100 + r * 330;
      for (let k = 0; k < Math.floor((2 * W) / 110); k++) place(-W + 60 + k * 110, y, -sy * eoff, sy);
      m4.compose(new THREE.Vector3(0, y - 60, -sy * (eoff + 120)), new THREE.Quaternion(), new THREE.Vector3(2 * W + 400, 40, 260));
      stand.setMatrixAt(si++, m4);
    }
  }
  crowd.count = ci; stand.count = si;
  crowd.instanceMatrix.needsUpdate = true;
  group.add(crowd, stand);

  // ---- boost pads -----------------------------------------------------------------------------------
  const largeSpots = mirrorPads(PADS.largeBase), smallSpots = mirrorPads(PADS.smallBase);
  const smallPads = new THREE.InstancedMesh(new THREE.CylinderGeometry(70, 70, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), smallSpots.length);
  const largePads = new THREE.InstancedMesh(new THREE.CylinderGeometry(150, 150, 12, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), largeSpots.length);
  const padIndex: { large: boolean; i: number }[] = [];
  largeSpots.forEach((p, i) => { m4.makeTranslation(p.x, 6, -p.y); largePads.setMatrixAt(i, m4); largePads.setColorAt(i, cc.set(0xffa21f)); padIndex.push({ large: true, i }); });
  smallSpots.forEach((p, i) => { m4.makeTranslation(p.x, 4, -p.y); smallPads.setMatrixAt(i, m4); smallPads.setColorAt(i, cc.set(0xffa21f)); padIndex.push({ large: false, i }); });
  group.add(smallPads, largePads);

  const pc = new THREE.Color();
  return {
    group, floor, smallPads, largePads, padIndex,
    setPadActive(idx, active, t01) {
      const e = padIndex[idx];
      const mesh = e.large ? largePads : smallPads;
      const k = active ? 1 : 0.12 + 0.3 * t01;
      pc.setRGB(1.0 * k, 0.6 * k, 0.12 * k);
      mesh.setColorAt(e.i, pc);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}
