import { useEffect, useRef, useState } from "react";
import type { Engine } from "./audio";

/** Peaks of a whole decoded track: [max0, min0, max1, min1, ...] in -1..1, `n` columns. */
export type Peaks = { data: Float32Array; n: number };

export async function computePeaks(file: File, n = 800): Promise<Peaks> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buf = await ctx.decodeAudioData(await file.arrayBuffer());
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const data = new Float32Array(n * 2);
  const step = len / n;
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * step), b = Math.min(len, Math.floor((i + 1) * step));
    let mx = 0, mn = 0;
    const stride = Math.max(1, Math.floor((b - a) / 200));
    for (let k = a; k < b; k += stride) {
      let v = 0;
      for (let c = 0; c < ch; c++) v += chans[c][k];
      v /= ch;
      if (v > mx) mx = v;
      if (v < mn) mn = v;
    }
    data[i * 2] = mx;
    data[i * 2 + 1] = mn;
  }
  return { data, n };
}

const fmt = (s: number) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

type Props = {
  audio: React.RefObject<HTMLAudioElement | null>;
  eng: React.RefObject<Engine | null>;
  peaks: Peaks | null;
  live: boolean;
  playing: boolean;
  enabled: boolean;
  accent: string;
  onToggle: () => void;
};

/**
 * The control center under the stage: a full-track waveform you can scrub, transport buttons,
 * time, and a live meter (bass / mid / high + level) so you can see what the visualizer hears.
 * In live mode the waveform becomes a rolling history of the last ~20 s.
 */
export function Transport({ audio, eng, peaks, live, playing, enabled, accent, onToggle }: Props) {
  const waveRef = useRef<HTMLCanvasElement>(null);
  const meterRef = useRef<HTMLCanvasElement>(null);
  const history = useRef(new Float32Array(600));
  const [time, setTime] = useState({ t: 0, d: 0 });
  const dragging = useRef(false);

  useEffect(() => {
    let raf = 0;
    let lastHist = 0;
    const loop = (now: number) => {
      const el = audio.current;
      const e = eng.current;
      const wc = waveRef.current, mc = meterRef.current;
      if (el) setTime((p) => (Math.abs(p.t - el.currentTime) > 0.05 || p.d !== (el.duration || 0) ? { t: el.currentTime, d: el.duration || 0 } : p));

      // waveform / history
      if (wc) {
        const dpr = window.devicePixelRatio || 1;
        const W = wc.clientWidth, H = wc.clientHeight;
        if (wc.width !== W * dpr || wc.height !== H * dpr) { wc.width = W * dpr; wc.height = H * dpr; }
        const ctx = wc.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        const mid = H / 2;
        if (live && e) {
          if (now - lastHist > 33) {
            lastHist = now;
            const h = history.current;
            h.copyWithin(0, 1);
            h[h.length - 1] = e.level();
          }
          const h = history.current;
          const cw = W / h.length;
          for (let i = 0; i < h.length; i++) {
            const a = Math.max(1, h[i] * mid * 0.95);
            ctx.fillStyle = i > h.length - 3 ? "#fff" : accent;
            ctx.globalAlpha = 0.35 + 0.65 * (i / h.length);
            ctx.fillRect(i * cw, mid - a, Math.max(1, cw - 0.5), a * 2);
          }
          ctx.globalAlpha = 1;
        } else if (peaks) {
          const prog = el && el.duration ? el.currentTime / el.duration : 0;
          const cw = W / peaks.n;
          for (let i = 0; i < peaks.n; i++) {
            const mx = peaks.data[i * 2], mn = peaks.data[i * 2 + 1];
            const top = mid - Math.max(1, mx * mid * 0.95), bot = mid + Math.max(1, -mn * mid * 0.95);
            ctx.fillStyle = i / peaks.n <= prog ? accent : "#3a3a4d";
            ctx.fillRect(i * cw, top, Math.max(1, cw - 0.6), bot - top);
          }
          const x = prog * W;
          ctx.fillStyle = "#fff";
          ctx.fillRect(x - 0.5, 0, 1.5, H);
        } else {
          ctx.fillStyle = "#26263a";
          ctx.fillRect(0, mid - 1, W, 2);
        }
      }

      // meter: bass / mid / high / level
      if (mc && e) {
        const dpr = window.devicePixelRatio || 1;
        const W = mc.clientWidth, H = mc.clientHeight;
        if (mc.width !== W * dpr || mc.height !== H * dpr) { mc.width = W * dpr; mc.height = H * dpr; }
        const ctx = mc.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        const b = e.bands(3);
        const vals = [b[0], b[1], b[2], e.level()];
        const labels = ["LOW", "MID", "HI", "LVL"];
        const gap = 6, bw = (W - gap * 3) / 4;
        for (let i = 0; i < 4; i++) {
          const x = i * (bw + gap);
          ctx.fillStyle = "#1d1d28";
          ctx.fillRect(x, 0, bw, H - 14);
          const hh = Math.min(1, vals[i]) * (H - 14);
          ctx.fillStyle = i === 3 ? "#fff" : accent;
          ctx.globalAlpha = i === 3 ? 0.85 : 1;
          ctx.fillRect(x, H - 14 - hh, bw, hh);
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#8a8aa8";
          ctx.font = "600 9px Inter, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(labels[i], x + bw / 2, H - 3);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [audio, eng, peaks, live, accent]);

  const seekAt = (clientX: number) => {
    const el = audio.current, wc = waveRef.current;
    if (!el || !wc || live || !el.duration) return;
    const r = wc.getBoundingClientRect();
    el.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * el.duration;
  };
  const skip = (s: number) => {
    const el = audio.current;
    if (el && el.duration) el.currentTime = Math.max(0, Math.min(el.duration, el.currentTime + s));
  };

  return (
    <div className={enabled ? "transport" : "transport off"}>
      <div className="tControls">
        {!live && <button onClick={() => skip(-10)} disabled={!enabled} title="Back 10 s">‹10</button>}
        <button className={live ? "play stop" : "play"} onClick={onToggle} disabled={!enabled} title={live ? "Stop listening" : playing ? "Pause" : "Play"}>
          {live ? "■" : playing ? "❚❚" : "▶"}
        </button>
        {!live && <button onClick={() => skip(10)} disabled={!enabled} title="Forward 10 s">10›</button>}
        <span className="tTime">{live ? <span className="liveDot">● LIVE</span> : `${fmt(time.t)} / ${fmt(time.d)}`}</span>
      </div>
      <canvas
        ref={waveRef}
        className="tWave"
        onPointerDown={(e) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); seekAt(e.clientX); }}
        onPointerMove={(e) => dragging.current && seekAt(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
      />
      <canvas ref={meterRef} className="tMeter" />
    </div>
  );
}
