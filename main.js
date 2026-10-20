import { startHero } from './hero.js';
import { startFooterPaper } from './footer-paper.js';

const canvas = document.querySelector('.hero__gl');
const hero = document.querySelector('.hero');
const topBar = document.querySelector('.bar--top');

/* ───────── Text scramble for mono labels ───────── */
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*/<>';
function scramble(el, duration = 650) {
  const final = el.dataset.text ?? (el.dataset.text = el.textContent);
  const start = performance.now();
  cancelAnimationFrame(el._raf);
  const tick = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const reveal = Math.floor(p * final.length);
    let out = '';
    for (let i = 0; i < final.length; i++) {
      const c = final[i];
      out += i < reveal || c === ' ' || c === '.' || c === '@' || c === ':'
        ? c
        : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
    el.textContent = out;
    if (p < 1) el._raf = requestAnimationFrame(tick);
  };
  el._raf = requestAnimationFrame(tick);
}
const scrambleEls = [...document.querySelectorAll('[data-scramble]')];
scrambleEls.forEach((el) => {
  el.dataset.text = el.textContent;
  el.addEventListener('mouseenter', () => scramble(el, 420));
});

/* ───────── In-page links: one click, smooth glide ─────────
   The browser's own smooth scroll (CSS scroll-behavior) was getting cancelled on the first
   click, so links needed two. This drives the scroll directly instead: distance-based
   duration, ease-in-out (it's on-screen movement), lands just under the fixed nav, and
   hands control back the moment the user wheels, touches or presses a key. */
{
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let anim = null;
  const cancel = () => { if (anim) { cancelAnimationFrame(anim); anim = null; } };
  ['wheel', 'touchstart', 'keydown'].forEach((t) => addEventListener(t, cancel, { passive: true }));

  const glideTo = (y) => {
    cancel();
    const start = scrollY, dist = y - start;
    if (reduce || Math.abs(dist) < 2) { window.scrollTo(0, y); return; }
    const dur = Math.min(1200, Math.max(500, Math.abs(dist) * 0.35));
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      window.scrollTo(0, start + dist * easeInOut(p));
      anim = p < 1 ? requestAnimationFrame(step) : null;
    };
    anim = requestAnimationFrame(step);
  };

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const id = a.getAttribute('href').slice(1);
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    e.preventDefault();
    const navH = document.querySelector('.bar--top')?.offsetHeight || 0;
    // the footer is fixed behind the page, so 'Contact' means: scroll to the very end
    const y = id === 'top' ? 0 : id === 'contact' ? document.documentElement.scrollHeight - innerHeight
      : target.getBoundingClientRect().top + scrollY - navH;
    glideTo(Math.max(0, y));
    history.pushState(null, '', `#${id}`);
  });
}

/* ───────── Live Bangalore clock ───────── */
const clockEl = document.querySelector('.clock');
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
function tickClock() {
  clockEl.dataset.text = `Bangalore · ${timeFmt.format(new Date())} IST`;
  if (!clockEl._raf) clockEl.textContent = clockEl.dataset.text;
}
tickClock();
setInterval(tickClock, 15000);

/* ───────── Pointer, shared with the hero scene ───────── */
const pointer = { x: 0, y: 0, nx: 0, ny: 0, active: false };
hero.addEventListener('pointermove', (e) => {
  const r = hero.getBoundingClientRect();
  pointer.x = e.clientX - r.left;
  pointer.y = e.clientY - r.top;
  pointer.nx = (pointer.x / r.width) * 2 - 1;
  pointer.ny = -(pointer.y / r.height) * 2 + 1;
  pointer.active = true;
});
hero.addEventListener('pointerleave', () => { pointer.active = false; });

/* ───────── Hero: photo + glass "hello" + fluid (see hero.js) ───────── */
startHero({
  canvas, hero, pointer,
  onReady() {
    hero.classList.add('is-ready');
    document.body.classList.add('is-ready');
    scrambleEls.filter((el) => hero.contains(el) || topBar.contains(el))
      .forEach((el, i) => setTimeout(() => scramble(el, 700), 400 + i * 40));
  },
});

