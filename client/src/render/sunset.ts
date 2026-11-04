import * as THREE from 'three';

/** The original sunset farm stadium scenery: hills, barns, windmill, trees and power lines. Toggled against the neon city. */

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

/** Sunset sky: violet zenith, pink and orange toward a glowing horizon, soft lit clouds. */
export function sunsetSkyTexture(): THREE.CanvasTexture {
  return canvasTex(2048, 1024, (g) => {
    const r = rng(11);
    const gr = g.createLinearGradient(0, 0, 0, 1024);
    gr.addColorStop(0.0, '#161d4d');
    gr.addColorStop(0.18, '#2c3070');
    gr.addColorStop(0.34, '#5a4a92');
    gr.addColorStop(0.42, '#a8588f');
    gr.addColorStop(0.47, '#e37f6e');
    gr.addColorStop(0.495, '#ffae68');
    gr.addColorStop(0.505, '#ffd49a');
    gr.addColorStop(0.52, '#4a3a2c');
    gr.addColorStop(1.0, '#1b2012');
    g.fillStyle = gr; g.fillRect(0, 0, 2048, 1024);
    // sun glow near the horizon
    const sx = 1450, sy = 505;
    const sun = g.createRadialGradient(sx, sy, 0, sx, sy, 520);
    sun.addColorStop(0, 'rgba(255,236,190,0.95)'); sun.addColorStop(0.15, 'rgba(255,190,110,0.65)');
    sun.addColorStop(0.5, 'rgba(255,120,90,0.22)'); sun.addColorStop(1, 'rgba(255,100,90,0)');
    g.fillStyle = sun; g.fillRect(0, 0, 2048, 1024);
    // clouds: stretched soft blobs, lit pink/orange from below near the horizon
    for (let i = 0; i < 160; i++) {
      const x = r() * 2048, y = 90 + r() * 380;
      const w = 90 + r() * 260, h = 14 + r() * 40;
      const near = Math.min(1, Math.max(0, (y - 120) / 330));
      const rr = Math.round(150 + 105 * near), gg = Math.round(120 + 60 * near), bb = Math.round(190 - 70 * near);
      g.save();
      g.translate(x, y); g.scale(w / h, 1);
      const cg = g.createRadialGradient(0, 0, 0, 0, 0, h);
      cg.addColorStop(0, `rgba(${rr},${gg},${bb},${0.10 + r() * 0.2})`);
      cg.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
      g.fillStyle = cg; g.beginPath(); g.arc(0, 0, h, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  });
}

function grassTexture(): THREE.CanvasTexture {
  const t = canvasTex(512, 512, (g) => {
    const r = rng(5);
    g.fillStyle = '#3a4a22'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9000; i++) {
      const k = r();
      g.fillStyle = k < 0.5 ? 'rgba(20,34,12,0.35)' : 'rgba(120,130,60,0.28)';
      g.fillRect(r() * 512, r() * 512, 1 + r() * 2, 2 + r() * 5);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(60, 60);
  return t;
}

/** Height of the rolling hills at world (x, z); flat near the stadium. */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const ramp = Math.min(1, Math.max(0, (r - 11000) / 9000));
  const s = ramp * ramp * (3 - 2 * ramp);
  const bumps = 0.55 + 0.25 * Math.sin(x * 0.00031 + 1.3) * Math.cos(z * 0.00027) + 0.2 * Math.sin((x + z) * 0.00062);
  return -30 + s * 2300 * bumps;
}

function barn(): THREE.Group {
  const g = new THREE.Group();
  const walls = new THREE.Mesh(new THREE.BoxGeometry(2600, 1000, 1500), new THREE.MeshStandardMaterial({ color: 0x8a2a1c, roughness: 0.9 }));
  walls.position.y = 500;
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a2c28, roughness: 0.85, side: THREE.DoubleSide });
  const shape = new THREE.Shape([new THREE.Vector2(-1300, 0), new THREE.Vector2(1300, 0), new THREE.Vector2(1300, 120), new THREE.Vector2(0, 640), new THREE.Vector2(-1300, 120)]);
  const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1500, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0x8a2a1c, roughness: 0.9 }));
  gable.position.set(0, 1000, -750);
  const roofL = new THREE.Mesh(new THREE.PlaneGeometry(1500 * 1.05, 1460), roofMat);
  const roofR = roofL.clone();
  roofL.rotation.set(-Math.PI / 2 + 0.43, 0, Math.PI / 2); roofL.position.set(-700, 1370, 0);
  roofR.rotation.set(-Math.PI / 2 - 0.43, 0, Math.PI / 2); roofR.position.set(700, 1370, 0);
  const door = new THREE.Mesh(new THREE.BoxGeometry(600, 640, 20), new THREE.MeshStandardMaterial({ color: 0x4a1a12 }));
  door.position.set(0, 330, 760);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(640, 40, 24), new THREE.MeshStandardMaterial({ color: 0xe8dcc8 }));
  trim.position.set(0, 660, 762);
  g.add(walls, gable, roofL, roofR, door, trim);
  return g;
}

