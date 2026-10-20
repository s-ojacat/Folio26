// Die-cut sticker artwork, drawn onto one canvas atlas so the hero scene can rain them
// down as textured cards. Each sticker is described in its own little viewBox.
const S = 3;     // render scale (crisp at large sizes)
const PAD = 16;  // room for the white border + shadow, in viewBox units

function dieCut(ctx, shape) {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
  ctx.shadowBlur = 9 * S;
  ctx.shadowOffsetY = 4 * S;
  ctx.fillStyle = ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 14;
  ctx.lineJoin = 'round';
  ctx.stroke(shape);
  ctx.fill(shape);
  ctx.restore();
}
const display = (ctx, weight, size, stretch = 'expanded', italic = false) => {
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px Archivo, "Arial Black", sans-serif`;
  if ('fontStretch' in ctx) ctx.fontStretch = stretch;
};

const STICKERS = [
  { w: 120, h: 120, draw(ctx) {   // NIFT AIR 18 badge
    const p = new Path2D(); p.arc(60, 60, 52, 0, Math.PI * 2);
    dieCut(ctx, p);
    ctx.fillStyle = '#f6f4ee'; ctx.fill(p);
    ctx.fillStyle = '#2b3cff'; ctx.beginPath(); ctx.arc(60, 60, 27, 0, Math.PI * 2); ctx.fill();
    const ring = 'NIFT DELHI · ALL INDIA RANK · ';
    ctx.font = '700 9px "JetBrains Mono", monospace'; ctx.fillStyle = '#14163a'; ctx.textAlign = 'center';
    for (let i = 0; i < ring.length; i++) {
      const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
      ctx.save(); ctx.translate(60 + Math.cos(a) * 39, 60 + Math.sin(a) * 39); ctx.rotate(a + Math.PI / 2);
      ctx.fillText(ring[i], 0, 3); ctx.restore();
    }
    display(ctx, 900, 30); ctx.fillStyle = '#ffffff'; ctx.fillText('18', 60, 71);
  } },
  { w: 110, h: 110, draw(ctx) {   // grin
    const p = new Path2D(); p.arc(55, 55, 44, 0, Math.PI * 2);
    dieCut(ctx, p);
    ctx.fillStyle = '#ff7ab8'; ctx.fill(p);
    ctx.fillStyle = '#1b1b1b';
    ctx.beginPath(); ctx.roundRect(28, 38, 24, 14, 6); ctx.roundRect(58, 38, 24, 14, 6); ctx.fill();
    ctx.fillRect(50, 42, 10, 4);
    ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
    ctx.stroke(new Path2D('M36 68 Q55 84 74 68'));
    ctx.fillStyle = '#ffc2dc'; ctx.beginPath(); ctx.ellipse(34, 30, 7, 4, -0.6, 0, Math.PI * 2); ctx.fill();
  } },
];

// Saksham's own paintings, already die-cut with a white border; drawn into the atlas as
// images with the same soft shadow. Sizes are in the same viewBox units (long side ≈ 150).
const PAINTED = [
  ['assets/stickers/eye.webp', 480, 462],
  ['assets/stickers/brain.webp', 480, 392],
  ['assets/stickers/cat.webp', 480, 454],
  ['assets/stickers/fish.webp', 480, 417],
  ['assets/stickers/scream.webp', 477, 480],
  ['assets/stickers/toucan.webp', 480, 455],
];
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);   // a missing file just leaves that sticker out
    img.src = src;
  });
}
async function paintedStickers() {
  const imgs = await Promise.all(PAINTED.map(([src]) => loadImage(src)));
  return imgs.flatMap((img, i) => {
    if (!img) return [];
    const [, iw, ih] = PAINTED[i], k = 150 / Math.max(iw, ih);
    const w = Math.round(iw * k), h = Math.round(ih * k);
    return [{ w, h, draw(ctx) {
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
      ctx.shadowBlur = 9 * S;
      ctx.shadowOffsetY = 4 * S;
      ctx.drawImage(img, 0, 0, w, h);
      ctx.restore();
    } }];
  });
}

/** Draws every sticker into one canvas. Returns the canvas, per-sticker UV rects
 *  (x, y, w, h in texture space, y up) and aspect ratios. */
export async function buildStickerAtlas() {
  try { await document.fonts.load('italic 900 30px Archivo'); await document.fonts.load('700 9px "JetBrains Mono"'); } catch {}
  const all = [...STICKERS, ...(await paintedStickers())];
  const cols = 4;
  const cellW = Math.max(...all.map((s) => s.w)) + PAD * 2;
  const cellH = Math.max(...all.map((s) => s.h)) + PAD * 2;
  const rows = Math.ceil(all.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * cellW * S;
  canvas.height = rows * cellH * S;
  const ctx = canvas.getContext('2d');
  const rects = [], aspects = [];
  all.forEach((s, i) => {
    const cx = (i % cols) * cellW, cy = Math.floor(i / cols) * cellH;
    const w = s.w + PAD * 2, h = s.h + PAD * 2;
    ctx.save();
    ctx.scale(S, S);
    ctx.translate(cx + PAD, cy + PAD);
    s.draw(ctx);
    ctx.restore();
    rects.push([cx / (cols * cellW), 1 - (cy + h) / (rows * cellH), w / (cols * cellW), h / (rows * cellH)]);
    aspects.push(w / h);
  });
  return { canvas, rects, aspects };
}
