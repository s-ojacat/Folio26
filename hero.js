// Hero WebGL: the photo, falling stickers, a glass "hello" + cursor that refract them,
// and a fluid field the pointer stirs, which warps the whole frame like liquid.
//
// Per frame:
//   1. photo + stickers → bgTarget (half res)       what the glass sees through
//   2. photo + stickers + glass → sceneTarget        the composed frame
//   3. fluid sim step (low res velocity field, pointer splats, pressure projection)
//   4. display: sceneTarget sampled through the velocity field, with a spectral split
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { sparkleTexture, currentTheme } from './gloss.js';
import { buildStickerAtlas } from './sticker-art.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ───────── The word ─────────
   One continuous stroke. Units: baseline 0, x-height 1, ascenders ~2.3. */
// One continuous stroke. Units: baseline 0, x-height 1, ascenders ~2.3.
const HELLO = [
  [-0.95, -0.05], [-0.45, 0.12], [0.02, 0.62], [0.42, 1.3], [0.66, 1.86], [0.72, 2.2],   // lead-in up to h
  [0.56, 2.34], [0.33, 2.16], [0.22, 1.6], [0.14, 0.86], [0.08, 0.0],                   // h loop + stem
  [0.18, 0.48], [0.46, 0.9], [0.86, 1.02], [1.16, 0.82], [1.24, 0.38], [1.32, 0.04],    // h shoulder
  [1.62, 0.02], [2.04, 0.3], [2.34, 0.66], [2.32, 0.96], [2.06, 1.04], [1.8, 0.84],    // e loop
  [1.72, 0.44], [1.88, 0.06], [2.24, -0.04], [2.62, 0.14],
  [2.94, 0.78], [3.2, 1.62], [3.28, 2.12], [3.12, 2.32], [2.9, 2.14], [2.84, 1.6],     // first l
  [2.86, 0.8], [2.94, 0.16], [3.2, -0.04], [3.56, 0.12],
  [3.88, 0.78], [4.14, 1.62], [4.22, 2.12], [4.06, 2.32], [3.84, 2.14], [3.78, 1.6],   // second l
  [3.8, 0.8], [3.88, 0.16], [4.14, -0.04], [4.46, 0.14],
  [4.62, 0.56], [4.88, 0.94], [5.22, 1.02], [5.5, 0.82], [5.56, 0.44], [5.42, 0.1],    // o
  [5.12, -0.03], [4.84, 0.08], [4.72, 0.42], [4.86, 0.8], [5.2, 0.98],
  [5.78, 1.0], [6.4, 0.98], [6.95, 1.06], [7.3, 1.18],                                  // tail
];
const TUBE = 0.22;
const SLANT = new THREE.Matrix4().makeShear(0.12, 0, 0, 0, 0, 0);

/* ───────── Shaders ───────── */
const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// photo, object-fit: cover with a focal point, plus a hair of pointer parallax
const PHOTO_FRAG = /* glsl */`
uniform sampler2D uMap; uniform vec2 uScale; uniform vec2 uFocus; uniform vec2 uShift;
uniform float uFade; uniform vec3 uFadeColor;
varying vec2 vUv;
void main() {
  vec2 uv = (vUv - 0.5) * uScale + uFocus + uShift;
  vec3 photo = texture2D(uMap, clamp(uv, 0.0, 1.0)).rgb;
  gl_FragColor = vec4(mix(photo, uFadeColor, uFade), 1.0);
}`;