/* ───────── Selected work: hover reveal, as on pxpush.com/journal ─────────
   Each row owns a card (built from its <template>). While hovered it is moved every frame:
     x = −2vw + (|mouseX − rowLeft| − cardW/2) / 5     → stays in the first column, drifts a little
     y = |mouseY − rowTop| − cardH/2                   → centred on the cursor's height
     rotation  = horizontal mouse speed (0–100px/frame) mapped onto ±60° over 0–175, its sign
                 set by the direction of travel and whether the row is in the top or bottom half
     brightness = speed mapped 1 → 8
   all eased toward their targets by 8% a frame (the wobble). The values are shared between
   rows, so the motion carries over as the cursor crosses from one row to the next. */
if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mouse = { x: 0, y: 0 };
  let prev = { x: 0, y: 0 };
  addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  const lerp = (a, b, n) => a + (b - a) * n;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const map = (v, a, b, c, d) => c + ((v - a) * (d - c)) / (b - a);
  const anim = { tx: 0, ty: 0, rot: 0, bri: 1 };

  // rows with a case study get a "View project" pill that stands in for the cursor
  const cta = document.createElement('div');
  cta.className = 'view-cta mono';
  cta.setAttribute('aria-hidden', 'true');
  cta.innerHTML = '<span class="view-cta__dot">↗</span><span class="view-cta__label">View project</span>';
  document.body.appendChild(cta);
  const ctaPos = { x: 0, y: 0 };

  document.querySelectorAll('.wl-row').forEach((row) => {
    const tpl = row.querySelector('template.wl-cover');
    if (!tpl) return;
    const reveal = document.createElement('div');
    reveal.className = 'hover-reveal';
    reveal.setAttribute('aria-hidden', 'true');
    reveal.innerHTML = '<div class="hover-reveal__inner"><div class="hover-reveal__img"></div></div>';
    reveal.querySelector('.hover-reveal__img').appendChild(tpl.content.cloneNode(true));
    row.appendChild(reveal);

    const linked = row.querySelector('.wl-link.is-linked');
    let raf = null, first = true, area = 'down';
    const render = () => {
      const b = row.getBoundingClientRect();
      const rw = reveal.offsetWidth, rh = reveal.offsetHeight;
      if (first) area = b.top + b.height / 2 <= innerHeight / 2 ? 'up' : 'down';
      const dx = mouse.x - prev.x;
      const speed = clamp(Math.abs(dx), 0, 100);
      prev = { x: mouse.x, y: mouse.y };
      const tx = -innerWidth * 0.02 + (Math.abs(mouse.x - b.left) - rw / 2) / 5;
      const ty = Math.abs(mouse.y - b.top) - rh / 2;
      const swing = dx < 0 ? (area === 'up' ? 60 : -60) : (area === 'up' ? -60 : 60);
      const rot = first || still ? 0 : map(speed, 0, 175, 0, swing);
      const bri = first || still ? 1 : map(speed, 0, 100, 1, 8);
      if (first) { Object.assign(anim, { tx, ty, rot, bri }); first = false; }
      else {
        anim.tx = lerp(anim.tx, tx, 0.08); anim.ty = lerp(anim.ty, ty, 0.08);
        anim.rot = lerp(anim.rot, rot, 0.08); anim.bri = lerp(anim.bri, bri, 0.08);
      }
      reveal.style.transform = `translate(${anim.tx.toFixed(2)}px, ${anim.ty.toFixed(2)}px) rotate(${anim.rot.toFixed(2)}deg)`;
      reveal.style.filter = `brightness(${anim.bri.toFixed(3)})`;
      if (linked) {
        ctaPos.x = lerp(ctaPos.x, mouse.x, still ? 1 : 0.35); ctaPos.y = lerp(ctaPos.y, mouse.y, still ? 1 : 0.35);
        cta.style.transform = `translate(${ctaPos.x.toFixed(1)}px, ${ctaPos.y.toFixed(1)}px)`;
      }
      raf = requestAnimationFrame(render);
    };
    const enter = () => {
      first = true; prev = { x: mouse.x, y: mouse.y };
      row.classList.add('is-hover');
      reveal.classList.add('is-on');
      if (linked) {
        Object.assign(ctaPos, mouse);
        cta.style.transform = `translate(${mouse.x}px, ${mouse.y}px)`;
        cta.classList.add('is-on');
      }
      if (!raf) raf = requestAnimationFrame(render);
    };
    const leave = () => {
      row.classList.remove('is-hover');
      reveal.classList.remove('is-on');
      if (linked) cta.classList.remove('is-on');
      cancelAnimationFrame(raf); raf = null;
    };
    row.addEventListener('mouseenter', enter);
    row.addEventListener('mouseleave', leave);
    row.addEventListener('click', leave);
  });
}

