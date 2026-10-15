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
  { w: 150, h: 96, draw(ctx) {   // SHIP IT!
    const p = new Path2D('M14 22 C8 12 26 6 40 10 C60 2 88 4 108 8 C128 4 146 14 140 30 C148 46 142 62 136 74 C140 90 118 92 100 88 C80 94 52 92 34 88 C14 92 4 78 10 64 C2 50 6 34 14 22Z');
    dieCut(ctx, p);
    ctx.fillStyle = '#8be04e'; ctx.fill(p);
    ctx.save(); ctx.translate(75, 48); ctx.rotate(-0.1);
    display(ctx, 900, 30, 'expanded', true);
    ctx.fillStyle = '#164d12'; ctx.textAlign = 'center';
    ctx.fillText('SHIP', 0, -3); ctx.fillText('IT!', 3, 27);
    ctx.restore();
  } },
  { w: 80, h: 110, draw(ctx) {    // bolt
    const p = new Path2D('M48 6 L10 62 L36 62 L28 104 L70 42 L44 42 Z');
    dieCut(ctx, p);
    ctx.fillStyle = ctx.strokeStyle = '#6ec1ff'; ctx.lineWidth = 5; ctx.lineJoin = 'round';
    ctx.fill(p); ctx.stroke(p);
    ctx.fillStyle = '#bfe4ff'; ctx.fill(new Path2D('M44 14 L18 56 L30 56 Z'));
  } },
  { w: 110, h: 90, draw(ctx) {    // pen nib
    const p = new Path2D('M8 46 L40 12 L102 30 L92 54 L56 82 Z');
    dieCut(ctx, p);
    ctx.fillStyle = '#eef0f6'; ctx.strokeStyle = '#14163a'; ctx.lineWidth = 5; ctx.lineJoin = 'round';
    ctx.fill(p); ctx.stroke(p);
    ctx.fillStyle = '#c9cde0'; ctx.fill(new Path2D('M62 26 L98 36 L90 50 Z'));
    ctx.lineCap = 'round'; ctx.stroke(new Path2D('M8 46 L44 48'));
    ctx.fillStyle = '#14163a'; ctx.beginPath(); ctx.arc(50, 46, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#eef0f6'; ctx.beginPath(); ctx.arc(50, 46, 3.5, 0, Math.PI * 2); ctx.fill();
  } },
  { w: 120, h: 116, draw(ctx) {   // smiley star
    const p = new Path2D('M60.0 12.0 L74.1 42.6 L107.6 46.5 L82.8 69.4 L89.4 102.5 L60.0 86.0 L30.6 102.5 L37.2 69.4 L12.4 46.5 L45.9 42.6Z');
    dieCut(ctx, p);
    ctx.fillStyle = ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 8; ctx.lineJoin = 'round';
    ctx.fill(p); ctx.stroke(p);
    ctx.fillStyle = '#1b1b1b';
    for (const x of [49, 70]) { ctx.beginPath(); ctx.ellipse(x, 58, 4, 9, 0.49, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.stroke(new Path2D('M50 74 Q60 80 70 74'));
  } },
  { w: 110, h: 110, draw(ctx) {   // ₹ coin
    const p = new Path2D(); p.arc(55, 55, 46, 0, Math.PI * 2);
    dieCut(ctx, p);
    ctx.fillStyle = '#ffb020'; ctx.fill(p);
    ctx.save(); ctx.setLineDash([2, 5]); ctx.strokeStyle = '#e08a00'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(55, 55, 36, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    ctx.strokeStyle = '#7a3d00'; ctx.lineWidth = 7; ctx.lineCap = ctx.lineJoin = 'round';
    ctx.stroke(new Path2D('M40 34 H70 M40 46 H70 M40 34 H50 A12 12 0 0 1 50 58 H42 L68 82'));
    ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 5;
    ctx.stroke(new Path2D('M26 40 A32 32 0 0 1 48 22'));
  } },
  { w: 150, h: 70, draw(ctx) {    // +61% pill
    const p = new Path2D(); p.roundRect(6, 8, 138, 54, 27);
    dieCut(ctx, p);
    ctx.fillStyle = '#ff4fa3'; ctx.fill(p);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5; ctx.lineCap = ctx.lineJoin = 'round';
    ctx.stroke(new Path2D('M28 46 L28 24 M20 32 L28 24 L36 32'));
    display(ctx, 900, 30, 'semi-expanded');
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.fillText('+61%', 90, 47);
  } },
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

/** Draws every sticker into one canvas. Returns the canvas, per-sticker UV rects
 *  (x, y, w, h in texture space, y up) and aspect ratios. */
export async function buildStickerAtlas() {
  try { await document.fonts.load('italic 900 30px Archivo'); await document.fonts.load('700 9px "JetBrains Mono"'); } catch {}
  const cols = 4;
  const cellW = Math.max(...STICKERS.map((s) => s.w)) + PAD * 2;
  const cellH = Math.max(...STICKERS.map((s) => s.h)) + PAD * 2;
  const rows = Math.ceil(STICKERS.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * cellW * S;
  canvas.height = rows * cellH * S;
  const ctx = canvas.getContext('2d');
  const rects = [], aspects = [];
  STICKERS.forEach((s, i) => {
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
