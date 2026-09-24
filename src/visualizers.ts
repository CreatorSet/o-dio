import type { Engine } from "./audio";
import { drawCaptions, type CaptionStyle, type Transcribe } from "./captions";

export type Palette = { name: string; bg: [string, string]; fg: string[]; text: string };

export const PALETTES: Palette[] = [
  { name: "Neon", bg: ["#0b0b1a", "#1a0b2e"], fg: ["#ff2d95", "#7b2dff", "#2dfcff"], text: "#ffffff" },
  { name: "Sunset", bg: ["#1a0a05", "#3d0f0f"], fg: ["#ff6a00", "#ffcc00", "#ff2e63"], text: "#fff4e0" },
  { name: "Mint", bg: ["#04120f", "#0a2a22"], fg: ["#2dffb4", "#00d4ff", "#b6ffdd"], text: "#e8fff6" },
  { name: "Mono", bg: ["#000000", "#161616"], fg: ["#ffffff", "#bdbdbd", "#7a7a7a"], text: "#ffffff" },
  { name: "Gold", bg: ["#0d0a02", "#2a1e06"], fg: ["#ffd700", "#ff9d00", "#fff2b0"], text: "#fff8dc" },
];

export type StyleId = "xp" | "radial" | "wave" | "orb" | "bars" | "rings" | "dots" | "scope";
export const STYLES: { id: StyleId; label: string }[] = [
  { id: "xp", label: "XP" },
  { id: "radial", label: "Radial" },
  { id: "wave", label: "Wave" },
  { id: "orb", label: "Orb" },
  { id: "bars", label: "Bars" },
  { id: "rings", label: "Rings" },
  { id: "dots", label: "Dots" },
  { id: "scope", label: "Scope" },
];

export type Scene = {
  style: StyleId;
  palette: Palette;
  title: string;
  artist: string;
  cover: HTMLImageElement | null;
  /** Round avatar next to the artist name. */
  artistPhoto: HTMLImageElement | null;
  /** Optional photo behind everything, drawn cover-fit and dimmed by `bgDim` (0..1). */
  background: HTMLImageElement | null;
  bgDim: number;
  watermark: boolean;
  captions: Transcribe | null;
  captionStyle: CaptionStyle;
  /** Playback position in seconds, set by the app each frame. */
  time: number;
};

type Particle = { a: number; r: number; v: number; s: number };
const particles: Particle[] = [];
const peaks: number[] = [];
let smoothLevel = 0;
// life: bass envelope, kick onset, and a field of slow dust that drifts with the level
let bassEnv = 0, prevBass = 0, kickEnv = 0;
type Dust = { x: number; y: number; r: number; v: number; a: number; d: number };
const dust: Dust[] = [];
// per-band envelope followers: fast attack, slow release, so bars breathe instead of flicker
const env = new Map<number, Float32Array>();
function smoothBands(eng: Engine | null, n: number, attack = 0.5, release = 0.08) {
  const raw = eng ? eng.bands(n) : new Float32Array(n);
  let e = env.get(n);
  if (!e) { e = new Float32Array(n); env.set(n, e); }
  for (let i = 0; i < n; i++) e[i] += (raw[i] - e[i]) * (raw[i] > e[i] ? attack : release);
  return e;
}
const ringHist: Float32Array[] = [];