// scramble labels in the work section the first time they scroll into view
const revealIO = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    scramble(e.target, 650);
    revealIO.unobserve(e.target);
  });
}, { threshold: 0.6 });
document.querySelectorAll('.work [data-scramble]').forEach((el) => revealIO.observe(el));

/* ───────── About: collage layers drift apart a little with the pointer ───────── */
const collage = document.querySelector('.about__collage');
if (collage && matchMedia('(hover: hover) and (pointer: fine)').matches) {
  const media = collage.closest('.about__media');
  media.addEventListener('pointermove', (e) => {
    const r = collage.getBoundingClientRect();
    collage.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    collage.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  });
  media.addEventListener('pointerleave', () => { collage.style.setProperty('--mx', 0); collage.style.setProperty('--my', 0); });
}

/* ───────── About: the portrait grows and turns with the scroll ─────────
   Two phases, both tied 1:1 to the scroll (no easing):
   1. as the section rises (one viewport of scroll, like the old site):
      scale 0.7 → 1.05, rotation −12° → −2°
   2. from there until Selected Work arrives (its top at mid-screen):
      keeps growing to ~1.2 and slowly turns on to +6°
   On narrow screens the text sits under the photo, so phase 2 grows less. */
const aboutMedia = document.querySelector('.about__media');
if (aboutMedia && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const aboutSec = aboutMedia.closest('.about');
  const workSec = document.querySelector('.work');
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  let queued = false;
  const update = () => {
    queued = false;
    const vh = innerHeight;
    const aboutTop = aboutSec.getBoundingClientRect().top;
    const p1 = clamp01((vh * 1.05 - aboutTop) / vh);
    // phase 2 runs from where phase 1 ends (about top at 5% of the screen) until the work
    // section's top reaches mid-screen
    const workTop = workSec.getBoundingClientRect().top;
    const span = Math.max(1, (workTop - aboutTop) + vh * 0.05 - vh * 0.5);
    const p2 = clamp01((vh * 0.05 - aboutTop) / span);
    const extra = innerWidth > 900 ? 0.15 : 0.06;
    aboutMedia.style.setProperty('--grow', (0.7 + 0.35 * p1 + extra * p2).toFixed(4));
    aboutMedia.style.setProperty('--tilt', `${(-12 + 10 * p1 + 8 * p2).toFixed(3)}deg`);
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener('resize', update);
  update();
}

/* ───────── About: sticker-style jitter on the collage layers ─────────
   Like a stop-motion "boil": each layer flips between two tilts about ±0.4° apart with a
   little noise, ~4 frames a second, each on its own beat. Only runs while on screen. */
if (collage && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const layers = [...collage.querySelectorAll('.layer')].map((el, i) => ({ el, flip: i % 2 === 0, base: [0, 0.3, -0.25][i] ?? 0 }));
  let timer = null;
  const tick = () => {
    for (const l of layers) {
      if (Math.random() < 0.15) continue;   // the odd held frame keeps it from feeling mechanical
      l.flip = !l.flip;
      const deg = l.base + (l.flip ? 0.4 : -0.4) + (Math.random() - 0.5) * 0.2;
      l.el.style.setProperty('--jit', `${deg.toFixed(2)}deg`);
    }
  };
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !timer) timer = setInterval(tick, 230);
    else if (!e.isIntersecting && timer) { clearInterval(timer); timer = null; }
  }).observe(collage);
}

/* ───────── About: reveal once on the way in ───────── */
const about = document.querySelector('.about');
new IntersectionObserver(([e], io) => {
  if (!e.isIntersecting) return;
  about.classList.add('is-in');
  io.disconnect();
}, { threshold: 0.25 }).observe(about);

/* ───────── Contact: "Let's [face] Talk" comes together once, on the way in ───────── */
const contact = document.querySelector('.contact');


