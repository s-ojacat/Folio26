// Shared by the hero scene: the colour set (one look now), and the glint sprite used on
// the glass.
import * as THREE from 'three';

export const THEMES = [
  { name: 'ink', color: '#0f1fe0', sheen: '#3346ff', emissive: '#050f8a', accent: '#7dffb0', glassA: '#ffd9ec', glassB: '#f4ecff', sheenA: '#ff7ab8', sheenB: '#ffb27a' },
];

export function currentTheme() {
  return THEMES.find((t) => t.name === document.documentElement.dataset.theme) ?? THEMES[0];
}


/* four-point glint sprite used on both layers */
export function sparkleTexture() {
  const s = 128, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const glow = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.12, 'rgba(255,255,255,.55)');
  glow.addColorStop(0.4, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  const m = s / 2, L = s * 0.48, W = s * 0.035;
  ctx.moveTo(m, m - L); ctx.quadraticCurveTo(m + W, m - W, m + L, m);
  ctx.quadraticCurveTo(m + W, m + W, m, m + L); ctx.quadraticCurveTo(m - W, m + W, m - L, m);
  ctx.quadraticCurveTo(m - W, m - W, m, m - L);
  ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
