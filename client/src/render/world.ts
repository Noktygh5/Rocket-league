import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BALL, PADS } from '@turboball/shared';
import { Quality } from '../settings';
import { ArenaView, buildArena } from './arenaMesh';
import { CarVisual, createCarVisual } from './carMesh';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { skyTexture } from './environment';
import { Particles } from './particles';
import { createGradePass, setGradeSpeed } from './postfx';
import { SkidMarks } from './skid';

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
  handbrake: boolean;
  /** Sideways speed over the ground (uu/s). */
  slip: number;
  onGround: boolean;
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

function ballTextures(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const W = 2048, H = 1024;
  const mk = (draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    draw(c.getContext('2d')!);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  };
  let seed = 12;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const weave = (g: CanvasRenderingContext2D): void => {
    g.fillStyle = '#16181c'; g.fillRect(0, 0, W, H);
    g.lineWidth = 2;
    for (let i = -H; i < W + H; i += 10) { g.strokeStyle = 'rgba(70,74,82,0.55)'; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + H, H); g.stroke(); g.strokeStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.moveTo(i + 5, 0); g.lineTo(i + 5 + H, H); g.stroke(); }
  };
  /** Armour plate shape: rounded slab with a bevelled light edge. */
  const plate = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rot: number, fill: string, edge: string): void => {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.beginPath(); g.moveTo(-w / 2, -h / 2 + 10); g.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + 12, -h / 2); g.lineTo(w / 2 - 22, -h / 2); g.lineTo(w / 2, h / 2 - 12); g.quadraticCurveTo(w / 2, h / 2, w / 2 - 12, h / 2); g.lineTo(-w / 2 + 22, h / 2); g.closePath();
    g.fillStyle = fill; g.fill(); g.lineWidth = 5; g.strokeStyle = edge; g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2; g.strokeRect(-w / 4, -h / 6, w / 2, h / 3);
    g.restore();
  };
  const hubs = [W * 0.25, W * 0.75];
  const map = mk((g) => {
    weave(g);
    // ridged bands toward the poles
    for (let i = 0; i < 26; i++) {
      for (const base of [0, H - 190]) { const y = base + i * 7.2; g.fillStyle = i & 1 ? '#2b2e35' : '#14161a'; g.fillRect(0, y, W, 4.5); g.fillStyle = 'rgba(160,165,175,0.25)'; g.fillRect(0, y, W, 1); }
    }
    for (const cx of hubs) {
      const cy = H / 2;
      // big circular plate with a rim
      g.beginPath(); g.ellipse(cx, cy, 330, 330, 0, 0, Math.PI * 2); g.fillStyle = '#1d2026'; g.fill();
      g.lineWidth = 16; g.strokeStyle = '#6d7078'; g.stroke(); g.lineWidth = 4; g.strokeStyle = '#b6b9c0'; g.beginPath(); g.ellipse(cx, cy, 340, 340, 0, 0, Math.PI * 2); g.stroke();
      // five armour plates around the hub
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
        plate(g, cx + Math.cos(a) * 205, cy + Math.sin(a) * 205, 170, 92, a, '#3b3e46', '#8b8f98');
      }
      // outer gold-edged crescents
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.6;
        g.beginPath(); g.arc(cx, cy, 285, a, a + 0.55); g.lineWidth = 34; g.strokeStyle = '#6a5f2a'; g.stroke();
        g.lineWidth = 6; g.strokeStyle = '#d5b552'; g.stroke();
      }
      g.beginPath(); g.ellipse(cx, cy, 98, 98, 0, 0, Math.PI * 2); g.fillStyle = '#2a2d34'; g.fill(); g.lineWidth = 10; g.strokeStyle = '#8c9098'; g.stroke();
    }
    // scuffs and scratches
    for (let i = 0; i < 1400; i++) { g.strokeStyle = `rgba(200,205,215,${rnd() * 0.12})`; g.lineWidth = 1; g.beginPath(); const x = rnd() * W, y = rnd() * H; g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 70, y + (rnd() - 0.5) * 12); g.stroke(); }
    // gold accent plates between the hubs
    for (const cx of [W * 0.5, 0, W]) plate(g, cx, H / 2 - 120, 220, 130, 0.2, '#6d5a22', '#e4c25a');
  });
  const emissive = mk((g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    for (const cx of hubs) {
      const cy = H / 2;
      g.strokeStyle = '#7fd8ff'; g.lineWidth = 14; g.shadowColor = '#4fc3ff'; g.shadowBlur = 24;
      for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.3; g.beginPath(); g.arc(cx, cy, 82, a, a + 1.0); g.stroke(); }
      g.shadowBlur = 0;
    }
  });
  const rough = mk((g) => { g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, W, H); for (let i = 0; i < 800; i++) { g.fillStyle = `rgba(${rnd() * 120},${rnd() * 120},${rnd() * 120},0.4)`; g.fillRect(rnd() * W, rnd() * H, 30 + rnd() * 80, 4); } });
  return { map, emissive, rough };
}