function windmill(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x7c8088, roughness: 0.6, metalness: 0.4 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(50, 150, 1800, 4), mat);
  tower.position.y = 900; tower.rotation.y = Math.PI / 4;
  const wheel = new THREE.Group();
  for (let i = 0; i < 12; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(70, 520, 8), mat);
    blade.position.y = 300; const pivot = new THREE.Group(); pivot.add(blade); pivot.rotation.z = (i / 12) * Math.PI * 2; wheel.add(pivot);
  }
  wheel.position.set(0, 1850, 140);
  g.add(tower, wheel);
  return g;
}

function autumnTree(): THREE.Group {
  const g = new THREE.Group();
  const r = rng(21);
  const bark = new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 1 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(110, 190, 1300, 8), bark);
  trunk.position.y = 650; g.add(trunk);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, len = 900 + r() * 500;
    const limb = new THREE.Mesh(new THREE.CylinderGeometry(30, 70, len, 6), bark);
    limb.position.set(Math.cos(a) * len * 0.3, 1450 + r() * 300, Math.sin(a) * len * 0.3);
    limb.rotation.z = Math.cos(a) * 0.9; limb.rotation.x = -Math.sin(a) * 0.9; g.add(limb);
  }
  const leafGeo = new THREE.IcosahedronGeometry(1, 1);
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), 90);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const palette = [0xc23c1c, 0xe0701f, 0xa8301a, 0xd9541d, 0xe8902a];
  for (let i = 0; i < 90; i++) {
    const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * 1300, y = 1700 + r() * 1100 - rad * 0.15;
    const s = 280 + r() * 330;
    m.compose(new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.8, s));
    leaves.setMatrixAt(i, m); leaves.setColorAt(i, c.setHex(palette[Math.floor(r() * palette.length)]));
  }
  g.add(leaves);
  return g;
}

/** Sky dome, hills and farm of the sunset stadium. */
export function buildSunsetScenery(low: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sunsetScenery';
  const r = rng(77);
  void r;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 20), new THREE.MeshBasicMaterial({ map: sunsetSkyTexture(), side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
  sky.renderOrder = -10;
  group.add(sky);

  // rolling hills / farmland
  const seg = low ? 60 : 110;
  const tg = new THREE.PlaneGeometry(60000, 60000, seg, seg);
  tg.rotateX(-Math.PI / 2);
  const pos = tg.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const lo = new THREE.Color(0x2a3a1c), hi = new THREE.Color(0x6d6a2c), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    tmp.copy(lo).lerp(hi, Math.min(1, Math.max(0, h / 1700)) * (0.7 + 0.3 * Math.sin(x * 0.0009) * Math.cos(z * 0.0011)));
    cols[i * 3] = tmp.r; cols[i * 3 + 1] = tmp.g; cols[i * 3 + 2] = tmp.b;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  tg.computeVertexNormals();
  const ground = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: grassTexture() }));
  group.add(ground);

  // farm: barn, windmill, silo, big autumn tree
  const b = barn(); b.position.set(-9200, terrainHeight(-9200, 14500), 14500); b.rotation.y = 0.4; group.add(b);
  const b2 = barn(); b2.scale.setScalar(0.7); b2.position.set(12000, terrainHeight(12000, 9500), 9500); b2.rotation.y = -0.9; group.add(b2);
  const wm = windmill(); wm.position.set(-14500, terrainHeight(-14500, 11500), 11500); wm.scale.setScalar(1.5); group.add(wm);
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(330, 330, 1700, 12), new THREE.MeshStandardMaterial({ color: 0xb9b2a4, roughness: 0.7 }));
  silo.position.set(-7300, terrainHeight(-7300, 15000) + 850, 15000); group.add(silo);
  const tree = autumnTree(); tree.position.set(-17500, terrainHeight(-17500, -5000), -5000); tree.scale.setScalar(1.35); group.add(tree);
  const tree2 = autumnTree(); tree2.position.set(16500, terrainHeight(16500, 6500), 6500); tree2.scale.setScalar(1.0); group.add(tree2);

  // power poles + sagging lines
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a3a30, roughness: 1 });
  const lineGeo: number[] = [];
  const poleTops: THREE.Vector3[] = [];
  for (let i = -5; i <= 5; i++) {
    const x = i * 3600, z = -12500 + i * 220, y0 = terrainHeight(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(34, 46, 1900, 6), poleMat); pole.position.set(x, y0 + 950, z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(520, 30, 30), poleMat); arm.position.set(x, y0 + 1800, z);
    group.add(pole, arm); poleTops.push(new THREE.Vector3(x, y0 + 1800, z));
  }
  for (let i = 0; i < poleTops.length - 1; i++) for (const o of [-240, 0, 240]) {
    const a = poleTops[i], bb = poleTops[i + 1];
    for (let s = 0; s < 12; s++) {
      const t0 = s / 12, t1 = (s + 1) / 12, sag = (t: number) => -4 * 150 * t * (1 - t);
      lineGeo.push(a.x + (bb.x - a.x) * t0 + o, a.y + (bb.y - a.y) * t0 + sag(t0), a.z + (bb.z - a.z) * t0);
      lineGeo.push(a.x + (bb.x - a.x) * t1 + o, a.y + (bb.y - a.y) * t1 + sag(t1), a.z + (bb.z - a.z) * t1);
    }
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lineGeo, 3));
  group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x1b1716 })));

  return group;
}
