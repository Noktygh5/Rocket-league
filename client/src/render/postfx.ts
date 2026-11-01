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
      uVignette: { value: 0.42 },
      uSaturation: { value: 1.12 },
      uContrast: { value: 1.07 },
      uSpeed: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uTime, uVignette, uSaturation, uContrast, uSpeed;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
      void main() {
        vec2 d = vUv - 0.5;
        // speed lines pull the picture slightly outward when supersonic
        vec2 uv = vUv - d * (uSpeed * 0.012);
        vec3 c = texture2D(tDiffuse, uv).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSaturation);
        c = (c - 0.5) * uContrast + 0.5;
        // split tone: warm lights, cool shadows
        c += vec3(0.035, 0.012, -0.03) * smoothstep(0.35, 1.0, l);
        c += vec3(-0.012, 0.0, 0.03) * (1.0 - smoothstep(0.0, 0.35, l));
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
