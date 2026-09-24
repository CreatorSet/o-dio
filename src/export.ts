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
