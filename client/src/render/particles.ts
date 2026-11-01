import * as THREE from 'three';

const MAX = 2400;

/** One additive point-sprite system for sparks, explosions and shockwave dust. Positions are in three.js space. */
export class Particles {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private size = new Float32Array(MAX);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private baseSize = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private next = 0;
  private geo = new THREE.BufferGeometry();

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: { scale: { value: 600 } },
      vertexShader: `
        attribute float size; varying vec3 vCol; uniform float scale;
        void main() {
          vCol = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vCol;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = clamp(1.0 - d, 0.0, 1.0);
          gl_FragColor = vec4(vCol * a * a, 1.0);
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.geo.setDrawRange(0, MAX);
  }

  setScale(s: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = s;
  }

  spawn(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    r: number, g: number, b: number, life: number, size: number, drag = 1.5, grav = 0,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.col[k] = r; this.col[k + 1] = g; this.col[k + 2] = b;
    this.life[i] = life; this.maxLife[i] = life; this.baseSize[i] = size;
    this.drag[i] = drag; this.grav[i] = grav;
    this.size[i] = size;
  }

  /** Burst of `n` particles in a sphere. */
  burst(x: number, y: number, z: number, n: number, speed: number, color: THREE.Color, life = 1, size = 40): void {
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const sp = speed * (0.35 + Math.random() * 0.65);
      this.spawn(x, y, z, Math.cos(a) * s * sp, u * sp, Math.sin(a) * s * sp,
        color.r, color.g, color.b, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), 1.8, -250);
    }
  }

  /** Expanding ring in the horizontal plane. */
  ring(x: number, y: number, z: number, n: number, speed: number, color: THREE.Color, life = 0.8, size = 50): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawn(x, y, z, Math.cos(a) * speed, 0, Math.sin(a) * speed, color.r, color.g, color.b, life, size, 2.2, 0);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= d; this.vel[k + 1] = this.vel[k + 1] * d + this.grav[i] * dt; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * t);
      const f = t;
      // fade by scaling colour (additive blending)
      if (this.life[i] <= 0) this.size[i] = 0;
      else {
        this.col[k] *= 1 - (1 - f) * dt * 2; this.col[k + 1] *= 1 - (1 - f) * dt * 2; this.col[k + 2] *= 1 - (1 - f) * dt * 2;
      }
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }
}
