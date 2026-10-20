// Footer background: crumpled grid paper, generated in a shader at the screen's full pixel
// density (so it stays crisp), plus the hero's pointer fluid, which smears it like liquid.
// The paper is static, so it is drawn once into a texture; after that only the fluid and the
// display pass run, and only while the pointer has stirred it recently.
import * as THREE from 'three';
import { QUAD_VERT, SPLAT_FRAG, DIVERGENCE_FRAG, PRESSURE_FRAG, GRADIENT_FRAG, ADVECT_FRAG, SCALE_FRAG } from './hero.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* crumpled paper: smooth-voronoi facets, each tilted its own way (two scales), lit from the
   top left; darker creases where cells meet; a grid printed on it that kinks with the folds */
const PAPER_FRAG = /* glsl */`
uniform vec2 uRes; uniform float uPx;
varying vec2 vUv;
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float hash1(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// facet tilt (xy) of the nearest cell, eased toward the next cell only right at the crease,
// plus crease strength (z): flat planes with straight, soft-edged folds between them
vec3 facets(vec2 x, float crease) {
  vec2 n = floor(x), f = fract(x);
  float d1 = 8.0, d2 = 8.0; vec2 t1 = vec2(0.0), t2 = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash2(n + g);
    vec2 r = g + o - f;
    float d = dot(r, r);
    vec2 t = hash2(n + g + 17.31) * 2.0 - 1.0;
    if (d < d1) { d2 = d1; t2 = t1; d1 = d; t1 = t; } else if (d < d2) { d2 = d; t2 = t; }
  }
  float edge = (d2 - d1) / (2.0 * sqrt(d2) + 1e-4);   // ~distance to the cell border
  float k = 1.0 - smoothstep(0.0, crease, edge);
  return vec3(mix(t1, (t1 + t2) * 0.5, k), 1.0 - smoothstep(0.0, crease * 0.6, edge));
}
// a few long straight folds across the whole sheet
vec2 folds(vec2 p) {
  vec2 t = vec2(0.0);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 dir = normalize(vec2(cos(fi * 2.39 + 0.6), sin(fi * 2.39 + 0.6)));
    vec2 c = (hash2(vec2(fi, 3.7)) - 0.5) * 2.2;
    float s = dot(p - c, dir);
    t += dir * 0.35 * smoothstep(-0.025, 0.025, s) * (mod(fi, 2.0) * 2.0 - 1.0);
  }
  return t;
}
void main() {
  vec2 px = vUv * uRes / uPx;                       // CSS pixels
  vec2 p = px / 300.0;                              // facets ~300px across
  vec3 a = facets(p, 0.05);
  vec3 b = facets(p * 2.6 + 7.7, 0.07);
  vec2 tilt = a.xy * 0.7 + b.xy * 0.3 + folds((vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0));
  vec3 nrm = normalize(vec3(-tilt * 0.55, 1.0));
  vec3 L = normalize(vec3(-0.55, 0.65, 0.75));
  float lit = dot(nrm, L);

  vec3 paper = vec3(0.95, 0.94, 0.918);
  vec3 col = paper * (0.83 + 0.22 * lit);
  col *= 1.0 - 0.045 * a.z - 0.025 * b.z;           // crease lines

  // printed grid, 30px, displaced a little by the fold under it
  vec2 g = px + tilt * 3.5;
  vec2 gv = abs(fract(g / 30.0 - 0.5) - 0.5) * 30.0;
  float aa = max(fwidth(g.x), fwidth(g.y)) * 0.75 + 0.3;
  float line = max(1.0 - smoothstep(0.35, 0.35 + aa, gv.x), 1.0 - smoothstep(0.35, 0.35 + aa, gv.y));
  col = mix(col, col * vec3(0.42, 0.42, 0.44), line * 0.5);

  // paper grain and a soft vignette
  col += (hash1(floor(px * 1.5)) - 0.5) * 0.028;
  col *= 1.0 - 0.1 * pow(length(vUv - 0.5) * 1.25, 2.4);
  gl_FragColor = vec4(pow(max(col, 0.0), vec3(2.2)), 1.0);   // to linear
}`;

