import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BALL, PADS } from '@turboball/shared';
import { Quality } from '../settings';
import { ArenaView, buildArena } from './arenaMesh';
import { CarVisual, createCarVisual } from './carMesh';
import { Particles } from './particles';

export interface QuatLike { x: number; y: number; z: number; w: number }
export interface CarFrame {
  x: number; y: number; z: number;
  q: QuatLike;
  team: 0 | 1;
  boosting: boolean;
  supersonic: boolean;
  boost: number;
  fwdSpeed: number;
  steer: number;
  demolished: boolean;
}
export interface Frame {
  ball: { x: number; y: number; z: number; q: QuatLike };
  cars: CarFrame[];
  padActive: boolean[];
  padTimer01: number[];
  cam: { px: number; py: number; pz: number; tx: number; ty: number; tz: number; ux: number; uy: number; uz: number; fov: number };
  /** Index of the car the camera follows (for the shadow light). */
  focus: number;
}

const BLUE = new THREE.Color(0x3d8bff), ORANGE = new THREE.Color(0xff9a3d);

function ballTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9eef7'; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#6f86a8'; g.lineWidth = 3;
  const r = 28;
  for (let row = -1; row < 10; row++) for (let col = -1; col < 20; col++) {
    const cx = col * r * 1.75 + (row & 1 ? r * 0.87 : 0), cy = row * r * 1.5;
    g.beginPath();
    for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    g.closePath(); g.stroke();
  }
  g.fillStyle = 'rgba(90,150,255,0.25)';
  for (let i = 0; i < 18; i++) g.fillRect(i * 32, 0, 14, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Converts a sim-space (Z up) quaternion to three.js space (Y up). */
function setQuat(o: THREE.Object3D, q: QuatLike): void {
  o.quaternion.set(q.x, q.z, -q.y, q.w);
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly particles = new Particles();
  private arena!: ArenaView;
  private ball: THREE.Mesh;
  private ballHalo: THREE.Mesh;
  private carViews: CarVisual[] = [];
  private carRoots: THREE.Group[] = [];
  private sun: THREE.DirectionalLight;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private quality: Quality;
  private padState: number[] = [];
  private shadowFloor: THREE.Mesh;
  private clock = 0;
  private tmpV = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x05070b);
    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 5, 60000);
    this.scene.add(this.particles.points);

    this.scene.add(new THREE.HemisphereLight(0xbcd2ff, 0x1a2030, 1.6));
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.position.set(400, 1800, 300);
    this.sun.castShadow = true;
    this.sun.shadow.camera.left = -1400; this.sun.shadow.camera.right = 1400;
    this.sun.shadow.camera.top = 1400; this.sun.shadow.camera.bottom = -1400;
    this.sun.shadow.camera.near = 100; this.sun.shadow.camera.far = 4000;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    const ballMat = new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.35, metalness: 0.1, emissive: 0x335577, emissiveIntensity: 0.55 });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 28, 20), ballMat);
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    const haloTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const gr = g.createRadialGradient(32, 32, 8, 32, 32, 32);
      gr.addColorStop(0, 'rgba(160,200,255,0.5)'); gr.addColorStop(1, 'rgba(160,200,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.ballHalo = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.ballHalo);

    this.shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(9000, 11000), new THREE.ShadowMaterial({ opacity: 0.45 }));
    this.shadowFloor.rotation.x = -Math.PI / 2; this.shadowFloor.position.y = 1.5; this.shadowFloor.receiveShadow = true;
    this.scene.add(this.shadowFloor);

    this.buildArena();
    this.applyQuality(quality);
    this.resize();
  }

  private buildArena(): void {
    this.arena = buildArena(this.quality === 'low');
    this.scene.add(this.arena.group);
    this.padState = new Array(34).fill(-1);
  }

  /** Creates visuals for the current set of cars. */
  setCars(teams: (0 | 1)[]): void {
    for (const r of this.carRoots) this.scene.remove(r);
    this.carViews.forEach((v) => v.dispose());
    this.carViews = []; this.carRoots = [];
    for (const t of teams) {
      const v = createCarVisual(t, this.quality);
      const root = new THREE.Group();
      root.add(v.root);
      v.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = this.quality !== 'low' && (o as THREE.Mesh).castShadow; });
      this.scene.add(root);
      this.carViews.push(v); this.carRoots.push(root);
    }
  }

  applyQuality(q: Quality): void {
    this.quality = q;
    const dpr = Math.min(window.devicePixelRatio || 1, q === 'low' ? 1 : 1.5);
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = q !== 'low';
    this.sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    this.shadowFloor.visible = q !== 'low';
    this.particles.setScale(520 * dpr * (window.innerHeight / 720));
    this.composer?.dispose();
    this.composer = null; this.bloom = null;
    if (q !== 'low') {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), q === 'high' ? 0.55 : 0.4, 0.6, 0.85);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  get aspect(): number { return this.camera.aspect; }

  ballImpact(x: number, y: number, z: number, speed: number): void {
    const n = Math.min(24, 4 + Math.floor(speed / 150));
    this.particles.burst(x, z, -y, n, 300 + speed * 0.3, new THREE.Color(0xbfe0ff), 0.45, 28);
  }
  goalExplosion(team: number, x: number, y: number, z: number): void {
    const c = team === 0 ? BLUE : ORANGE;
    this.particles.burst(x, z, -y, 260, 2400, c, 1.6, 90);
    this.particles.burst(x, z, -y, 120, 1400, new THREE.Color(0xffffff), 1.0, 60);
    this.particles.ring(x, z, -y, 90, 2600, c, 1.1, 80);
  }
  demoExplosion(team: number, x: number, y: number, z: number): void {
    const c = team === 0 ? BLUE : ORANGE;
    this.particles.burst(x, z, -y, 140, 1500, c, 1.1, 60);
    this.particles.burst(x, z, -y, 70, 900, new THREE.Color(0xffd9a0), 0.9, 45);
  }

  render(f: Frame, dt: number): void {
    this.clock += dt;
    // ball
    this.ball.position.set(f.ball.x, f.ball.z, -f.ball.y);
    setQuat(this.ball, f.ball.q);
    this.ballHalo.position.copy(this.ball.position);
    this.ballHalo.quaternion.copy(this.camera.quaternion);

    // cars
    for (let i = 0; i < this.carRoots.length && i < f.cars.length; i++) {
      const c = f.cars[i], root = this.carRoots[i], view = this.carViews[i];
      root.visible = !c.demolished;
      if (c.demolished) continue;
      root.position.set(c.x, c.z, -c.y);
      setQuat(root, c.q);
      view.update(dt, c.boosting, c.supersonic, c.boost, c.fwdSpeed, c.steer);
      if (c.boosting) {
        // sparks from the nozzle in world space
        this.tmpV.set(-64, -12, 0).applyQuaternion(root.quaternion).add(root.position);
        const back = new THREE.Vector3(-1, 0, 0).applyQuaternion(root.quaternion);
        for (let k = 0; k < 2; k++) {
          this.particles.spawn(this.tmpV.x, this.tmpV.y, this.tmpV.z,
            back.x * 500 + (Math.random() - 0.5) * 160, back.y * 500 + (Math.random() - 0.5) * 160, back.z * 500 + (Math.random() - 0.5) * 160,
            1, 0.55 + Math.random() * 0.3, 0.15, 0.35, 16, 3);
        }
      }
    }
    // shadow light follows the focus car
    const fc = f.cars[f.focus] ?? f.cars[0];
    if (fc) {
      this.sun.target.position.set(fc.x, 0, -fc.y);
      this.sun.position.set(fc.x + 400, 1800, -fc.y + 300);
    }

    // pads
    for (let k = 0; k < f.padActive.length && k < this.padState.length; k++) {
      const code = f.padActive[k] ? 1000 : Math.floor(f.padTimer01[k] * 20);
      if (code !== this.padState[k]) { this.padState[k] = code; this.arena.setPadActive(k, f.padActive[k], f.padTimer01[k]); }
    }

    // camera (sim -> three)
    const c = f.cam;
    this.camera.position.set(c.px, c.pz, -c.py);
    this.camera.up.set(c.ux, c.uz, -c.uy);
    this.camera.lookAt(c.tx, c.tz, -c.ty);
    if (Math.abs(this.camera.fov - c.fov) > 0.01) { this.camera.fov = c.fov; this.camera.updateProjectionMatrix(); }

    this.particles.update(dt);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Draw-call count for the performance budget. */
  get drawCalls(): number { return this.renderer.info.render.calls; }
}

export { PADS };
