import * as THREE from 'three';

const MAX = 2600;
const LIFE = 7; // seconds a mark stays visible

/**
 * Temporary tyre marks on the pitch: a pool of instanced flat quads drawn with a tiny shader that
 * fades each mark out over LIFE seconds. One draw call regardless of how many marks exist.
 */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private offset = new Float32Array(MAX * 3);
  private angle = new Float32Array(MAX);
  private born = new Float32Array(MAX).fill(-1e6);
  private strength = new Float32Array(MAX);
  private next = 0;
  private time = 0;
  private uniforms = { uTime: { value: 0 }, uLife: { value: LIFE } };
  private geo: THREE.InstancedBufferGeometry;

  constructor() {
    const base = new THREE.PlaneGeometry(1, 1);
    base.rotateX(-Math.PI / 2);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    this.geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(this.offset, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAngle', new THREE.InstancedBufferAttribute(this.angle, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aBorn', new THREE.InstancedBufferAttribute(this.born, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aStrength', new THREE.InstancedBufferAttribute(this.strength, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.instanceCount = MAX;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: this.uniforms,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      vertexShader: `
        attribute vec3 aOffset; attribute float aAngle; attribute float aBorn; attribute float aStrength;
        uniform float uTime; uniform float uLife;
        varying vec2 vUv; varying float vA;
        void main() {
          vUv = uv;
          float age = uTime - aBorn;
          vA = aStrength * clamp(1.0 - age / uLife, 0.0, 1.0) * smoothstep(0.0, 0.12, age);
          // quad: length 26 along the travel direction, width 8 across it
          vec3 p = position * vec3(28.0, 1.0, 8.0);
          float c = cos(aAngle), s = sin(aAngle);
          vec3 r = vec3(p.x * c + p.z * s, 0.0, -p.x * s + p.z * c);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(aOffset + r, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv; varying float vA;
        void main() {
          float edge = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
          // triangular window along the length: neighbours overlap by half and sum to a smooth, even mark
          float lenFade = 1.0 - abs(vUv.x * 2.0 - 1.0);
          gl_FragColor = vec4(0.02, 0.025, 0.02, vA * edge * lenFade * 0.6);
        }`,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Lays one mark segment. `angle` is the travel direction in the horizontal plane (about +Y). */
  add(x: number, z: number, angle: number, strength = 1): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.offset[i * 3] = x; this.offset[i * 3 + 1] = 0.9; this.offset[i * 3 + 2] = z;
    this.angle[i] = angle;
    this.born[i] = this.time;
    this.strength[i] = strength;
    (this.geo.attributes.aOffset as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAngle as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aBorn as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aStrength as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number): void {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
  }
}