// warps the paper along the velocity field, with a faint colour fringe on fast flow
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
  col += mix(vec3(0.25, 0.3, 0.9), vec3(0.9, 0.3, 0.45), sin(m * 14.0) * 0.5 + 0.5) * smoothstep(0.02, 0.09, m) * 0.05;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function startFooterPaper({ host, events }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'contact__gl';
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' });
  } catch { return null; }   // no WebGL: the CSS paper stays
  host.prepend(canvas);
  host.classList.add('has-gl');
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));   // full density: the grid must stay sharp
  renderer.autoClear = false;

  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  quadScene.add(quad);
  const shader = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  const pass = (material, target) => { quad.material = material; renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); };
  const rt = (w, h, opts = {}) => new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, ...opts });

  const paperMat = shader(PAPER_FRAG, { uRes: { value: new THREE.Vector2(1, 1) }, uPx: { value: 1 } });
  const paper = rt(1, 1, { type: THREE.HalfFloatType });

  /* fluid (same solver as the hero) */
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
  const displayMat = shader(DISPLAY_FRAG, { uField: { value: paper.texture }, uVel: { value: null }, uSimSize: { value: new THREE.Vector2(SIM, SIM) }, uStrength: { value: 0.3 } });
  const swap = (a) => { const t = a[0]; a[0] = a[1]; a[1] = t; };

  let W = 1, H = 1;
  function draw() {
    displayMat.uniforms.uVel.value = vel[0].texture;
    pass(displayMat, null);
  }
  function resize() {
    W = host.clientWidth || 1; H = host.clientHeight || 1;
    renderer.setSize(W, H, false);
    const dpr = renderer.getPixelRatio();
    paper.setSize(Math.round(W * dpr), Math.round(H * dpr));
    paperMat.uniforms.uRes.value.set(W * dpr, H * dpr);
    paperMat.uniforms.uPx.value = dpr;
    const aspect = W / H;
    simW = aspect >= 1 ? SIM : Math.round(SIM * aspect);
    simH = aspect >= 1 ? Math.round(SIM / aspect) : SIM;
    [...vel, ...prs, div].forEach((t) => t.setSize(simW, simH));
    texel.set(1 / simW, 1 / simH);
    splatMat.uniforms.uAspect.value = aspect;
    displayMat.uniforms.uSimSize.value.set(simW, simH);
    pass(paperMat, paper);   // the paper itself only changes with the size
    draw();
  }
  new ResizeObserver(resize).observe(host);
  resize();
  if (reduceMotion) return { setActive() {} };

  /* pointer → fluid */
  const splat = { x: 0.5, y: 0.5, dx: 0, dy: 0, has: false };
  let lastPx = null, stirredAt = -1e9;
  events.addEventListener('pointermove', (e) => {
    const r = host.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (lastPx) { splat.dx += x - lastPx.x; splat.dy += y - lastPx.y; }
    lastPx = { x, y };
    splat.x = x / r.width; splat.y = 1 - y / r.height; splat.has = true;
    stirredAt = performance.now();
    wake();
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

  // run only while the footer is uncovered and the fluid is still settling (~3s after a stir);
  // when idle the canvas simply keeps its last frame
  let active = false, raf = 0, last = 0;
  const loop = (now) => {
    const dt = Math.min((now - last) / 1000 || 1 / 60, 1 / 30);
    last = now;
    stepFluid(dt);
    draw();
    raf = active && now - stirredAt < 3000 ? requestAnimationFrame(loop) : 0;
  };
  function wake() {
    if (active && !raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
  }
  return {
    setActive(on) {
      active = on;
      if (on) wake();
      else if (raf) { cancelAnimationFrame(raf); raf = 0; }
    },
  };
}