// the face drifts a little with the pointer, like the About collage
const stage = contact.querySelector('.contact__stage');
if (matchMedia('(hover: hover) and (pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  contact.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect();
    stage.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    stage.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  });
  contact.addEventListener('pointerleave', () => { stage.style.setProperty('--mx', 0); stage.style.setProperty('--my', 0); });
}

// touch screens have no hover, so a tap flips between the two frames of the face
const face = contact.querySelector('.contact__face');
if (!matchMedia('(hover: hover) and (pointer: fine)').matches) {
  face.addEventListener('click', () => face.classList.toggle('is-alt'));
}

/* ───────── Contact: slowly flowing folds, stirred by the pointer like the hero ───────── */
const fluid = startFooterPaper({ host: contact.querySelector('.contact__bg'), events: contact });

/* ───────── Contact: revealed from under the page ─────────
   The footer is fixed to the bottom of the screen; the page above scrolls up off it over a
   spacer of the same height. It is clipped to the area below the page's bottom edge, with
   that edge's two bottom corners rounded, so the page reads as a sheet lifting away. */
{
  const page = document.querySelector('main');
  const R = 44;   // corner radius of the lifting edge
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const navH = () => document.querySelector('.bar--top')?.offsetHeight || 0;

  /* the envelope, as a function of how much of the footer is uncovered (p, 0..1):
       .02  – .40  it comes in from below the frame into the middle of what's uncovered,
                   turning −90° → 0° and growing, with everything inside carried along; after
                   that it stays centred in the visible area as the page lifts
       .45  – .57  the flap ("Liked my work?") opens; .55 – .75 the envelope swells as it empties
       .55  – .90  the contents fall out one after another (blue sheet, sketch sheet, blue
                   sheet, burst, the face last): each leaves from where the envelope holds it,
                   at the envelope's angle and size, and arcs to its own spot and angle
       .84  – .99  the empty envelope drops away; the stickers land on the face */
  const face = contact.querySelector('.contact__face');
  const stickers = [...face.querySelectorAll('.el')].filter((el) => !el.matches('.el--burst'))
    .map((el) => ({ el, at: +getComputedStyle(el).getPropertyValue('--at') || 0 }));
  const spill = [
    { sel: '.paper--blue1', from: 0.55, slot: -0.06, tilt: -4 },
    { sel: '.paper--sheet', from: 0.6, slot: -0.02, tilt: 3 },
    { sel: '.paper--blue2', from: 0.65, slot: 0.02, tilt: -2 },
    { sel: '.el--burst', from: 0.7, slot: -0.04, tilt: 6 },
    { sel: '.contact__face-base, .contact__face-alt', from: 0.74, slot: 0, tilt: 0 },
  ].map((s) => ({ ...s, els: [...face.querySelectorAll(s.sel)] }));
  const all = spill.flatMap((s) => s.els.map((el) => ({ el, s })));
  all.forEach(({ el }) => el.classList.add('spill'));
  // natural resting box and angle of every piece, in face-box px (JS drives their transform)
  const rest = new Map();
  function measureSpill() {
    for (const { el } of all) {
      el.style.transform = 'none'; el.style.rotate = '';
      const own = parseFloat(getComputedStyle(el).rotate) || 0;
      el.style.rotate = 'none';
      rest.set(el, { L: el.offsetLeft, T: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, own });
    }
    envelope(lastP);
  }
  const span = (p, a, b) => Math.min(1, Math.max(0, (p - a) / (b - a)));
  const smooth = (x) => x * x * (3 - 2 * x);
  const outCubic = (x) => 1 - Math.pow(1 - x, 3);
  const lerp = (a, b, t) => a + (b - a) * t;
  const back = (x) => { const c = 1.9; return x <= 0 ? 0 : 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };   // overshoot
  let lastP = 0;
  function envelope(p) {
    lastP = p;
    const W = face.offsetWidth, H = face.offsetHeight;
    const cx = W * 0.5, cy = H * 0.534;                         // the envelope's centre at rest
    const envH = W * 1.54 / 1.55;
    // enter from below the frame into the middle of the uncovered strip, turning and growing,
    // then stay centred in the visible area as the page lifts (reaching the true centre at the
    // end); swell while emptying; drop away once empty
    const fromTop = face.getBoundingClientRect().top - contact.getBoundingClientRect().top;   // face box, in footer px
    const Hf = contact.offsetHeight;
    const stripMid = ((1 - p) * Hf + Hf) / 2 - fromTop;          // middle of what's visible, in face px
    const follow = Math.max(0, stripMid - cy);
    const startY = Hf - (fromTop + cy) + envH * 0.45;            // just below the bottom edge
    const arrive = smooth(span(p, 0.02, 0.35));
    const drop = smooth(span(p, 0.86, 0.98));
    const ex = 0, ey = lerp(startY, follow, arrive) + drop * envH * 0.95;
    const erot = -90 * (1 - smooth(span(p, 0.02, 0.4))) + drop * 7;
    const es = lerp(0.62, 1, smooth(span(p, 0.02, 0.5))) + 0.12 * smooth(span(p, 0.55, 0.75)) - 0.12 * drop;
    const flap = smooth(span(p, 0.45, 0.57));
    face.style.setProperty('--ex', `${ex.toFixed(1)}px`);
    face.style.setProperty('--ey', `${ey.toFixed(1)}px`);
    face.style.setProperty('--erot', erot.toFixed(2));
    face.style.setProperty('--es', es.toFixed(4));
    face.style.setProperty('--flap', flap.toFixed(4));
    face.style.setProperty('--drop', drop.toFixed(4));
    face.classList.toggle('flap-open', flap > 0.5);
    const rad = (erot * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    for (const { el, s } of all) {
      const r = rest.get(el);
      if (!r) continue;
      const k = outCubic(span(p, s.from, s.from + 0.16));
      // held: in a slot inside the envelope, carried by its position, angle and size
      const sx = 0, sy = s.slot * envH * es;
      const hx = cx + ex + (sx * cos - sy * sin), hy = cy + ey + (sx * sin + sy * cos);
      const ox = r.L + r.w / 2, oy = r.T + r.h / 2;
      const px = lerp(hx, ox, k), py = lerp(hy, oy, k) - Math.sin(k * Math.PI) * H * 0.08;   // a little arc as it falls out
      const ang = lerp(erot + s.tilt, r.own, k), sc = lerp(es * 0.38, 1, k);
      el.style.transform = `translate(${(px - r.L).toFixed(1)}px, ${(py - r.T).toFixed(1)}px) rotate(${ang.toFixed(2)}deg) scale(${sc.toFixed(4)}) translate(${(-r.w / 2).toFixed(1)}px, ${(-r.h / 2).toFixed(1)}px)`;
    }
    for (const { el, at } of stickers) {
      el.style.setProperty('--s', back(span(p, 0.84 + (at - 1) * 0.015, 0.88 + (at - 1) * 0.015)).toFixed(4));
    }
  }
  measureSpill();
  new ResizeObserver(measureSpill).observe(face);
  addEventListener('resize', measureSpill);
  face.querySelectorAll('.letter img').forEach((img) => img.complete || img.addEventListener('load', measureSpill, { once: true }));


  const update = () => {
    const H = contact.offsetHeight, W = contact.offsetWidth;
    const footTop = innerHeight - H;
    const t = Math.min(Math.max(page.getBoundingClientRect().bottom - footTop, 0), H);   // edge, in footer px
    const shown = t < H - 1;
    contact.classList.toggle('is-shown', shown);
    if (shown) {
      const r = Math.min(R, t);
      contact.style.clipPath = t <= 0 ? 'none'
        : `path('M0 ${t - r} A${r} ${r} 0 0 0 ${r} ${t} L${W - r} ${t} A${r} ${r} 0 0 0 ${W} ${t - r} L${W} ${H} L0 ${H} Z')`;
    }
    fluid?.setActive(shown);
    document.body.classList.toggle('on-paper', t < navH());   // the paper is under the nav
    envelope(reduce ? 1 : 1 - t / H);
    // "Let's ... Talk" comes in once the collage has settled
    if (!contact.classList.contains('is-in') && (reduce || 1 - t / H > 0.93)) {
      contact.classList.add('is-in');
      contact.querySelectorAll('[data-scramble]').forEach((el) => scramble(el, 650));
    }
  };
  // scroll events already arrive at most once a frame, so update straight from them
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  update();
}
