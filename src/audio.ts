/** WebAudio plumbing: one element, one analyser, one recordable stream. */
export type Engine = {
  ctx: AudioContext;
  el: HTMLAudioElement;
  analyser: AnalyserNode;
  freq: Uint8Array;
  wave: Uint8Array;
  /** Audio track for export; the graph also plays to the speakers. */
  stream: MediaStream;
  bands: (count: number) => Float32Array;
  waveform: (points: number) => Float32Array;
  level: () => number;
};

const bandCache = new Map<number, { edges: number[]; out: Float32Array }>();

export function createEngine(el: HTMLAudioElement): Engine {
  const ctx = new AudioContext();
  const src = ctx.createMediaElementSource(el);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;
  const dest = ctx.createMediaStreamDestination();
  src.connect(analyser);
  analyser.connect(ctx.destination);
  analyser.connect(dest);
  const freq = new Uint8Array(analyser.frequencyBinCount);
  const wave = new Uint8Array(analyser.fftSize);
  const sr = ctx.sampleRate;

  const bands = (count: number) => {
    analyser.getByteFrequencyData(freq);
    let c = bandCache.get(count);
    if (!c) {
      // log-spaced edges from 30 Hz to 16 kHz
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
    analyser.getByteTimeDomainData(wave);
    const out = new Float32Array(points);
    const step = wave.length / points;
    for (let i = 0; i < points; i++) out[i] = (wave[Math.floor(i * step)] - 128) / 128;
    return out;
  };

  const level = () => {
    analyser.getByteFrequencyData(freq);
    let s = 0;
    const n = Math.min(64, freq.length);
    for (let i = 0; i < n; i++) s += freq[i];
    return s / n / 255;
  };

  return { ctx, el, analyser, freq, wave, stream: dest.stream, bands, waveform, level };
}