function alive(ctx: CanvasRenderingContext2D, eng: Engine | null, p: Palette, w: number, h: number, t: number) {
  const b = eng ? eng.bands(12) : new Float32Array(12);
  const bass = (b[1] + b[2] + b[3]) / 3;
  bassEnv += (bass - bassEnv) * 0.25;
  kickEnv = Math.max(kickEnv * 0.86, Math.max(0, bass - prevBass) * 3);
  prevBass = bass;
  const short = Math.min(w, h);
  // breathing glow behind everything
  const gx = w / 2 + Math.sin(t * 0.3) * w * 0.08, gy = h * 0.46 + Math.cos(t * 0.23) * h * 0.05;
  const gr = short * (0.35 + bassEnv * 0.35 + kickEnv * 0.1);
  const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
  g.addColorStop(0, p.fg[0]);
  g.addColorStop(0.6, p.fg[1]);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = 0.12 + bassEnv * 0.28 + kickEnv * 0.15;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  // dust
  if (dust.length === 0) for (let i = 0; i < 70; i++) dust.push({ x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 2.2, v: 0.02 + Math.random() * 0.06, a: 0.15 + Math.random() * 0.35, d: Math.random() * Math.PI * 2 });
  ctx.fillStyle = p.fg[2];
  for (const q of dust) {
    q.y -= (q.v * (0.4 + smoothLevel * 2.5)) / 60;
    q.x += Math.sin(t * 0.5 + q.d) * 0.0004;
    if (q.y < -0.02) { q.y = 1.02; q.x = Math.random(); }
    ctx.globalAlpha = q.a * (0.5 + smoothLevel);
    ctx.beginPath();
    ctx.arc(q.x * w, q.y * h, q.r * (short / 900) * (1 + kickEnv), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // kick: the whole scene leans in
  const z = 1 + kickEnv * 0.035 + bassEnv * 0.01;
  ctx.translate(w / 2, h / 2);
  ctx.scale(z, z);
  ctx.rotate(Math.sin(t * 0.4) * 0.004);
  ctx.translate(-w / 2, -h / 2);
}

function gradient(ctx: CanvasRenderingContext2D, w: number, h: number, p: Palette) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, p.bg[0]);
  g.addColorStop(1, p.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Cover-fit photo behind the scene, dimmed so the visualizer still reads. */
function backdrop(ctx: CanvasRenderingContext2D, scene: Scene, w: number, h: number) {
  const img = scene.background;
  if (!img) return;
  const ar = img.width / img.height, car = w / h;
  const dw = ar > car ? h * ar : w, dh = ar > car ? h : w / ar;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(1, scene.bgDim))})`;
  ctx.fillRect(0, 0, w, h);
}

function fgGradient(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, p: Palette) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  p.fg.forEach((c, i) => g.addColorStop(i / (p.fg.length - 1), c));
  return g;
}

function roundedImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, s: number, r: number) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, s, s, r);
  ctx.closePath();
  ctx.clip();
  const ar = img.width / img.height;
  const dw = ar >= 1 ? s * ar : s, dh = ar >= 1 ? s : s / ar;
  ctx.drawImage(img, x + (s - dw) / 2, y + (s - dh) / 2, dw, dh);
  ctx.restore();
}

function text(ctx: CanvasRenderingContext2D, scene: Scene, w: number, h: number, y: number) {
  // sizes follow the short side so 16:9 and 9:16 get the same type scale; the block is clamped
  // above the watermark so the artist line never falls off the bottom
  const u = Math.min(w, h);
  const titleS = Math.round(u * 0.06), artistS = Math.round(u * 0.034), avatar = u * 0.05;
  const rows = (scene.title ? titleS : 0) + (scene.artist ? artistS * 1.7 : 0);
  y = Math.min(y, h - u * 0.09 - rows + (scene.title ? titleS : 0));
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = scene.palette.text;
  ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = u * 0.01;
  if (scene.title) {
    ctx.font = `700 ${titleS}px Inter, system-ui, sans-serif`;
    ctx.fillText(scene.title, w / 2, y);
  }
  if (scene.artist) {
    const ay = scene.title ? y + artistS * 1.7 : y;
    ctx.font = `500 ${artistS}px Inter, system-ui, sans-serif`;
    let tx = w / 2;
    if (scene.artistPhoto) {
      const tw = ctx.measureText(scene.artist).width;
      const gap = avatar * 0.3;
      const left = w / 2 - (avatar + gap + tw) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(left + avatar / 2, ay - artistS * 0.35, avatar / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      const img = scene.artistPhoto, ar = img.width / img.height;
      const dw = ar >= 1 ? avatar * ar : avatar, dh = ar >= 1 ? avatar : avatar / ar;
      ctx.drawImage(img, left + (avatar - dw) / 2, ay - artistS * 0.35 - avatar / 2 + (avatar - dh) / 2, dw, dh);
      ctx.restore();
      tx = left + avatar + gap + tw / 2;
    }
    ctx.globalAlpha = 0.85;
    ctx.fillText(scene.artist, tx, ay);
    ctx.globalAlpha = 1;
  }
  ctx.shadowBlur = 0; ctx.shadowColor = "transparent";
  if (scene.watermark) {
    ctx.globalAlpha = 0.5;
    ctx.textAlign = "right";
    ctx.font = `600 ${Math.round(u * 0.022)}px Inter, system-ui, sans-serif`;
    ctx.fillText("made with CreatorSet.ai", w - u * 0.03, h - u * 0.03);
    ctx.globalAlpha = 1;
  }
}

export function draw(ctx: CanvasRenderingContext2D, eng: Engine | null, scene: Scene, w: number, h: number, t: number) {
  const p = scene.palette;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  gradient(ctx, w, h, p);
  backdrop(ctx, scene, w, h);
  const lvl = eng ? eng.level() : 0;
  smoothLevel += (lvl - smoothLevel) * 0.2;
  const cx = w / 2;
  const short = Math.min(w, h);
  if (scene.style !== "xp") alive(ctx, eng, p, w, h, t);
  else { bassEnv = 0; kickEnv = 0; }

  if (scene.style === "xp") {
    // Windows Media Player "Bars", 2003: segmented spectrum, falling peak caps, a reflection.
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    backdrop(ctx, scene, w, h);
    const n = 40;
    const b = eng ? eng.bands(n) : new Float32Array(n);
    if (peaks.length !== n) { peaks.length = 0; for (let i = 0; i < n; i++) peaks.push(0); }
    const margin = w * 0.06;
    const gap = w * 0.008, bw = (w - margin * 2 - gap * (n - 1)) / n;
    // Layout top-down: title strip, cover (if any), bars + their reflection. Fits every aspect.
    const strip = h * 0.05;
    const coverS = scene.cover ? Math.min(short * 0.3, h * 0.28) : 0;
    const coverY = strip + h * 0.04;
    const top = scene.cover ? coverY + coverS + h * 0.05 : strip + h * 0.08;
    const bottom = h * 0.93;
    const maxH = Math.min(h * 0.4, (bottom - top) / 1.5);
    const base = top + maxH;
    const seg = Math.max(4, Math.round(maxH / 28)), segGap = Math.max(1, seg * 0.28);
    const g = ctx.createLinearGradient(0, base, 0, base - maxH);
    g.addColorStop(0, "#19c41a");
    g.addColorStop(0.55, "#d6e01c");
    g.addColorStop(0.8, "#ff8a00");
    g.addColorStop(1, "#ff1e1e");
    for (let i = 0; i < n; i++) {
      const v = Math.pow(b[i], 1.35);
      const bh = v * maxH;
      const x = margin + i * (bw + gap);
      ctx.fillStyle = g;
      for (let y = 0; y < bh; y += seg) {
        const sh = Math.min(seg - segGap, bh - y);
        ctx.fillRect(x, base - y - sh, bw, sh);
      }
      // reflection
      ctx.globalAlpha = 0.18;
      for (let y = 0; y < bh * 0.5; y += seg) {
        const sh = Math.min(seg - segGap, bh * 0.5 - y);
        ctx.fillRect(x, base + y + segGap * 2, bw, sh);
      }
      ctx.globalAlpha = 1;
      // peak cap: sits on the top, falls slowly
      peaks[i] = Math.max(bh, peaks[i] - maxH * 0.012);
      if (peaks[i] > 1) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, base - peaks[i] - seg * 0.7, bw, Math.max(2, seg * 0.3));
      }
    }
    // XP Luna strip at the top, the title lives in it
    const lg = ctx.createLinearGradient(0, 0, 0, strip);
    lg.addColorStop(0, "#3d95ff");
    lg.addColorStop(0.5, "#0a5fd6");
    lg.addColorStop(1, "#063f9e");
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, w, strip);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.font = `700 ${Math.round(strip * 0.5)}px Tahoma, Verdana, system-ui, sans-serif`;
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 4; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
    ctx.fillText(`${scene.title || "CreatorSet.ai"}${scene.artist ? " - " + scene.artist : ""} - Windows Media Player`, strip * 0.4, strip * 0.66);
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    if (scene.cover) roundedImage(ctx, scene.cover, cx - coverS / 2, coverY, coverS, 6);
    if (scene.watermark) {
      ctx.globalAlpha = 0.5;
      ctx.textAlign = "right";
      ctx.fillStyle = "#fff";
      ctx.font = `600 ${Math.round(w * 0.022)}px Tahoma, Verdana, system-ui, sans-serif`;
      ctx.fillText("made with CreatorSet.ai", w - w * 0.03, h - w * 0.03);
      ctx.globalAlpha = 1;
    }
    drawCaptions(ctx, scene.captions, scene.captionStyle, scene.time, w, h, scene.palette);
  }

  if (scene.style === "radial") {
    const n = 96;
    const b = eng ? eng.bands(n) : new Float32Array(n);
    const cy = h * 0.46;
    const r0 = short * 0.19 * (1 + bassEnv * 0.16 + kickEnv * 0.08);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.05);
    ctx.strokeStyle = fgGradient(ctx, -short / 2, 0, short / 2, 0, p);
    ctx.lineWidth = Math.max(2, (2 * Math.PI * r0) / n * 0.55);
    ctx.lineCap = "round";
    ctx.shadowColor = p.fg[0];
    ctx.shadowBlur = short * (0.01 + kickEnv * 0.03);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const len = r0 * 0.12 + Math.pow(b[i], 1.3) * short * 0.22;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * (r0 + len), Math.sin(a) * (r0 + len));
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.restore();
    if (scene.cover) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r0 * 0.9, 0, Math.PI * 2);
      ctx.clip();
      const s = r0 * 1.8;
      const ar = scene.cover.width / scene.cover.height;
      const dw = ar >= 1 ? s * ar : s, dh = ar >= 1 ? s : s / ar;
      ctx.drawImage(scene.cover, cx - dw / 2, cy - dh / 2, dw, dh);
      ctx.restore();
    } else {
      ctx.fillStyle = p.fg[0];
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(cx, cy, r0 * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    text(ctx, scene, w, h, cy + r0 + short * 0.3);
    drawCaptions(ctx, scene.captions, scene.captionStyle, scene.time, w, h, scene.palette);
  }

  if (scene.style === "wave") {
    const pts = 256;
    const wv = eng ? eng.waveform(pts) : new Float32Array(pts);
    const cy = h * 0.5;
    const amp = h * 0.18;
    for (let layer = 2; layer >= 0; layer--) {
      ctx.beginPath();
      for (let i = 0; i < pts; i++) {
        const x = (i / (pts - 1)) * w;
        const y = cy + wv[i] * amp * (1 - layer * 0.25) + Math.sin(i * 0.08 + t * 2 + layer) * h * 0.006 * (layer + 1);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = p.fg[layer % p.fg.length];
      ctx.shadowColor = p.fg[layer % p.fg.length];
      ctx.shadowBlur = layer === 0 ? short * (0.012 + kickEnv * 0.03) : 0;
      ctx.lineWidth = Math.max(2, short * (0.012 - layer * 0.003));
      ctx.lineCap = "round";
      ctx.globalAlpha = 1 - layer * 0.3;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    if (scene.cover) {
      const s = short * 0.3;
      roundedImage(ctx, scene.cover, cx - s / 2, cy - amp - s - h * 0.06, s, s * 0.08);
    }
    text(ctx, scene, w, h, cy + amp + h * 0.1);
    drawCaptions(ctx, scene.captions, scene.captionStyle, scene.time, w, h, scene.palette);
  }

  if (scene.style === "orb") {
    const cy = h * 0.46;
    const r = short * 0.2 * (1 + bassEnv * 0.45 + kickEnv * 0.15);
    const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.6);
    g.addColorStop(0, p.fg[0]);
    g.addColorStop(0.5, p.fg[1]);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2);
    ctx.fill();
    const b = eng ? eng.bands(12) : new Float32Array(12);
    const kick = b[1] + b[2];
    if (kick > 0.9 && particles.length < 400) {
      for (let i = 0; i < 6; i++) particles.push({ a: Math.random() * Math.PI * 2, r: r, v: 2 + Math.random() * 6, s: 2 + Math.random() * 4 });
    }
    ctx.fillStyle = p.fg[2];
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.r += q.v * (short / 600);
      q.v *= 0.985;
      const life = 1 - (q.r - r) / (short * 0.6);
      if (life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = life;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(q.a) * q.r, cy + Math.sin(q.a) * q.r, q.s * (short / 1000), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (scene.cover) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
      ctx.clip();
      const s = r * 1.6;
      const ar = scene.cover.width / scene.cover.height;
      const dw = ar >= 1 ? s * ar : s, dh = ar >= 1 ? s : s / ar;
      ctx.drawImage(scene.cover, cx - dw / 2, cy - dh / 2, dw, dh);
      ctx.restore();
    }
    text(ctx, scene, w, h, cy + short * 0.42);
    drawCaptions(ctx, scene.captions, scene.captionStyle, scene.time, w, h, scene.palette);
  }

  if (scene.style === "bars") {
    // mirrored spectrum rising from a floor, gradient by height, soft glow
    const n = 64;
    const b = smoothBands(eng, n);
    const margin = w * 0.06, gap = w * 0.004;
    const bw = (w - margin * 2 - gap * (n - 1)) / n;
    const floor = h * 0.62, maxH = h * 0.42;
    const g = fgGradient(ctx, 0, floor, 0, floor - maxH, p);
    ctx.shadowColor = p.fg[0];
    ctx.shadowBlur = short * (0.01 + kickEnv * 0.02);
    for (let i = 0; i < n; i++) {
      const v = Math.pow(b[i], 1.2);
      const x = margin + i * (bw + gap);
      const bh = Math.max(bw * 0.4, v * maxH);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x, floor - bh, bw, bh, bw * 0.3);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    // reflection
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < n; i++) {
      const v = Math.pow(b[i], 1.2);
      const x = margin + i * (bw + gap);
      const bh = Math.max(bw * 0.4, v * maxH) * 0.5;
      ctx.fillStyle = p.fg[1];
      ctx.beginPath();
      ctx.roundRect(x, floor + h * 0.01, bw, bh, bw * 0.3);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (scene.cover) roundedImage(ctx, scene.cover, cx - short * 0.11, floor - maxH - short * 0.28, short * 0.22, short * 0.02);
    text(ctx, scene, w, h, floor + h * 0.22);
    drawCaptions(ctx, scene.captions, scene.captionStyle, scene.time, w, h, scene.palette);
  }

  if (scene.style === "rings") {
    // concentric rings: each frame the spectrum becomes a new inner ring and the old ones drift outward
    const n = 180;
    const b = smoothBands(eng, n, 0.6, 0.15);
    const cy = h * 0.46;
    ringHist.unshift(Float32Array.from(b));
    if (ringHist.length > 14) ringHist.pop();
    const r0 = short * 0.08 * (1 + bassEnv * 0.3);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.05);
    ctx.lineJoin = "round";
    for (let k = ringHist.length - 1; k >= 0; k--) {
      const ring = ringHist[k];
      const base = r0 + k * short * 0.028;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = base + Math.pow(ring[i % n], 1.4) * short * 0.13;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = p.fg[k % p.fg.length];
      ctx.globalAlpha = 1 - k / ringHist.length;
      ctx.lineWidth = Math.max(1.5, short * (0.006 - k * 0.0003));
      ctx.shadowColor = p.fg[k % p.fg.length];
      ctx.shadowBlur = k === 0 ? short * (0.015 + kickEnv * 0.03) : 0;
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    if (scene.cover) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r0 * 0.92, 0, Math.PI * 2);
      ctx.clip();
      const s0 = r0 * 2, ar = scene.cover.width / scene.cover.height;
      const dw = ar >= 1 ? s0 * ar : s0, dh = ar >= 1 ? s0 : s0 / ar;
      ctx.drawImage(scene.cover, cx - dw / 2, cy - dh / 2, dw, dh);
      ctx.restore();
    }
    text(ctx, scene, w, h, cy + short * 0.44);
    drawCaptions(ctx, scene.captions, scene.captionStyle, scene.time, w, h, scene.palette);
  }

  if (scene.style === "dots") {
    // a grid of dots; each column is a band, dots light up from the middle outward
    const cols = 32, rows = 15;
    const b = smoothBands(eng, cols, 0.6, 0.12);
    const gw = w * 0.86, gh = h * 0.6;
    const x0 = (w - gw) / 2, y0 = h * 0.12;
    const cw = gw / cols, rh = gh / rows;
    const rad = Math.min(cw, rh) * 0.32;
    const mid = (rows - 1) / 2;
    for (let i = 0; i < cols; i++) {
      const v = Math.pow(b[i], 1.1) * (mid + 0.5);
      for (let j = 0; j < rows; j++) {
        const d = Math.abs(j - mid);
        const lit = d < v;
        const edge = lit && d > v - 1;
        const x = x0 + cw * (i + 0.5), y = y0 + rh * (j + 0.5);
        ctx.beginPath();
        ctx.arc(x, y, rad * (lit ? 1 + kickEnv * 0.3 : 0.55), 0, Math.PI * 2);
        if (lit) {
          ctx.fillStyle = p.fg[Math.min(p.fg.length - 1, Math.floor((d / mid) * p.fg.length))];
          ctx.globalAlpha = edge ? 0.6 : 1;
          ctx.shadowColor = ctx.fillStyle as string;
          ctx.shadowBlur = short * 0.012;
        } else {
          ctx.fillStyle = p.fg[2];
          ctx.globalAlpha = 0.08;
          ctx.shadowBlur = 0;
        }
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    text(ctx, scene, w, h, y0 + gh + h * 0.12);
    drawCaptions(ctx, scene.captions, scene.captionStyle, scene.time, w, h, scene.palette);
  }

  if (scene.style === "scope") {
    // oscilloscope: phosphor grid, a bright trace with a soft afterglow, Lissajous-ish sway on bass
    const grid = short * 0.06;
    ctx.strokeStyle = p.fg[2];
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = (w / 2) % grid; x < w; x += grid) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = (h / 2) % grid; y < h; y += grid) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    ctx.globalAlpha = 1;
    const pts = 512;
    const wv = eng ? eng.waveform(pts) : new Float32Array(pts);
    const cy = h * 0.5, amp = h * 0.28 * (1 + bassEnv * 0.3);
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let i = 0; i < pts; i++) {
        const x = (i / (pts - 1)) * w;
        const y = cy + wv[i] * amp;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = pass === 0 ? p.fg[0] : "#ffffff";
      ctx.lineWidth = pass === 0 ? short * 0.012 : short * 0.003;
      ctx.globalAlpha = pass === 0 ? 0.45 : 0.95;
      ctx.shadowColor = p.fg[0];
      ctx.shadowBlur = pass === 0 ? short * 0.03 : 0;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    if (scene.cover) roundedImage(ctx, scene.cover, w * 0.04, h * 0.05, short * 0.16, short * 0.015);
    text(ctx, scene, w, h, h * 0.88);
    drawCaptions(ctx, scene.captions, scene.captionStyle, scene.time, w, h, scene.palette);
  }
}
