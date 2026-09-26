/**
 * Offline analysis: an Engine that reads from a decoded AudioBuffer at an exact frame time,
 * so the offline export sees the same numbers the live AnalyserNode would (2048-point FFT,
 * Hann window, -100..-30 dB mapped to 0..255, 0.8 temporal smoothing).
 */
import type { Engine } from "./audio";

const N = 2048;
const hann = new Float32Array(N);
for (let i = 0; i < N; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));

// in-place radix-2 FFT, re/im length N
const cosT = new Float32Array(N / 2), sinT = new Float32Array(N / 2);
for (let i = 0; i < N / 2; i++) { cosT[i] = Math.cos((2 * Math.PI * i) / N); sinT[i] = -Math.sin((2 * Math.PI * i) / N); }
const rev = new Uint16Array(N);
for (let i = 0, b = Math.log2(N); i < N; i++) { let r = 0; for (let k = 0; k < b; k++) r |= ((i >> k) & 1) << (b - 1 - k); rev[i] = r; }
function fft(re: Float32Array, im: Float32Array) {
  for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let i = 0; i < N; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const tr = re[i + j + half] * cosT[k] - im[i + j + half] * sinT[k];
        const ti = re[i + j + half] * sinT[k] + im[i + j + half] * cosT[k];
        re[i + j + half] = re[i + j] - tr; im[i + j + half] = im[i + j] - ti;
        re[i + j] += tr; im[i + j] += ti;
      }
    }
  }
}

export type OfflineEngine = Engine & { seek: (seconds: number) => void; sampleRate: number };

export function createOfflineEngine(buf: AudioBuffer): OfflineEngine {
  const sr = buf.sampleRate;
  const mono = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
  const re = new Float32Array(N), im = new Float32Array(N);
  const smooth = new Float32Array(N / 2); // AnalyserNode-style smoothed magnitudes (linear)
  const freq = new Uint8Array(N / 2);
  const wave = new Uint8Array(N);
  let pos = 0;

  const seek = (seconds: number) => {
    // AnalyserNode analyses the most recent fftSize samples
    pos = Math.max(0, Math.min(mono.length - N, Math.floor(seconds * sr) - N));
    for (let i = 0; i < N; i++) { re[i] = mono[pos + i] * hann[i]; im[i] = 0; wave[i] = Math.max(0, Math.min(255, Math.round(128 + mono[pos + i] * 128))); }
    fft(re, im);
    for (let i = 0; i < N / 2; i++) {
      const mag = Math.hypot(re[i], im[i]) / N;
      smooth[i] = 0.8 * smooth[i] + 0.2 * mag;
      const db = 20 * Math.log10(smooth[i] + 1e-12);
      freq[i] = Math.max(0, Math.min(255, Math.round(((db + 100) / 70) * 255)));
    }
  };

  const bandCache = new Map<number, { edges: number[]; out: Float32Array }>();
  const bands = (count: number) => {
    let c = bandCache.get(count);
    if (!c) {
      const nyq = sr / 2;
      const lo = Math.log10(30), hi = Math.log10(Math.min(16000, nyq));
      const edges = Array.from({ length: count + 1 }, (_, i) => {
        const f = 10 ** (lo + ((hi - lo) * i) / count);
        return Math.max(1, Math.min(freq.length - 1, Math.round((f / nyq) * freq.length)));
      });
      c = { edges, out: new Float32Array(count) };
      bandCache.set(count, c);
    }
    for (let i = 0; i < count; i++) {
      const a = c.edges[i], b = Math.max(a + 1, c.edges[i + 1]);
      let s = 0;
      for (let k = a; k < b; k++) s += freq[k];
      c.out[i] = s / (b - a) / 255;
    }
    return c.out;
  };
  const waveform = (points: number) => {
    const out = new Float32Array(points);
    const step = wave.length / points;
    for (let i = 0; i < points; i++) out[i] = (wave[Math.floor(i * step)] - 128) / 128;
    return out;
  };
  const level = () => { let s = 0; for (let i = 0; i < 64; i++) s += freq[i]; return s / 64 / 255; };

  // the live-only bits are stubs
  const dummy = { ctx: null as unknown as AudioContext, el: null as unknown as HTMLAudioElement, analyser: null as unknown as AnalyserNode, stream: null as unknown as MediaStream, live: () => undefined };
  return { ...dummy, freq, wave, bands, waveform, level, seek, sampleRate: sr };
}
