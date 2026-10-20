// Footer background: violet folds on deep plum (after dipseastories.com's hero), drawn in a
// shader as slowly drifting, domain-warped noise, plus the hero's pointer fluid, which warps it
// with the same rainbow-edged smear. The pointer pushes velocity into a small grid sim; the
// display pass samples the folds along that velocity.
import * as THREE from 'three';
import { QUAD_VERT, SPLAT_FRAG, DIVERGENCE_FRAG, PRESSURE_FRAG, GRADIENT_FRAG, ADVECT_FRAG, SCALE_FRAG } from './hero.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// colours are linear: plum #2c0420, magenta #5a0e4a, violet #4b3af2, highlight #7a6bff
const FIELD_FRAG = /* glsl */`
uniform float uTime; uniform float uAspect;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float c = cos(-0.42), s = sin(-0.42);
  p = mat2(c, -s, s, c) * p;
  p *= vec2(0.8, 2.0);                       // long diagonal folds
  float t = uTime * 0.018;                   // very slow
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 2.6 * q + vec2(1.7, 9.2) + 0.7 * t), fbm(p + 2.6 * q + vec2(8.3, 2.8) - 0.6 * t));
  float v = fbm(p + 2.4 * r);
  vec3 col = vec3(0.0252, 0.0012, 0.0144);
  col = mix(col, vec3(0.102, 0.0044, 0.069), smoothstep(0.55, 0.95, length(q)) * 0.55);
  col = mix(col, vec3(0.0703, 0.0423, 0.888) * 0.6, smoothstep(0.4, 0.66, v));
  col = mix(col, vec3(0.195, 0.147, 1.0) * 0.78, smoothstep(0.6, 0.84, v) * 0.7);
  gl_FragColor = vec4(col, 1.0);
}`;

