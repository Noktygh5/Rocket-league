import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Car model is built in three.js axes centred on the hitbox: +x forward, +y up, +z right.
// Hitbox: 118 x 36 x 84. Wheels touch the ground 37.77 below centre.

function extrudeProfile(pts: [number, number][], width: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  g.translate(0, 0, -width / 2);
  return g;
}

function tint(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

export interface CarVisual {
  root: THREE.Group;
  /** Per-frame update. `speed` in uu/s, `forwardSpeed` signed. */
  update(dt: number, boosting: boolean, supersonic: boolean, boostLevel: number, forwardSpeed: number, steer: number): void;
  setTeam(team: 0 | 1): void;
  dispose(): void;
}

const BODY_BLUE = new THREE.Color(0x1e6dff), BODY_ORANGE = new THREE.Color(0xff7a14);

export function createCarVisual(team: 0 | 1, quality: 'low' | 'medium' | 'high'): CarVisual {
  const root = new THREE.Group();
  const body = team === 0 ? BODY_BLUE : BODY_ORANGE;
  const dark = new THREE.Color(0x10141c);
  const accent = body.clone().multiplyScalar(0.45);

  // lower body (side silhouette, extruded across the width)
  const lower = tint(extrudeProfile([
    [-61, -20], [-62, -6], [-58, 5], [-40, 6], [-8, 7], [22, 4], [58, -2], [63, -9], [62, -20],
  ], 84), body);
  // cabin: dark glass, narrower
  const cabin = tint(extrudeProfile([
    [-52, 5], [-30, 18], [-4, 18], [16, 5],
  ], 66), dark);
  // roof panel
  const roof = tint(extrudeProfile([[-32, 18], [-6, 18], [-8, 20.5], [-30, 20.5]], 62), body);
  // hood stripe + spoiler + skirts
  const stripe = tint(new THREE.BoxGeometry(70, 1.2, 12).translate(22, 7.2, 0), accent);
  const spoiler = tint(new THREE.BoxGeometry(14, 3, 78).translate(-60, 14, 0), dark);
  const spoilerL = tint(new THREE.BoxGeometry(6, 12, 3).translate(-58, 8, 28), dark);
  const spoilerR = tint(new THREE.BoxGeometry(6, 12, 3).translate(-58, 8, -28), dark);
  const skirt = tint(new THREE.BoxGeometry(80, 6, 88).translate(-4, -19, 0), accent);
  const lamp = tint(new THREE.BoxGeometry(2, 4, 60).translate(63, -4, 0), new THREE.Color(0xfff2c9));
  const merged = mergeGeometries([lower, cabin, roof, stripe, spoiler, spoilerL, spoilerR, skirt, lamp].map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
  merged.computeVertexNormals();
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25, flatShading: true });
  const bodyMesh = new THREE.Mesh(merged, bodyMat);
  bodyMesh.castShadow = quality !== 'low';
  root.add(bodyMesh);

  // wheels: front radius 12.5, rear 15; centres on the ground contact line
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.9, flatShading: true });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x9aa7bd, roughness: 0.4, metalness: 0.8 });
  const wheels: { steer: THREE.Group; spin: THREE.Group; r: number; front: boolean }[] = [];
  const spec = [
    { x: 37.4, r: 12.5, z: 40 }, { x: 37.4, r: 12.5, z: -40 },
    { x: -47.6, r: 15, z: 40 }, { x: -47.6, r: 15, z: -40 },
  ];
  const seg = quality === 'low' ? 10 : 16;
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0xd7e0f0, roughness: 0.35, metalness: 0.85, flatShading: true });
  for (const s of spec) {
    const steer = new THREE.Group();
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r, 17, seg), wheelMat);
    tire.rotation.x = Math.PI / 2; // axle along +z (the car's right)
    spin.add(tire);
    // five spokes make the rotation readable
    for (let k = 0; k < 5; k++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(s.r * 1.25, 2.2, 3.2), spokeMat);
      spoke.rotation.z = (k * Math.PI * 2) / 5;
      spoke.position.z = (s.z > 0 ? 1 : -1) * 8.8;
      spin.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.28, s.r * 0.28, 19, 8), spokeMat);
    hub.rotation.x = Math.PI / 2;
    spin.add(hub);
    steer.add(spin);
    steer.position.set(s.x, -37.77 + s.r, s.z);
    root.add(steer);
    wheels.push({ steer, spin, r: s.r, front: s.x > 0 });
  }

  // underglow
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(140, 110),
    new THREE.MeshBasicMaterial({ map: glowTex, color: body, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.set(0, -35, 0);
  root.add(glow);

  // exhaust nozzles
  const nozzleMat = new THREE.MeshBasicMaterial({ color: 0xffb36b });
  for (const z of [-18, 18]) {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 8, 8), nozzleMat);
    n.rotation.z = Math.PI / 2; n.position.set(-64, -12, z);
    root.add(n);
  }

  // boost flame: layered cones pointing backwards (-x)
  const flame = new THREE.Group();
  const coneOuter = new THREE.Mesh(new THREE.ConeGeometry(15, 150, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const coneInner = new THREE.Mesh(new THREE.ConeGeometry(8, 100, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff4c0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  for (const c of [coneOuter, coneInner]) { c.rotation.z = Math.PI / 2; c.position.x = -50 - (c === coneOuter ? 75 : 50); flame.add(c); }
  flame.position.set(-64, -12, 0);
  flame.visible = false;
  root.add(flame);

  // supersonic streaks trailing behind
  const streakGeo = new THREE.BufferGeometry();
  const N = 14;
  const sp = new Float32Array(N * 6);
  for (let i = 0; i < N; i++) {
    const y = (Math.random() - 0.3) * 50, z = (Math.random() - 0.5) * 110;
    sp[i * 6] = -60; sp[i * 6 + 1] = y; sp[i * 6 + 2] = z;
    sp[i * 6 + 3] = -60 - 120 - Math.random() * 160; sp[i * 6 + 4] = y; sp[i * 6 + 5] = z;
  }
  streakGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const streaks = new THREE.LineSegments(streakGeo, new THREE.LineBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  streaks.visible = false;
  root.add(streaks);

  // two bright ribbons behind the rear wheels at supersonic
  const ribbonTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 8;
    const g = c.getContext('2d')!;
    const gr = g.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.35, 'rgba(210,235,255,0.55)'); gr.addColorStop(1, 'rgba(160,210,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 8);
    return new THREE.CanvasTexture(c);
  })();
  const ribbons = new THREE.Group();
  for (const z of [-34, 34]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(900, 9),
      new THREE.MeshBasicMaterial({ map: ribbonTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI; // flat, extending backwards (-x)
    m.position.set(-60 - 450, -33, z);
    ribbons.add(m);
  }
  ribbons.visible = false;
  root.add(ribbons);

  let t = 0;
  return {
    root,
    update(dt, boosting, supersonic, boostLevel, forwardSpeed, steer) {
      t += dt;
      // rolling without slip about the axle (+z): angle changes by -v*dt/r when moving forward (+x)
      for (const w of wheels) {
        w.spin.rotation.z -= (forwardSpeed * dt) / w.r;
        if (w.front) w.steer.rotation.y = -steer * 0.38;
      }
      flame.visible = boosting;
      if (boosting) {
        const f = 0.85 + Math.sin(t * 90) * 0.12 + Math.random() * 0.12;
        const k = (0.7 + 0.3 * Math.min(1, boostLevel / 100)) * f;
        flame.scale.set(k * 1.1, k, k);
      }
      streaks.visible = supersonic;
      ribbons.visible = supersonic;
      glow.material.opacity = boosting ? 0.9 : 0.5;
    },
    setTeam(tm) {
      glow.material.color.copy(tm === 0 ? BODY_BLUE : BODY_ORANGE);
    },
    dispose() {
      merged.dispose(); bodyMat.dispose();
    },
  };
}
