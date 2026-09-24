/** Word-level captions from Whisper (in-browser) and the styles that draw them. */
export type Word = { text: string; start: number; end: number };
export type CaptionStyle = "off" | "karaoke" | "pop" | "subtitle";
export const CAPTION_STYLES: { id: CaptionStyle; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "karaoke", label: "Karaoke" },
  { id: "pop", label: "Pop" },
  { id: "subtitle", label: "Subtitle" },
];

export type Transcribe = {
  words: Word[];
  /** Phrases: runs of words split on gaps > 0.8 s or ~7 words, for karaoke / subtitle lines. */
  lines: Word[][];
};

export function groupLines(words: Word[], maxWords = 7, gap = 0.8): Word[][] {
  const lines: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (cur.length && (cur.length >= maxWords || w.start - prev.end > gap || /[.!?]$/.test(prev.text))) { lines.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** Decode any audio file to 16 kHz mono, which is what Whisper wants. */
export async function decodeForWhisper(file: File): Promise<Float32Array> {
  const probe = new OfflineAudioContext(1, 1, 44100);
  const buf = await probe.decodeAudioData(await file.arrayBuffer());
  const len = Math.ceil(buf.duration * 16000);
  const off = new OfflineAudioContext(1, len, 16000);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  return out.getChannelData(0);
}

export type Progress = { type: "load"; progress: number; file?: string } | { type: "status"; text: string };

let worker: Worker | null = null;
export function transcribe(audio: Float32Array, onProgress: (p: Progress) => void): Promise<Transcribe> {
  if (!worker) worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  const device: "webgpu" | "wasm" = "gpu" in navigator && (navigator as Navigator & { gpu?: unknown }).gpu ? "webgpu" : "wasm";
  return new Promise((res, rej) => {
    const w = worker!;
    w.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "done") { const words: Word[] = m.words; res({ words, lines: groupLines(words) }); }
      else if (m.type === "error") rej(new Error(m.message));
      else onProgress(m);
    };
    w.onerror = (e) => rej(new Error(e.message));
    w.postMessage({ audio, device }, [audio.buffer]);
  });
}

/** Draw captions for time `t`. Called by the visualizer each frame. */
export function drawCaptions(ctx: CanvasRenderingContext2D, tr: Transcribe | null, style: CaptionStyle, t: number, w: number, h: number, colors: { fg: string[]; text: string }) {
  if (!tr || style === "off" || !tr.words.length) return;
  const u = Math.min(w, h);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = u * 0.015;
  ctx.lineJoin = "round";

  const line = tr.lines.find((l) => t >= l[0].start - 0.15 && t <= l[l.length - 1].end + 0.6);

  if (style === "pop") {
    // one word at a time, big, punches in on its onset
    const word = tr.words.find((x) => t >= x.start && t < x.end + 0.25);
    if (!word) { ctx.restore(); return; }
    const age = t - word.start;
    const scale = 1 + Math.max(0, 0.18 - age * 1.2);
    const size = u * 0.1;
    ctx.font = `900 ${Math.round(size)}px Inter, system-ui, sans-serif`;
    ctx.translate(w / 2, h * 0.5);
    ctx.scale(scale, scale);
    ctx.lineWidth = size * 0.14;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(word.text.toUpperCase(), 0, 0);
    ctx.fillStyle = colors.fg[0];
    ctx.fillText(word.text.toUpperCase(), 0, 0);
    ctx.restore();
    return;
  }

  if (!line) { ctx.restore(); return; }
  const y = h * 0.86;

  if (style === "subtitle") {
    const size = u * 0.042;
    ctx.font = `600 ${Math.round(size)}px Inter, system-ui, sans-serif`;
    const textStr = line.map((x) => x.text).join(" ");
    const tw = ctx.measureText(textStr).width;
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.roundRect(w / 2 - tw / 2 - size * 0.6, y - size * 0.8, tw + size * 1.2, size * 1.6, size * 0.3);
    ctx.fill();
    ctx.fillStyle = colors.text;
    ctx.fillText(textStr, w / 2, y);
    ctx.restore();
    return;
  }

  // karaoke: the whole line, words light up as they are sung
  const size = u * 0.05;
  ctx.font = `800 ${Math.round(size)}px Inter, system-ui, sans-serif`;
  const gap = size * 0.3;
  const widths = line.map((x) => ctx.measureText(x.text).width);
  let total = widths.reduce((a, b) => a + b, 0) + gap * (line.length - 1);
  let scaleX = 1;
  if (total > w * 0.92) { scaleX = (w * 0.92) / total; total = w * 0.92; }
  let x = w / 2 - total / 2;
  ctx.textAlign = "left";
  for (let i = 0; i < line.length; i++) {
    const word = line[i];
    const sung = t >= word.start;
    const active = sung && t < word.end + 0.05;
    ctx.lineWidth = size * 0.16;
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scaleX * (active ? 1.08 : 1), active ? 1.08 : 1);
    ctx.strokeText(word.text, 0, 0);
    ctx.fillStyle = sung ? colors.fg[0] : colors.text;
    ctx.globalAlpha = sung ? 1 : 0.8;
    ctx.fillText(word.text, 0, 0);
    ctx.restore();
    x += widths[i] * scaleX + gap * scaleX;
  }
  ctx.restore();
}