// warps the folds along the velocity field; fast flow gets a rainbow edge (as in the hero)
const DISPLAY_FRAG = /* glsl */`
uniform sampler2D uField; uniform sampler2D uVel; uniform vec2 uSimSize; uniform float uStrength;
varying vec2 vUv;
void main() {
  vec2 disp = texture2D(uVel, vUv).xy / uSimSize * uStrength;
  float m = length(disp);
  vec3 col = vec3(0.0); vec3 wsum = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float t = float(i) / 4.0;
    vec3 w = max(vec3(0.0), cos((t - vec3(0.0, 0.5, 1.0)) * 3.14159 * 0.5));
    col += texture2D(uField, clamp(vUv - disp * (0.35 + 0.65 * t), 0.0, 1.0)).rgb * w;
    wsum += w;
  }
  col /= max(wsum, vec3(1e-4));
  col += mix(vec3(0.35, 0.2, 1.0), vec3(1.0, 0.25, 0.6), sin(m * 14.0) * 0.5 + 0.5) * smoothstep(0.02, 0.09, m) * 0.08;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function startFooterFluid({ host, events }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'contact__gl';
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' });
  } catch { return null; }   // no WebGL: the CSS gradient stays
  host.prepend(canvas);
  host.classList.add('has-gl');
  // the folds are soft, so a reduced buffer is plenty and keeps this cheap
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * 0.45);
  renderer.autoClear = false;

  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  quadScene.add(quad);
  const shader = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  const pass = (material, target) => { quad.material = material; renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); };
  const rt = (w, h, opts = {}) => new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, ...opts });

  const fieldMat = shader(FIELD_FRAG, { uTime: { value: 0 }, uAspect: { value: 1 } });
  let field = rt(1, 1, { type: THREE.HalfFloatType });

  /* fluid (same solver as the hero, at a coarser grid) */
  const SIM = 128;
  let simW = SIM, simH = SIM;
  const half = { type: THREE.HalfFloatType };
  const vel = [rt(1, 1, half), rt(1, 1, half)], prs = [rt(1, 1, half), rt(1, 1, half)], div = rt(1, 1, half);
  const texel = new THREE.Vector2();
  const splatMat = shader(SPLAT_FRAG, { uVel: { value: null }, uPoint: { value: new THREE.Vector2() }, uForce: { value: new THREE.Vector2() }, uRadius: { value: 0.0016 }, uAspect: { value: 1 } });
  const divMat = shader(DIVERGENCE_FRAG, { uVel: { value: null }, uTexel: { value: texel } });
  const prsMat = shader(PRESSURE_FRAG, { uPressure: { value: null }, uDiv: { value: null }, uTexel: { value: texel } });
  const gradMat = shader(GRADIENT_FRAG, { uPressure: { value: null }, uVel: { value: null }, uTexel: { value: texel } });
  const advMat = shader(ADVECT_FRAG, { uVel: { value: null }, uTexel: { value: texel }, uDt: { value: 1 / 60 }, uDissipation: { value: 3 } });
  const scaleMat = shader(SCALE_FRAG, { uTex: { value: null }, uScale: { value: 0.8 } });
  const displayMat = shader(DISPLAY_FRAG, { uField: { value: null }, uVel: { value: null }, uSimSize: { value: new THREE.Vector2(SIM, SIM) }, uStrength: { value: 0.3 } });
  const swap = (a) => { const t = a[0]; a[0] = a[1]; a[1] = t; };

  let W = 1, H = 1;
  function resize() {
    W = host.clientWidth || 1; H = host.clientHeight || 1;
    renderer.setSize(W, H, false);
    const dpr = renderer.getPixelRatio();
    field.setSize(Math.max(1, Math.round(W * dpr)), Math.max(1, Math.round(H * dpr)));
    const aspect = W / H;
    simW = aspect >= 1 ? SIM : Math.round(SIM * aspect);
    simH = aspect >= 1 ? Math.round(SIM / aspect) : SIM;
    [...vel, ...prs, div].forEach((t) => t.setSize(simW, simH));
    texel.set(1 / simW, 1 / simH);
    splatMat.uniforms.uAspect.value = aspect;
    fieldMat.uniforms.uAspect.value = aspect;
    displayMat.uniforms.uSimSize.value.set(simW, simH);
  }
  new ResizeObserver(resize).observe(host);
  resize();

  /* pointer → fluid */
  const splat = { x: 0.5, y: 0.5, dx: 0, dy: 0, has: false };
  let lastPx = null;
  events.addEventListener('pointermove', (e) => {
    const r = host.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (lastPx) { splat.dx += x - lastPx.x; splat.dy += y - lastPx.y; }
    lastPx = { x, y };
    splat.x = x / r.width; splat.y = 1 - y / r.height; splat.has = true;
  });
  events.addEventListener('pointerleave', () => { lastPx = null; });

  function stepFluid(dt) {
    if (splat.has && (splat.dx || splat.dy)) {
      splatMat.uniforms.uVel.value = vel[0].texture;
      splatMat.uniforms.uPoint.value.set(splat.x, splat.y);
      splatMat.uniforms.uForce.value.set(
        (splat.dx / W) * simW / Math.max(dt, 1 / 120) * 0.07,
        (-splat.dy / H) * simH / Math.max(dt, 1 / 120) * 0.07,
      );
      pass(splatMat, vel[1]); swap(vel);
    }
    splat.dx = splat.dy = 0;
    divMat.uniforms.uVel.value = vel[0].texture;
    pass(divMat, div);
    scaleMat.uniforms.uTex.value = prs[0].texture;
    pass(scaleMat, prs[1]); swap(prs);
    for (let i = 0; i < 6; i++) {
      prsMat.uniforms.uPressure.value = prs[0].texture;
      prsMat.uniforms.uDiv.value = div.texture;
      pass(prsMat, prs[1]); swap(prs);
    }
    gradMat.uniforms.uPressure.value = prs[0].texture;
    gradMat.uniforms.uVel.value = vel[0].texture;
    pass(gradMat, vel[1]); swap(vel);
    advMat.uniforms.uVel.value = vel[0].texture;
    advMat.uniforms.uDt.value = dt;
    pass(advMat, vel[1]); swap(vel);
  }

  function render(t, dt) {
    fieldMat.uniforms.uTime.value = t;
    pass(fieldMat, field);
    if (!reduceMotion) stepFluid(dt);
    displayMat.uniforms.uField.value = field.texture;
    displayMat.uniforms.uVel.value = vel[0].texture;
    pass(displayMat, null);
  }

  // static for reduced motion; otherwise animate only while the footer is on screen
  const T0 = 40;   // start mid-drift rather than from the noise's origin
  if (reduceMotion) { render(T0, 0); return { setActive() {} }; }
  const clock = new THREE.Clock(false);
  let raf = 0, time = T0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 1 / 30);
    time += dt;
    render(time, dt);
  };
  render(time, 0);
  // the page tells us when the footer is uncovered; animate only then
  return {
    setActive(on) {
      if (on && !raf) { clock.start(); loop(); }
      else if (!on && raf) { cancelAnimationFrame(raf); raf = 0; clock.stop(); }
    },
  };
}
