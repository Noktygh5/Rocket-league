import * as THREE from 'three';

function flameTexture(): THREE.CanvasTexture {
  const w = 128, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  // tongue of fire pointing "up" the texture (x = 0.5): white-yellow core, orange body, red edge
  const img = g.createImageData(w, h);
  let seed = 7;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const noise = new Float32Array(w * h).map(() => rnd());
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1); // 0 = base, 1 = tip (texture rows are flipped below)
    for (let x = 0; x < w; x++) {
      const dx = (x / (w - 1) - 0.5) * 2;
      const widthAt = 0.9 * (1 - t) ** 0.7 + 0.08;
      const edge = Math.abs(dx) / widthAt;
      const n = noise[y * w + x];
      const body = Math.max(0, 1 - edge * edge) * Math.max(0, 1 - t * 1.05) * (0.75 + 0.5 * n);
      const core = Math.max(0, 1 - edge * 1.6) * Math.max(0, 1 - t * 1.8);
      const i = ((h - 1 - y) * w + x) * 4;
      const a = Math.min(1, body * 1.25);
      img.data[i] = Math.min(255, 255 * (0.9 + core * 0.1));
      img.data[i + 1] = Math.min(255, 70 + 180 * Math.min(1, body * 0.9 + core));
      img.data[i + 2] = Math.min(255, 10 + 190 * core * core);
      img.data[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let shared: THREE.CanvasTexture | null = null;

/** A tall flickering exhaust flame built from three crossed, additive, noise-animated billboards. */
export class Flame {
  readonly group = new THREE.Group();
  private planes: THREE.Mesh[] = [];
  private t = Math.random() * 10;

  constructor() {
    shared ??= flameTexture();
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(46, 190),
        new THREE.MeshBasicMaterial({ map: shared, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      );
      m.position.x = -95; // centre of the flame behind the nozzle
      m.rotation.set((i * Math.PI) / 3, 0, Math.PI / 2); // long axis along -x
      m.rotation.order = 'XZY';
      this.planes.push(m);
      this.group.add(m);
    }
    this.group.visible = false;
  }

  /** `level` 0..1 scales length/brightness with the boost left. */
  update(dt: number, on: boolean, level: number): void {
    this.group.visible = on;
    if (!on) return;
    this.t += dt * 38;
    const f = 0.85 + 0.15 * Math.sin(this.t) + 0.1 * Math.sin(this.t * 2.7);
    const len = (0.85 + 0.5 * level) * f;
    this.planes.forEach((p, i) => {
      p.scale.set(len, 0.9 + 0.2 * Math.sin(this.t * 1.3 + i), 1);
      (p.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.25 * Math.sin(this.t * 3.1 + i * 2);
    });
  }
}
