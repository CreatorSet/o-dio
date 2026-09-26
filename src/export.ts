/** Record the canvas + audio graph in real time. mp4 where the browser can, webm otherwise. */
export function pickMime(): { mime: string; ext: string } {
  const candidates = [
    { mime: "video/mp4;codecs=avc1.640028,mp4a.40.2", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
    { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
  ];
  for (const c of candidates) if (MediaRecorder.isTypeSupported(c.mime)) return c;
  return { mime: "", ext: "webm" };
}

export function startRecording(canvas: HTMLCanvasElement, audio: MediaStream, fps = 60) {
  const { mime, ext } = pickMime();
  const video = canvas.captureStream(fps);
  const stream = new MediaStream([...video.getVideoTracks(), ...audio.getAudioTracks()]);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12_000_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: mime || "video/webm" }));
  });
  rec.start(250);
  return { rec, done, ext };
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// ── Offline export: WebCodecs + mp4-muxer. Renders every frame at exact times, faster than
// real time, no dropped frames, and the tab does not need to stay in front. ─────────────────
import { ArrayBufferTarget, Muxer } from "mp4-muxer";

export const canExportOffline = () => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof VideoFrame !== "undefined";

export type OfflineOpts = {
  canvas: HTMLCanvasElement;
  audio: AudioBuffer;
  fps: number;
  /** Draw the frame for time `t` seconds into the canvas. */
  renderFrame: (t: number) => void;
  onProgress: (fraction: number) => void;
  bitrate?: number;
};

export async function exportOffline({ canvas, audio, fps, renderFrame, onProgress, bitrate }: OfflineOpts): Promise<Blob> {
  const w = canvas.width, h = canvas.height;
  const duration = audio.duration;
  const sr = audio.sampleRate, ch = Math.min(2, audio.numberOfChannels);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: w, height: h, frameRate: fps },
    audio: { codec: "aac", sampleRate: sr, numberOfChannels: ch },
    fastStart: "in-memory",
  });

  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { throw e; } });
  // avc1.640028 = High 4.0 (1080p60 ok); level 4.2 for tall/large frames
  const vcfg: VideoEncoderConfig = { codec: h * w > 1920 * 1080 ? "avc1.640032" : "avc1.640028", width: w, height: h, bitrate: bitrate ?? 12_000_000, framerate: fps, latencyMode: "quality" };
  const sup = await VideoEncoder.isConfigSupported(vcfg);
  if (!sup.supported) throw new Error("H.264 encoder not available in this browser");
  venc.configure(vcfg);

  const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { throw e; } });
  aenc.configure({ codec: "mp4a.40.2", sampleRate: sr, numberOfChannels: ch, bitrate: 192_000 });

  // audio: feed in 1 s planar chunks
  const chunkFrames = sr;
  for (let start = 0; start < audio.length; start += chunkFrames) {
    const n = Math.min(chunkFrames, audio.length - start);
    const data = new Float32Array(n * ch);
    for (let c = 0; c < ch; c++) data.set(audio.getChannelData(c).subarray(start, start + n), c * n);
    aenc.encode(new AudioData({ format: "f32-planar", sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round((start / sr) * 1e6), data }));
  }

  const total = Math.ceil(duration * fps);
  for (let i = 0; i < total; i++) {
    const t = i / fps;
    renderFrame(t);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / fps) });
    venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    if (i % 4 === 0) {
      onProgress(i / total);
      // let the encoder drain and the UI breathe
      while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await venc.flush();
  await aenc.flush();
  venc.close();
  aenc.close();
  muxer.finalize();
  onProgress(1);
  return new Blob([target.buffer], { type: "video/mp4" });
}