/** Glowing lens hub with five armour arms, attached to the ball at +/-X so it spins with it. */
function addBallHubs(ball: THREE.Mesh): void {
  const metal = new THREE.MeshStandardMaterial({ color: 0x4a4d55, metalness: 0.95, roughness: 0.35, envMapIntensity: 1.2 });
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xe6f7ff, toneMapped: false });
  const ringGlow = new THREE.MeshBasicMaterial({ color: 0x5fcfff, toneMapped: false });
  for (const side of [1, -1]) {
    const hub = new THREE.Group();
    const lens = new THREE.Mesh(new THREE.CircleGeometry(21, 36), lensMat); lens.position.z = 3.5;
    const lensRing = new THREE.Mesh(new THREE.TorusGeometry(26, 3.4, 8, 40), ringGlow); lensRing.position.z = 3;
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(33, 5, 8, 40), metal); bezel.position.z = 2;
    hub.add(lens, lensRing, bezel);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(34, 15, 7), metal);
      arm.position.set(Math.cos(a) * 52, Math.sin(a) * 52, 1.5); arm.rotation.z = a; hub.add(arm);
    }
    // seat the hub on the sphere surface, facing outward
    hub.position.x = side * 90.4;
    hub.rotation.y = side * Math.PI / 2;
    ball.add(hub);
  }
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
  private trail!: THREE.Line;
  private trailPos = new Float32Array(48 * 3);
  private trailCol = new Float32Array(48 * 3);
  private lastBall = new THREE.Vector3();
  private grade: ShaderPass | null = null;
  private wasBoosting: boolean[] = [];
  private skid = new SkidMarks();
  private lastSkid: Float32Array[] = [];
  private ring: THREE.Mesh;
  private tmpV = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x05070b);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene.fog = new THREE.FogExp2(0xd99a76, 0.000014);
    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 5, 60000);
    this.scene.add(this.particles.points);
    this.scene.add(this.skid.mesh);

    this.scene.add(new THREE.HemisphereLight(0xffb98f, 0x2b3a1e, 1.15));
    this.sun = new THREE.DirectionalLight(0xffc896, 3.1);
    this.sun.position.set(900, 1500, 500);
    this.sun.castShadow = true;
    this.sun.shadow.camera.left = -1400; this.sun.shadow.camera.right = 1400;
    this.sun.shadow.camera.top = 1400; this.sun.shadow.camera.bottom = -1400;
    this.sun.shadow.camera.near = 100; this.sun.shadow.camera.far = 4000;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    const ballTex = ballTextures();
    const ballMat = new THREE.MeshStandardMaterial({ map: ballTex.map, color: 0xffffff, roughnessMap: ballTex.rough, roughness: 1, metalness: 0.9, envMapIntensity: 1.35, emissive: 0xffffff, emissiveMap: ballTex.emissive, emissiveIntensity: 1.4 });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 48, 32), ballMat);
    this.ball.castShadow = true;
    addBallHubs(this.ball);
    this.scene.add(this.ball);
    const haloTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const gr = g.createRadialGradient(32, 32, 8, 32, 32, 32);
      gr.addColorStop(0, 'rgba(90,210,255,0.22)'); gr.addColorStop(1, 'rgba(90,210,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.ballHalo = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.ballHalo);

    {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
      this.trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
      this.trail.frustumCulled = false;
      this.scene.add(this.trail);
    }
    this.shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(9000, 11000), new THREE.ShadowMaterial({ opacity: 0.45 }));
    this.shadowFloor.rotation.x = -Math.PI / 2; this.shadowFloor.position.y = 1.5; this.shadowFloor.receiveShadow = true;
    this.scene.add(this.shadowFloor);

    const ringTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d')!;
      g.strokeStyle = '#ffffff'; g.shadowColor = '#ffffff'; g.shadowBlur = 5;
      for (const [r, w] of [[44, 3], [70, 3.5], [96, 3]] as [number, number][]) {
        g.lineWidth = w; g.beginPath(); g.arc(128, 128, r, 0.25, Math.PI * 2 - 0.25); g.stroke();
      }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshBasicMaterial({ map: ringTex, color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;
    this.scene.add(this.ring);
    {
      const pm = new THREE.PMREMGenerator(this.renderer);
      const envScene = new THREE.Scene();
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, toneMapped: false })));
      this.scene.environment = pm.fromScene(envScene, 0.02).texture;
      this.scene.environmentIntensity = 0.95;
      pm.dispose();
    }
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
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.castShadow = q !== 'low';
    this.sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    this.shadowFloor.visible = false; // the pitch itself receives shadows now
    this.particles.setScale(520 * dpr * (window.innerHeight / 720));
    this.composer?.dispose();
    this.composer = null; this.bloom = null; this.grade = null;
    if (q !== 'low') {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), q === 'high' ? 0.55 : 0.4, 0.6, 0.85);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      this.grade = createGradePass();
      this.composer.addPass(this.grade);
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

  /** Lays temporary tyre marks behind the rear wheels while the car drifts or powerslides on flat ground. */
  private tyreMarks(i: number, c: CarFrame, root: THREE.Group): void {
    const last = (this.lastSkid[i] ??= new Float32Array([1e9, 1e9, 1e9, 1e9]));
    const up = this.tmpV.set(0, 1, 0).applyQuaternion(root.quaternion).y;
    const speed = Math.abs(c.fwdSpeed);
    const drifting = c.onGround && up > 0.9 && c.z < 60 && ((c.handbrake && speed > 250) || c.slip > 240);
    if (!drifting) { last[0] = 1e9; last[2] = 1e9; return; }
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(root.quaternion);
    // marks follow the direction the tyres are actually travelling (velocity), not where the car points
    const vx = c.fwdSpeed * fwd.x, vz = c.fwdSpeed * fwd.z;
    const ang = Math.atan2(-vz, vx);
    for (let w = 0; w < 2; w++) {
      const p = new THREE.Vector3(-47.6, -37.77, w ? -40 : 40).applyQuaternion(root.quaternion).add(root.position);
      const k = w * 2;
      if (Math.hypot(p.x - last[k], p.z - last[k + 1]) > 14) {
        this.skid.add(p.x, p.z, ang, Math.min(1, 0.55 + c.slip / 900));
        last[k] = p.x; last[k + 1] = p.z;
        if (Math.random() < 0.35) this.particles.spawn(p.x, 6, p.z, (Math.random() - 0.5) * 60, 40 + Math.random() * 40, (Math.random() - 0.5) * 60, 0.35, 0.35, 0.33, 0.7, 34, 1.8);
      }
    }
  }

  render(f: Frame, dt: number): void {
    this.clock += dt;
    // ball
    this.ball.position.set(f.ball.x, f.ball.z, -f.ball.y);
    setQuat(this.ball, f.ball.q);
    this.ballHalo.position.copy(this.ball.position);
    {
      // thin blue streak behind a fast ball
      const sp = this.ball.position.distanceTo(this.lastBall) / Math.max(dt, 1e-3);
      this.lastBall.copy(this.ball.position);
      const tp = this.trailPos, tc = this.trailCol, N = tp.length / 3;
      for (let i = N - 1; i > 0; i--) { tp[i * 3] = tp[(i - 1) * 3]; tp[i * 3 + 1] = tp[(i - 1) * 3 + 1]; tp[i * 3 + 2] = tp[(i - 1) * 3 + 2]; }
      tp[0] = this.ball.position.x; tp[1] = this.ball.position.y; tp[2] = this.ball.position.z;
      const k = Math.min(1, Math.max(0, (sp - 900) / 2200));
      for (let i = 0; i < N; i++) { const f = (1 - i / N) * k; tc[i * 3] = 0.25 * f; tc[i * 3 + 1] = 0.7 * f; tc[i * 3 + 2] = 1.0 * f; }
      (this.trail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.trail.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }
    this.ballHalo.quaternion.copy(this.camera.quaternion);

    // cars
    for (let i = 0; i < this.carRoots.length && i < f.cars.length; i++) {
      const c = f.cars[i], root = this.carRoots[i], view = this.carViews[i];
      root.visible = !c.demolished;
      if (c.demolished) continue;
      root.position.set(c.x, c.z, -c.y);
      setQuat(root, c.q);
      view.update(dt, c.boosting, c.supersonic, c.boost, c.fwdSpeed, c.steer);
      this.tyreMarks(i, c, root);
      if (c.boosting && !this.wasBoosting[i]) {
        // ignition: a few big yellow-orange fireballs, like the reference footage
        const o = new THREE.Vector3(-70, -8, 0).applyQuaternion(root.quaternion).add(root.position);
        const b0 = new THREE.Vector3(-1, 0, 0).applyQuaternion(root.quaternion);
        for (let k = 0; k < 6; k++) this.particles.spawn(o.x, o.y, o.z, b0.x * 260 + (Math.random() - 0.5) * 240, b0.y * 260 + (Math.random() - 0.5) * 240 + 40, b0.z * 260 + (Math.random() - 0.5) * 240, 0.85, 0.5, 0.12, 0.45, 55, 2.4);
      }
      this.wasBoosting[i] = c.boosting;
      if (c.boosting) {
        // sparks from the nozzle in world space
        this.tmpV.set(-64, -12, 0).applyQuaternion(root.quaternion).add(root.position);
        const back = new THREE.Vector3(-1, 0, 0).applyQuaternion(root.quaternion);
        for (let k = 0; k < 2; k++) {
          this.particles.spawn(this.tmpV.x, this.tmpV.y, this.tmpV.z,
            back.x * 500 + (Math.random() - 0.5) * 160, back.y * 500 + (Math.random() - 0.5) * 160, back.z * 500 + (Math.random() - 0.5) * 160,
            1, 0.55 + Math.random() * 0.3, 0.15, 0.4, 26, 3);
        }
        if (Math.random() < 0.5) {
          this.particles.spawn(this.tmpV.x, this.tmpV.y, this.tmpV.z, back.x * 140 + (Math.random() - 0.5) * 60, back.y * 140 + 25, back.z * 140 + (Math.random() - 0.5) * 60, 0.8, 0.45, 0.1, 0.4, 36, 2.5);
        }
      }
    }
    // shadow light follows the focus car
    const fc = f.cars[f.focus] ?? f.cars[0];
    // the ring decal stays on the ground under the car, fading and shrinking with height, like the reference
    this.ring.visible = !!fc && !fc.demolished;
    if (fc) {
      const h = Math.max(0, fc.z - 38);
      this.ring.position.set(fc.x, 3.5, -fc.y);
      const sc = 1 + Math.min(1.2, h / 900);
      this.ring.scale.set(sc, sc, 1);
      const mat = this.ring.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0.15, 0.85 - h / 1400);
      mat.color.set(fc.team === 0 ? 0xbfd8ff : 0xffd2a8);
    }
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

    this.skid.update(dt);
    // the ball's glow must never flood the screen when the camera is close to it
    const hd = Math.hypot(f.ball.x - c.px, f.ball.y - c.py, f.ball.z - c.pz);
    this.ballHalo.visible = hd > 650;
    (this.ballHalo.material as THREE.MeshBasicMaterial).opacity = Math.min(1, (hd - 650) / 1400);
    if (this.grade) setGradeSpeed(this.grade, fc?.supersonic ? 1 : 0, this.clock);
    this.particles.update(dt);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Draw-call count for the performance budget. */
  get drawCalls(): number { return this.renderer.info.render.calls; }
}

export { PADS };