const GLASS_VERT = /* glsl */`
varying vec3 vN; varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

// screen-space refraction of the photo with chromatic aberration, a cool tint that
// thickens toward the edges, two specular lobes and a fresnel rim
const GLASS_FRAG = /* glsl */`
uniform sampler2D uBg; uniform vec2 uRes;
uniform float uRefract; uniform float uCA; uniform float uSpec; uniform float uShine;
uniform float uFresnelPow; uniform float uFresnelStr; uniform float uBright; uniform float uSat;
uniform vec3 uTintA; uniform vec3 uTintB; uniform vec3 uLight; uniform float uVanish;
varying vec3 vN; varying vec3 vV;
vec3 saturate3(vec3 c, float s) { return mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, s); }
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  vec2 uv = gl_FragCoord.xy / uRes;
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float edge = 1.0 - ndv;

  vec2 off = -n.xy * uRefract * (0.03 + 0.09 * edge);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float k = 1.0 + float(i) * 0.08;
    col.r += texture2D(uBg, uv + off * k * (1.0 - uCA)).r;
    col.g += texture2D(uBg, uv + off * k).g;
    col.b += texture2D(uBg, uv + off * k * (1.0 + uCA)).b;
  }
  col /= 3.0;

  vec3 tint = mix(uTintA, uTintB, edge);
  col = mix(col, col * tint * 1.3, 0.2 + 0.45 * edge);   // clear in the middle, tinted toward the rims
  col = saturate3(col, uSat) * uBright;

  vec3 l = normalize(uLight);
  vec3 h = normalize(l + v);
  float nh = max(dot(n, h), 0.0);
  col += uSpec * pow(nh, uShine);                    // tight hot spot
  col += 0.18 * uSpec * pow(nh, uShine * 0.08) * tint; // broad sheen
  col += uFresnelStr * pow(edge, uFresnelPow) * mix(vec3(1.0), uTintA, 0.3);
  col += 0.06 * max(dot(n, l), 0.0);
  col = mix(col, texture2D(uBg, uv).rgb, uVanish);
  gl_FragColor = vec4(col, 1.0);
}`;

// flat sticker cards, one instanced plane each, cut from an atlas
const STICKER_VERT = /* glsl */`
attribute vec4 uvRect;
varying vec2 vUv;
void main() {
  vUv = uvRect.xy + uv * uvRect.zw;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const STICKER_FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.01) discard;
  gl_FragColor = c;
}`;

const SPLAT_FRAG = /* glsl */`
uniform sampler2D uVel; uniform vec2 uPoint; uniform vec2 uForce; uniform float uRadius; uniform float uAspect;
varying vec2 vUv;
void main() {
  vec2 d = vUv - uPoint; d.x *= uAspect;
  vec2 v = texture2D(uVel, vUv).xy + uForce * exp(-dot(d, d) / uRadius);
  gl_FragColor = vec4(v, 0.0, 1.0);
}`;

const DIVERGENCE_FRAG = /* glsl */`
uniform sampler2D uVel; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  float l = texture2D(uVel, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture2D(uVel, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture2D(uVel, vUv - vec2(0.0, uTexel.y)).y;
  float t = texture2D(uVel, vUv + vec2(0.0, uTexel.y)).y;
  gl_FragColor = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
}`;

const PRESSURE_FRAG = /* glsl */`
uniform sampler2D uPressure; uniform sampler2D uDiv; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  float l = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  gl_FragColor = vec4((l + r + b + t - texture2D(uDiv, vUv).x) * 0.25, 0.0, 0.0, 1.0);
}`;

const GRADIENT_FRAG = /* glsl */`
uniform sampler2D uPressure; uniform sampler2D uVel; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  float l = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  gl_FragColor = vec4(texture2D(uVel, vUv).xy - 0.5 * vec2(r - l, t - b), 0.0, 1.0);
}`;

const ADVECT_FRAG = /* glsl */`
uniform sampler2D uVel; uniform vec2 uTexel; uniform float uDt; uniform float uDissipation;
varying vec2 vUv;
void main() {
  vec2 coord = clamp(vUv - texture2D(uVel, vUv).xy * uTexel * uDt, 0.0, 1.0);
  gl_FragColor = vec4(texture2D(uVel, coord).xy / (1.0 + uDissipation * uDt), 0.0, 1.0);
}`;

const SCALE_FRAG = /* glsl */`
uniform sampler2D uTex; uniform float uScale;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(uTex, vUv) * uScale; }`;

// warps the frame along the velocity field; fast flow gets a rainbow edge
const DISPLAY_FRAG = /* glsl */`
uniform sampler2D uScene; uniform sampler2D uVel; uniform vec2 uSimSize; uniform float uStrength; uniform float uChroma;
uniform vec3 uSheenA; uniform vec3 uSheenB;
uniform float uDots; uniform vec3 uDotColor; uniform float uDotPx; uniform float uShade;
uniform float uWash; uniform float uWashTop; uniform float uWashLen;
varying vec2 vUv;
void main() {
  vec2 disp = texture2D(uVel, vUv).xy / uSimSize * uStrength;
  float m = length(disp);
  vec3 col = vec3(0.0); vec3 wsum = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float t = float(i) / 4.0;
    vec3 w = max(vec3(0.0), cos((t - vec3(0.0, 0.5, 1.0)) * 3.14159 * 0.5));
    col += texture2D(uScene, clamp(vUv - disp * (0.35 + 0.65 * t), 0.0, 1.0)).rgb * w;
    wsum += w;
  }
  col /= max(wsum, vec3(1e-4));
  // fast flow picks up a warm sheen drawn from the photo's palette
  col += mix(uSheenA, uSheenB, sin(m * 14.0) * 0.5 + 0.5) * smoothstep(0.02, 0.09, m) * 0.08 * uChroma;

  // depth: a soft shadow along the bottom of the first fold. It lives in this fixed layer
  // (not the page), so it never shows a scrolling edge; it fades out as you scroll.
  col *= 1.0 - uShade * 0.45 * (1.0 - smoothstep(0.0, 0.38, vUv.y));

  // from the work section down, wash toward the page colour: a smooth gradient that starts at
  // the section's top edge and reaches full strength over uWashLen of the screen
  col = mix(col, uDotColor, uWash * smoothstep(0.0, 1.0, (uWashTop - vUv.y) / uWashLen));

  // scroll transition: a grid of dots in the page colour grows over the scene, stopping just
  // short of solid so the photo persists as a fine dot pattern behind the rest of the page
  vec2 cell = fract(gl_FragCoord.xy / uDotPx);
  float d = distance(cell, vec2(0.5));
  float r = 0.9 * clamp(uDots, 0.0, 1.0);
  float aa = fwidth(d) * 1.5;
  col = mix(col, uDotColor, smoothstep(r, r - aa, d) * step(0.001, uDots));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/* ───────── Setup ───────── */
