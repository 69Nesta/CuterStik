// Painted gradient sky: deep blue zenith fading to a warm, hazy horizon,
// with a soft glow around the sun and a few streaky clouds.
import { useMemo } from 'react'
import * as THREE from 'three'
import { LIGHTING } from './materials'

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w; // always at the far plane
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += noise(p) * a; p *= 2.03; a *= 0.5; }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -0.2, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
    // Below the horizon: fade to a dusty ground haze.
    col = mix(col, uHorizon * 0.9, smoothstep(0.0, -0.2, d.y));

    float sun = max(dot(d, uSunDir), 0.0);
    col += uSun * (pow(sun, 8.0) * 0.25 + pow(sun, 64.0) * 0.6);

    // Streaky high clouds, stretched horizontally, only above the horizon.
    if (d.y > 0.02) {
      vec2 uv = d.xz / (d.y + 0.25) * vec2(1.2, 3.0);
      float c = smoothstep(0.52, 0.8, fbm(uv * 1.3));
      col = mix(col, vec3(1.0, 0.98, 0.95), c * 0.55 * smoothstep(0.02, 0.25, d.y));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function Sky({ sunDirection }: { sunDirection: [number, number, number] }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uZenith: { value: new THREE.Color(LIGHTING.zenith) },
          uHorizon: { value: new THREE.Color(LIGHTING.horizon) },
          uSun: { value: new THREE.Color(LIGHTING.sun) },
          uSunDir: { value: new THREE.Vector3(...sunDirection).normalize() },
        },
      }),
    [sunDirection],
  )
  return (
    <mesh material={material} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[200, 32, 16]} />
    </mesh>
  )
}
