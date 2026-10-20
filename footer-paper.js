// Footer background: a photo of crumpled grid paper (assets/paper.jpg, turned to landscape),
// cover-fitted and drawn once per size at the screen's full pixel density with a light unsharp
// mask so the grid stays crisp when upscaled; then the hero's pointer fluid smears it like
// liquid. Only the fluid and the display pass run per frame, and only after a stir.
import * as THREE from 'three';
import { QUAD_VERT, SPLAT_FRAG, DIVERGENCE_FRAG, PRESSURE_FRAG, GRADIENT_FRAG, ADVECT_FRAG, SCALE_FRAG } from './hero.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// cover-fit the photo and sharpen it a touch (4-tap unsharp mask at the photo's own texel size)
const PAPER_FRAG = /* glsl */`
uniform sampler2D uImg; uniform vec2 uCover; uniform vec2 uTexel; uniform float uSharp;
varying vec2 vUv;
void main() {
  vec2 uv = (vUv - 0.5) * uCover + 0.5;
  vec3 c = texture2D(uImg, uv).rgb;
  vec3 n = texture2D(uImg, uv + vec2(uTexel.x, 0.0)).rgb + texture2D(uImg, uv - vec2(uTexel.x, 0.0)).rgb
         + texture2D(uImg, uv + vec2(0.0, uTexel.y)).rgb + texture2D(uImg, uv - vec2(0.0, uTexel.y)).rgb;
  c += (c - n * 0.25) * uSharp;
  gl_FragColor = vec4(max(c, 0.0), 1.0);
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

  const paperMat = shader(PAPER_FRAG, { uImg: { value: null }, uCover: { value: new THREE.Vector2(1, 1) }, uTexel: { value: new THREE.Vector2() }, uSharp: { value: 0.7 } });
  let imgAspect = 1308 / 736;
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
    const aspect = W / H;
    // cover: the photo fills the footer, cropped on the longer side
    paperMat.uniforms.uCover.value.set(...(aspect > imgAspect ? [1, imgAspect / aspect] : [aspect / imgAspect, 1]));
    simW = aspect >= 1 ? SIM : Math.round(SIM * aspect);
    simH = aspect >= 1 ? Math.round(SIM / aspect) : SIM;
    [...vel, ...prs, div].forEach((t) => t.setSize(simW, simH));
    texel.set(1 / simW, 1 / simH);
    splatMat.uniforms.uAspect.value = aspect;
    displayMat.uniforms.uSimSize.value.set(simW, simH);
    if (paperMat.uniforms.uImg.value) pass(paperMat, paper);   // the paper itself only changes with the size
    draw();
  }
  new ResizeObserver(resize).observe(host);
  new THREE.TextureLoader().load('assets/paper.jpg', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    imgAspect = tex.image.width / tex.image.height;
    paperMat.uniforms.uImg.value = tex;
    paperMat.uniforms.uTexel.value.set(1 / tex.image.width, 1 / tex.image.height);
    host.classList.add('has-gl');   // hide the CSS photo only once the WebGL one is drawn
    resize();
  });
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
