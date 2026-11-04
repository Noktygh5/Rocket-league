import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Final colour grade, applied after tone mapping: gentle vignette, warm highlights / cool shadows,
 * a touch of contrast and saturation, and a little film grain, like the reference footage.
 */
export function createGradePass(): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uVignette: { value: 0.5 },
      uSaturation: { value: 1.25 },
      uContrast: { value: 1.07 },
      uSpeed: { value: 0 },
      uCA: { value: 1 },
      uTone: { value: 1 },
    },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uTime, uVignette, uSaturation, uContrast, uSpeed, uCA, uTone;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
      void main() {
        vec2 d = vUv - 0.5;
        // speed lines pull the picture slightly outward when supersonic
        vec2 uv = vUv - d * (uSpeed * 0.012);
        // chromatic aberration, stronger toward the corners
        vec2 ca = d * (0.0008 + length(d) * 0.0022) * uCA;
        vec3 c = vec3(texture2D(tDiffuse, uv + ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - ca).b);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSaturation);
        c = (c - 0.5) * uContrast + 0.5;
        // split tone: warm lights, cool shadows
        c += uTone * vec3(0.05, 0.0, 0.03) * smoothstep(0.4, 1.0, l);
        c += uTone * vec3(-0.03, 0.012, 0.05) * (1.0 - smoothstep(0.0, 0.4, l));
        float v = smoothstep(0.85, 0.2, length(d) * (1.0 + uSpeed * 0.25));
        c *= mix(1.0 - uVignette, 1.0, v);
        c += (hash(vUv * 1000.0) - 0.5) * 0.018;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

export function setGradeSpeed(pass: ShaderPass, speed01: number, time: number): void {
  const u = pass.uniforms as Record<string, THREE.IUniform<number>>;
  u.uSpeed.value += (speed01 - u.uSpeed.value) * 0.1;
  u.uTime.value = time % 10;
}

/** Colour grade for the neon city (strong, teal/magenta) or the sunset stadium (gentle). */
export function setGradeLook(pass: ShaderPass, neon: boolean): void {
  const u = pass.uniforms as Record<string, THREE.IUniform<number>>;
  u.uCA.value = neon ? 1 : 0; u.uTone.value = neon ? 1 : 0.4;
  u.uSaturation.value = neon ? 1.25 : 1.12; u.uVignette.value = neon ? 0.5 : 0.42;
}