export function startHero({ canvas, hero, pointer, onReady }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.autoClear = false;

  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  quadScene.add(quad);
  const shader = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  function pass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }
  const rt = (w, h, opts = {}) => new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, ...opts,
  });

  /* photo */
  const photoMat = shader(PHOTO_FRAG, {
    uMap: { value: null }, uScale: { value: new THREE.Vector2(1, 1) },
    uFocus: { value: new THREE.Vector2(0.5, 0.6) }, uShift: { value: new THREE.Vector2() },
    uFade: { value: 0 }, uFadeColor: { value: new THREE.Color() },
  });
  // the page colour (--bg): the dots close over the hero in it as you scroll away
  const readPageColor = () => photoMat.uniforms.uFadeColor.value.set(
    getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0f1111');
  readPageColor();
  let imgAspect = 2000 / 1132;

  /* glass word */
  const theme0 = currentTheme();
  const glassMat = new THREE.ShaderMaterial({
    vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG,
    uniforms: {
      uBg: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
      uRefract: { value: 0.72 }, uCA: { value: 0.14 },
      uSpec: { value: 1.2 }, uShine: { value: 100 },
      uFresnelPow: { value: 3 }, uFresnelStr: { value: 0.72 },
      uBright: { value: 0.92 }, uSat: { value: 1.2 },
      uTintA: { value: new THREE.Color(theme0.glassA) }, uTintB: { value: new THREE.Color(theme0.glassB) },
      uLight: { value: new THREE.Vector3(-0.45, 0.75, 0.5) },
      uVanish: { value: 0 },
    },
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const pivot = new THREE.Group();   // spin-in + scroll turn
  const body = new THREE.Group();    // idle float
  pivot.add(body);
  scene.add(pivot);

  const pts = HELLO.map(([x, y], i) => new THREE.Vector3(x, y, Math.sin(i * 0.85) * 0.1));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  const parts = [new THREE.TubeGeometry(curve, 1600, TUBE, 32, false)];
  for (const p of [curve.getPoint(0), curve.getPoint(1)]) {
    const s = new THREE.SphereGeometry(TUBE, 32, 24);
    s.translate(p.x, p.y, p.z);
    parts.push(s);
  }
  const box = new THREE.Box3();
  parts.forEach((g) => { g.applyMatrix4(SLANT); g.computeBoundingBox(); box.union(g.boundingBox); });
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  parts.forEach((g) => { g.translate(-center.x, -center.y, -center.z); body.add(new THREE.Mesh(g, glassMat)); });

  // glints on the front of the tube
  const sparkles = [];
  const spriteMat = new THREE.SpriteMaterial({ map: sparkleTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  {
    const pos = parts[0].attributes.position, nor = parts[0].attributes.normal;
    for (let i = 0; i < 18; i++) {
      let k = 0, tries = 0;
      do { k = (Math.random() * pos.count) | 0; tries++; } while (nor.getZ(k) < 0.8 && tries < 500);
      const s = new THREE.Sprite(spriteMat.clone());
      s.position.set(pos.getX(k) + nor.getX(k) * 0.05, pos.getY(k) + nor.getY(k) * 0.05, pos.getZ(k) + nor.getZ(k) * 0.05);
      s.userData = { base: 0.18 + Math.random() * 0.26, speed: 0.6 + Math.random() * 0.9, phase: Math.random() * 6.28 };
      body.add(s);
      sparkles.push(s);
    }
  }

  /* ───────── Glass cursor: same material as the word, spins twice as you scroll ───────── */
  const cursorGroup = new THREE.Group();   // position + scroll ride
  const cursorTilt = new THREE.Group();    // the spin axis leans 45°
  const cursorSpin = new THREE.Group();
  cursorTilt.rotation.z = THREE.MathUtils.degToRad(45);
  cursorGroup.add(cursorTilt); cursorTilt.add(cursorSpin);
  scene.add(cursorGroup);
  {
    const shape = new THREE.Shape();
    [[0, 0], [0.92, -0.36], [0.48, -0.5], [0.36, -0.94]].forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    shape.closePath();
    let g = new THREE.ExtrudeGeometry(shape, { depth: 0.08, curveSegments: 12, bevelEnabled: true, bevelThickness: 0.13, bevelSize: 0.1, bevelSegments: 10 });
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g, 1e-4);
    g.computeVertexNormals();
    g.center();
    const m = new THREE.Mesh(g, glassMat);
    m.rotation.z = THREE.MathUtils.degToRad(-45);   // undo the axis lean so it still points up-left
    cursorSpin.add(m);
  }
  let cursorYaw = 0;

  /* ───────── Falling stickers ─────────
     They sit behind the glass (so it bends them), drift down with a little wind and
     spin, grow in as they enter and shrink out at the end, then respawn at the top as a
     different sticker. A click releases a burst from that spot. */
  const stickerScene = new THREE.Scene();
  const STICKER_MAX = 160;
  const stickerGeo = new THREE.PlaneGeometry(1, 1);
  const uvAttr = new THREE.InstancedBufferAttribute(new Float32Array(STICKER_MAX * 4), 4);
  stickerGeo.setAttribute('uvRect', uvAttr);
  const stickerMat = new THREE.ShaderMaterial({
    vertexShader: STICKER_VERT, fragmentShader: STICKER_FRAG, uniforms: { uMap: { value: null } },
    transparent: true, depthWrite: false, depthTest: false,
  });
  const stickerMesh = new THREE.InstancedMesh(stickerGeo, stickerMat, STICKER_MAX);
  stickerMesh.count = 0;
  stickerMesh.frustumCulled = false;
  stickerScene.add(stickerMesh);
  let atlas = null;
  let flakes = [];
  const STICKER_Z = -1.3;
  const viewH = (z) => 2 * (baseDist - z) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  function pickTexture() {
    const onScreen = new Set(flakes.filter((f) => !f.oneShot && f.started && !f.dead).map((f) => f.tex));
    const free = atlas.rects.map((_, i) => i).filter((i) => !onScreen.has(i));
    const pool = free.length ? free : atlas.rects.map((_, i) => i);
    return pool[(Math.random() * pool.length) | 0];
  }
  function spawn(f, mode, origin) {
    const V = viewH(STICKER_Z), Wv = V * (W / H);
    f.z = STICKER_Z + (Math.random() - 0.5) * 1.4;
    if (mode === 'click') {
      f.x = origin.x + (Math.random() - 0.5) * V * 0.25;
      f.y = origin.y + Math.random() * V * 0.12;
    } else {
      f.x = (Math.random() - 0.5) * Wv * 1.25;
      f.y = mode === 'initial' ? V * 0.5 + V * 0.25 - Math.random() * V * 1.3 : V * 0.5 + V * 0.12 + Math.random() * V * 0.3;
    }
    f.startY = f.y;
    f.speed = V * 0.075 * (0.6 + 0.8 * Math.random());
    f.rot = Math.random() * Math.PI * 2;
    f.rotSpeed = (Math.random() - 0.5) * 1.6;
    f.phase = Math.random() * Math.PI * 2;
    f.amp = V * (0.0125 + Math.random() * 0.075);
    f.fall = V * 2;
    f.size = V * (mode === 'click' ? 0.11 : 0.12);
    f.started = true; f.dead = false;
  }
  function makeFlakes(n, oneShot) {
    const order = atlas.rects.map((_, i) => i).sort(() => Math.random() - 0.5);
    return Array.from({ length: n }, (_, i) => ({ tex: order[i % order.length], oneShot, started: false, dead: false, emitAt: 0 }));
  }
  let stickerTime = 0;
  function burstAt(clientX, clientY) {
    if (!atlas) return;
    const r = hero.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(stickerPlane, hit)) return;
    const burst = makeFlakes(atlas.rects.length, true);
    let at = stickerTime + Math.random() * 0.05;
    for (const f of burst) { f.emitAt = at; f.origin = { x: hit.x, y: hit.y }; at += 0.04 + Math.random() * 0.04; }
    flakes = flakes.concat(burst).filter((f) => !f.oneShot || !f.dead).slice(-STICKER_MAX);
  }
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const stickerPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -STICKER_Z);
  const tmpObj = new THREE.Object3D();

  function stepStickers(dt) {
    if (!atlas) return;
    stickerTime += dt;
    const live = [];
    for (const f of flakes) {
      if (!f.started) {
        if (stickerTime < f.emitAt) continue;
        if (f.oneShot) spawn(f, 'click', f.origin); else { f.tex = pickTexture(); spawn(f, 'respawn'); }
      }
      if (f.dead) continue;
      if (!reduceMotion) {
        f.y -= f.speed * dt;
        f.x += Math.sin(stickerTime * 0.3 + f.phase) * f.amp * dt;
        f.rot += f.rotSpeed * dt;
      }
      const prog = THREE.MathUtils.clamp((f.startY - f.y) / f.fall, 0, 1);
      f.scale = THREE.MathUtils.clamp(prog < 0.05 ? prog / 0.05 : prog > 0.9 ? (1 - prog) / 0.1 : 1, 0, 1);
      if (f.y < f.startY - f.fall) {
        if (f.oneShot) { f.dead = true; continue; }
        f.started = false;
        f.emitAt = stickerTime + 0.04 + Math.random() * 0.04;
        continue;
      }
      live.push(f);
    }
    live.sort((a, b) => a.z - b.z);   // far ones first
    const n = Math.min(live.length, STICKER_MAX);
    for (let i = 0; i < n; i++) {
      const f = live[i], r = atlas.rects[f.tex], a = atlas.aspects[f.tex];
      tmpObj.position.set(f.x, f.y, f.z);
      tmpObj.rotation.set(0, 0, f.rot);
      tmpObj.scale.set(f.size * a * f.scale, f.size * f.scale, 1);
      tmpObj.updateMatrix();
      stickerMesh.setMatrixAt(i, tmpObj.matrix);
      uvAttr.setXYZW(i, r[0], r[1], r[2], r[3]);
    }
    stickerMesh.count = n;
    stickerMesh.instanceMatrix.needsUpdate = true;
    uvAttr.needsUpdate = true;
  }

  buildStickerAtlas().then((a) => {
    const tex = new THREE.CanvasTexture(a.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    stickerMat.uniforms.uMap.value = tex;
    atlas = a;
    seedStickers();
  });
  let layoutReady = false;
  function seedStickers() {
    if (!atlas || !layoutReady || flakes.length) return;
    flakes = makeFlakes(atlas.rects.length, false);
    for (const f of flakes) spawn(f, 'initial');
  }

  // a click (not a drag, not on a link) drops a handful of stickers from that spot
  let downAt = null;
  hero.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  hero.addEventListener('pointerup', (e) => {
    if (!downAt || e.target.closest('a,button')) return;
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6 && !reduceMotion) burstAt(e.clientX, e.clientY);
    downAt = null;
  });

  /* fluid */
  const SIM = 160;
  let simW = SIM, simH = SIM;
  const half = { type: THREE.HalfFloatType };
  let vel = [rt(1, 1, half), rt(1, 1, half)], prs = [rt(1, 1, half), rt(1, 1, half)], div = rt(1, 1, half);
  const texel = new THREE.Vector2();
  const splatMat = shader(SPLAT_FRAG, { uVel: { value: null }, uPoint: { value: new THREE.Vector2() }, uForce: { value: new THREE.Vector2() }, uRadius: { value: 0.0016 }, uAspect: { value: 1 } });
  const divMat = shader(DIVERGENCE_FRAG, { uVel: { value: null }, uTexel: { value: texel } });
  const prsMat = shader(PRESSURE_FRAG, { uPressure: { value: null }, uDiv: { value: null }, uTexel: { value: texel } });
  const gradMat = shader(GRADIENT_FRAG, { uPressure: { value: null }, uVel: { value: null }, uTexel: { value: texel } });
  const advMat = shader(ADVECT_FRAG, { uVel: { value: null }, uTexel: { value: texel }, uDt: { value: 1 / 60 }, uDissipation: { value: 3 } });
  const scaleMat = shader(SCALE_FRAG, { uTex: { value: null }, uScale: { value: 0.8 } });
  const displayMat = shader(DISPLAY_FRAG, { uScene: { value: null }, uVel: { value: null }, uSimSize: { value: new THREE.Vector2(SIM, SIM) }, uStrength: { value: 0.3 }, uChroma: { value: 1 },
    uSheenA: { value: new THREE.Color(theme0.sheenA) }, uSheenB: { value: new THREE.Color(theme0.sheenB) },
    uDots: { value: 0 }, uDotColor: { value: photoMat.uniforms.uFadeColor.value }, uDotPx: { value: 16 }, uShade: { value: 1 },
    // 0.965 in linear light ≈ the 80% sRGB wash the CSS --texture uses, so the two meet seamlessly
    uWash: { value: 0.965 }, uWashTop: { value: -1 }, uWashLen: { value: 0.6 } });

  let bgTarget = rt(1, 1), sceneTarget = rt(1, 1, { depthBuffer: true, samples: 4 });
  const swap = (a) => { const t = a[0]; a[0] = a[1]; a[1] = t; };

  /* layout */
  let W = 1, H = 1, baseDist = 10, bandY = 0, worldH = 1;
  function resize() {
    W = hero.clientWidth; H = hero.clientHeight;
    renderer.setSize(W, H, false);
    const dpr = renderer.getPixelRatio();
    sceneTarget.setSize(Math.round(W * dpr), Math.round(H * dpr));
    bgTarget.setSize(Math.round(W * dpr * 0.5), Math.round(H * dpr * 0.5));
    glassMat.uniforms.uRes.value.set(W * dpr, H * dpr);

    const aspect = W / H;
    simW = aspect >= 1 ? SIM : Math.round(SIM * aspect);
    simH = aspect >= 1 ? Math.round(SIM / aspect) : SIM;
    [...vel, ...prs, div].forEach((t) => t.setSize(simW, simH));
    texel.set(1 / simW, 1 / simH);
    splatMat.uniforms.uAspect.value = aspect;
    displayMat.uniforms.uSimSize.value.set(simW, simH);

    // cover-fit the photo
    const s = photoMat.uniforms.uScale.value;
    if (aspect > imgAspect) s.set(1, imgAspect / aspect); else s.set(aspect / imgAspect, 1);
    s.multiplyScalar(0.96);   // a slight zoom leaves room for the parallax drift
    // keep the visible window inside the image (focus ~ object-position 50% 40%)
    photoMat.uniforms.uFocus.value.set(
      THREE.MathUtils.clamp(0.5, s.x / 2 + 0.012, 1 - s.x / 2 - 0.012),
      THREE.MathUtils.clamp(0.6, s.y / 2 + 0.012, 1 - s.y / 2 - 0.012),
    );

    camera.aspect = aspect;
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const wide = aspect > 1.1;
    baseDist = Math.max(size.x / ((wide ? 0.6 : 0.98) * 2 * tan * aspect), size.y / ((wide ? 0.44 : 0.32) * 2 * tan));
    worldH = 2 * baseDist * tan;
    bandY = (wide ? 0.03 : 0.07) * worldH;   // word sits a touch above centre
    displayMat.uniforms.uDotPx.value = 8 * dpr;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);

  /* pointer → fluid */
  const splat = { x: 0.5, y: 0.5, dx: 0, dy: 0, has: false };
  let lastPx = null;
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (lastPx) { splat.dx += x - lastPx.x; splat.dy += y - lastPx.y; }
    lastPx = { x, y };
    splat.x = x / r.width; splat.y = 1 - y / r.height; splat.has = true;
  });
  hero.addEventListener('pointerleave', () => { lastPx = null; });

  /* motion state */
  const cam = new THREE.Vector2();
  // starts turned away and damps round to face you; scrolling turns it edge-on
  let yaw = reduceMotion ? THREE.MathUtils.degToRad(4) : THREE.MathUtils.degToRad(240);
  const light = new THREE.Vector2(-0.45, 0.75);
  const clock = new THREE.Clock();
  let visible = true, lastQuiet = -1;
  const workEl = document.querySelector('.work');
  const marqueeEl = document.querySelector('.work .marquee');
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { rootMargin: '0px 0px 40% 0px' }).observe(hero);

  function stepFluid(dt) {
    if (splat.has && (splat.dx || splat.dy) && !reduceMotion) {
      splatMat.uniforms.uVel.value = vel[0].texture;
      splatMat.uniforms.uPoint.value.set(splat.x, splat.y);
      // pixels moved this frame → sim texels per second
      splatMat.uniforms.uForce.value.set(
        (splat.dx / W) * simW / Math.max(dt, 1 / 120) * 0.07,
        (-splat.dy / H) * simH / Math.max(dt, 1 / 120) * 0.07,
      );
      pass(splatMat, vel[1]); swap(vel);
    }
    splat.dx = splat.dy = 0;

    divMat.uniforms.uVel.value = vel[0].texture;
    pass(divMat, div);
    scaleMat.uniforms.uTex.value = prs[0].texture;            // let last frame's pressure fade
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

  function frame() {
    requestAnimationFrame(frame);
    const rawDt = Math.min(clock.getDelta(), 0.25);   // real time, for easing
    const dt = Math.min(rawDt, 1 / 30);               // capped, for the fluid sim
    const t = clock.elapsedTime;
    // the wash follows the work section's top edge, so render at full rate while that edge is
    // on screen; otherwise, off the hero, the static dotted photo only needs ~4fps
    const wr = workEl ? workEl.getBoundingClientRect() : null;
    const vh = canvas.clientHeight || innerHeight;   // the canvas is the screen; measure against it
    // the gradient starts a quarter-screen above the work section and reaches full strength
    // where the first (opaque, textured) project row begins, right under the marquee
    const pre = vh * 0.25;
    displayMat.uniforms.uWashTop.value = wr ? 1 - (wr.top - pre) / vh : -1;
    if (marqueeEl) displayMat.uniforms.uWashLen.value = (pre + marqueeEl.offsetTop + marqueeEl.offsetHeight) / vh;
    const washMoving = wr && wr.top - pre < vh && wr.top > -vh * 0.7;
    if (!visible && !washMoving) { if (t - lastQuiet < 0.25) return; lastQuiet = t; }

    // camera trails the pointer, like a lagged parallax
    const ease = 1 - Math.exp(-(pointer.active ? 3.2 : 1.6) * dt);
    cam.x += ((pointer.active ? pointer.nx : 0) - cam.x) * ease;
    cam.y += ((pointer.active ? pointer.ny : 0) - cam.y) * ease;
    camera.position.set(cam.x * size.x * 0.12, cam.y * size.y * 0.16, baseDist);
    camera.lookAt(0, 0, 0);
    photoMat.uniforms.uShift.value.set(-cam.x * 0.006, -cam.y * 0.006);

    // scroll: the word rides up with the page at 72% speed and turns from ~4° to 90°
    // (edge-on), while the dots close over the scene
    const p = Math.max(0, scrollY / H);
    const after = THREE.MathUtils.clamp(p / 0.85, 0, 1);
    yaw = THREE.MathUtils.damp(yaw, THREE.MathUtils.degToRad(THREE.MathUtils.lerp(4, 90, after)), 6, rawDt);
    pivot.position.y = bandY + p * worldH * 0.72;
    pivot.rotation.set(0, yaw, 0);
    displayMat.uniforms.uDots.value = THREE.MathUtils.smoothstep(p, 0.32, 0.9) * 0.74;   // 0.74: dots almost touch, photo shows between
    displayMat.uniforms.uShade.value = 1 - THREE.MathUtils.smoothstep(p, 0.0, 0.55);

    // the cursor rides the scroll too, and spins twice around its tilted axis
    const wideNow = W / H > 1.1, worldW = worldH * (W / H);
    cursorGroup.position.set(worldW * (wideNow ? 0.36 : 0.3), -worldH * (wideNow ? 0.21 : 0.24) + p * worldH * 0.72, -0.6);
    cursorYaw = THREE.MathUtils.damp(cursorYaw, after * Math.PI * 4, 6, rawDt);
    cursorSpin.rotation.y = cursorYaw;
    cursorGroup.position.y += reduceMotion ? 0 : 0.06 * Math.sin(1.2 * t + 1.3) + 0.02 * Math.sin(0.6 * t);
    const cScale = Math.min(size.y * 0.32, worldW * 0.105);
    cursorGroup.scale.setScalar(cScale);

    // the highlight follows the pointer
    const lx = pointer.active ? pointer.nx * 1.4 : -0.45, ly = pointer.active ? pointer.ny * 1.4 : 0.75;
    light.x = THREE.MathUtils.damp(light.x, lx, 4, rawDt);
    light.y = THREE.MathUtils.damp(light.y, ly, 4, rawDt);
    glassMat.uniforms.uLight.value.set(light.x, light.y, 0.5);
    body.position.y = reduceMotion ? 0 : 0.07 * Math.sin(1.2 * t) + 0.025 * Math.sin(0.6 * t);
    body.rotation.set(reduceMotion ? 0 : Math.sin(t * 0.45) * 0.04, reduceMotion ? 0 : Math.sin(t * 0.3) * 0.07, 0);

    for (const s of sparkles) {
      const u = s.userData;
      const k = Math.max(0, Math.sin(t * u.speed + u.phase)) ** 3;
      s.scale.setScalar(u.base * (0.15 + k));
      s.material.opacity = 0.2 + 0.8 * k;
      s.material.rotation = t * 0.2 + u.phase;
    }

    stepStickers(rawDt);

    // what the glass sees: photo + stickers
    pass(photoMat, bgTarget);
    renderer.render(stickerScene, camera);
    // the frame: photo + stickers + glass
    pass(photoMat, sceneTarget);
    renderer.render(stickerScene, camera);
    glassMat.uniforms.uBg.value = bgTarget.texture;
    renderer.clearDepth();
    renderer.render(scene, camera);

    stepFluid(dt);

    displayMat.uniforms.uScene.value = sceneTarget.texture;
    displayMat.uniforms.uVel.value = vel[0].texture;
    pass(displayMat, null);
  }

  new THREE.TextureLoader().load('assets/hero-bg.webp', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    imgAspect = tex.image.width / tex.image.height;
    photoMat.uniforms.uMap.value = tex;
    resize();
    layoutReady = true;
    seedStickers();
    frame();
    onReady?.();
  });
}

