import { useEffect, useRef, useState } from "react";
import { createEngine, type Engine } from "./audio";
import { draw, PALETTES, STYLES, type Palette, type Scene, type StyleId } from "./visualizers";
import { download, startRecording } from "./export";
import { computePeaks, Transport, type Peaks } from "./Transport";

const ASPECTS = [
  { id: "16:9", w: 1920, h: 1080 },
  { id: "9:16", w: 1080, h: 1920 },
  { id: "1:1", w: 1080, h: 1080 },
] as const;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const engRef = useRef<Engine | null>(null);
  const sceneRef = useRef<Scene>({ style: "radial", palette: PALETTES[0], title: "", artist: "", cover: null, background: null, bgDim: 0.55, watermark: true });

  const [trackName, setTrackName] = useState("");
  const [style, setStyle] = useState<StyleId>("radial");
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>(ASPECTS[0]);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [cover, setCover] = useState<HTMLImageElement | null>(null);
  const [background, setBackground] = useState<HTMLImageElement | null>(null);
  const [bgDim, setBgDim] = useState(0.55);
  // paletteIdx === -1 means the custom palette below
  const [custom, setCustom] = useState<Palette>({ ...PALETTES[0], name: "Custom" });
  const [watermark, setWatermark] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState<null | number>(null);
  const [live, setLive] = useState<{ stream: MediaStream; kind: string } | null>(null);
  const liveRec = useRef<{ stop: () => void } | null>(null);
  const [progress, setProgress] = useState(0);
  const [peaks, setPeaks] = useState<Peaks | null>(null);

  const palette = paletteIdx === -1 ? custom : PALETTES[paletteIdx];
  sceneRef.current = { style, palette, title, artist, cover, background, bgDim, watermark };

  // keep the Play/Pause button honest whatever the element does (autoplay refusals, end of track)
  useEffect(() => {
    const el = audioRef.current!;
    const on = () => setPlaying(true), off = () => setPlaying(false);
    el.addEventListener("play", on);
    el.addEventListener("pause", off);
    el.addEventListener("ended", off);
    return () => { el.removeEventListener("play", on); el.removeEventListener("pause", off); el.removeEventListener("ended", off); };
  }, []);

  // render loop
  useEffect(() => {
    let raf = 0;
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    const t0 = performance.now();
    const loop = () => {
      draw(ctx, engRef.current, sceneRef.current, c.width, c.height, (performance.now() - t0) / 1000);
      const el = audioRef.current;
      if (el && el.duration) setProgress(el.currentTime / el.duration);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const ensureEngine = () => {
    if (!engRef.current) engRef.current = createEngine(audioRef.current!);
    if (engRef.current.ctx.state === "suspended") engRef.current.ctx.resume();
    return engRef.current;
  };

  const onTrack = (f: File) => {
    const el = audioRef.current!;
    el.src = URL.createObjectURL(f);
    setTrackName(f.name);
    setPeaks(null);
    computePeaks(f).then(setPeaks).catch(() => setPeaks(null));
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/\s*\(\d+\)\s*$/, "").replace(/(mp3|wav|m4a|flac)$/i, "").replace(/[_-]+/g, " ").trim());
    ensureEngine();
    el.play().then(() => setPlaying(true)).catch(() => undefined);
  };

  const loadImage = (f: File) => new Promise<HTMLImageElement>((res) => { const img = new Image(); img.onload = () => res(img); img.src = URL.createObjectURL(f); });
  const onCover = (f: File) => loadImage(f).then(setCover);
  const onBackground = (f: File) => loadImage(f).then(setBackground);

  // Custom palette from an image: sample it small, keep the three most saturated distinct hues.
  const paletteFromImage = (img: HTMLImageElement) => {
    const c = document.createElement("canvas");
    c.width = 48; c.height = 48;
    const x = c.getContext("2d")!;
    x.drawImage(img, 0, 0, 48, 48);
    const d = x.getImageData(0, 0, 48, 48).data;
    const px: { r: number; g: number; b: number; s: number; l: number }[] = [];
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
      const sat = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
      px.push({ r, g, b, s: sat, l });
    }
    const hex = (q: { r: number; g: number; b: number }) => "#" + [q.r, q.g, q.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
    const dist = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    const bright = px.filter((q) => q.l > 0.25 && q.l < 0.9).sort((a, b) => b.s * b.l - a.s * a.l);
    const fg: typeof px = [];
    for (const q of bright) { if (fg.every((f) => dist(f, q) > 0.35)) fg.push(q); if (fg.length === 3) break; }
    while (fg.length < 3) fg.push(bright[0] ?? { r: 1, g: 1, b: 1, s: 0, l: 1 });
    const dark = px.filter((q) => q.l < 0.3).sort((a, b) => a.l - b.l);
    const bg0 = dark[0] ?? { r: 0.03, g: 0.03, b: 0.06 }, bg1 = dark[Math.floor(dark.length / 2)] ?? bg0;
    const scale = (q: { r: number; g: number; b: number }, k: number) => ({ r: q.r * k, g: q.g * k, b: q.b * k });
    setCustom({ name: "Custom", bg: [hex(scale(bg0, 0.6)), hex(scale(bg1, 0.8))], fg: fg.map(hex), text: "#ffffff" });
    setPaletteIdx(-1);
  };

  const toggle = () => {
    const el = audioRef.current!;
    if (!el.src) return;
    ensureEngine();
    if (el.paused) el.play().then(() => setPlaying(true));
    else { el.pause(); setPlaying(false); }
  };

  // Listen to whatever the user is playing: a tab / screen share with audio (Chrome), else the mic
  // (which also catches speakers or a loopback device like BlackHole). Stops when the share ends.
  const stopLive = () => {
    live?.stream.getTracks().forEach((t) => t.stop());
    engRef.current?.live(null);
    setLive(null);
  };
  const listenLive = async () => {
    if (live) { stopLive(); return; }
    const eng = ensureEngine();
    audioRef.current?.pause();
    let stream: MediaStream | null = null;
    let kind = "";
    try {
      const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (c: unknown) => Promise<MediaStream> };
      if (md.getDisplayMedia) {
        const s = await md.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        s.getVideoTracks().forEach((t) => t.stop());
        if (s.getAudioTracks().length) { stream = new MediaStream(s.getAudioTracks()); kind = "tab / screen audio"; }
        else s.getTracks().forEach((t) => t.stop());
      }
    } catch { /* user cancelled or unsupported: fall through to the mic */ }
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        kind = "microphone";
      } catch { return; }
    }
    stream.getAudioTracks()[0].addEventListener("ended", stopLive);
    eng.live(stream);
    setTrackName(`Live: ${kind}`);
    setLive({ stream, kind });
  };

  const recordLive = async () => {
    if (!live) return;
    if (liveRec.current) { liveRec.current.stop(); return; }
    const eng = ensureEngine();
    const t0 = Date.now();
    const { rec, done, ext } = startRecording(canvasRef.current!, eng.stream, 60);
    const iv = setInterval(() => setExporting((Date.now() - t0) / 1000), 500);
    setExporting(0);
    liveRec.current = { stop: () => { clearInterval(iv); rec.stop(); } };
    const blob = await done;
    liveRec.current = null;
    setExporting(null);
    download(blob, `${(title || "live").replace(/[^\w\- ]+/g, "")}.${ext}`);
  };

  const exportVideo = async () => {
    const el = audioRef.current!;
    if (!el.src || exporting !== null) return;
    const eng = ensureEngine();
    el.pause();
    el.currentTime = 0;
    setExporting(0);
    const { rec, done, ext } = startRecording(canvasRef.current!, eng.stream, 60);
    await el.play();
    setPlaying(true);
    const tick = () => setExporting(el.duration ? el.currentTime / el.duration : 0);
    const iv = setInterval(tick, 200);
    await new Promise<void>((r) => el.addEventListener("ended", () => r(), { once: true }));
    clearInterval(iv);
    rec.stop();
    const blob = await done;
    setExporting(null);
    setPlaying(false);
    download(blob, `${(title || trackName || "o-dio").replace(/[^\w\- ]+/g, "")}.${ext}`);
  };

  const takeFiles = (files: Iterable<File>) => {
    let took = false;
    for (const f of files) {
      const audio = f.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac|webm|mp4)$/i.test(f.name);
      if (audio) { onTrack(f); took = true; }
      else if (f.type.startsWith("image/")) { onCover(f); took = true; }
    }
    return took;
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    takeFiles(Array.from(e.dataTransfer.files));
  };

  // Paste anything: a copied audio file (Finder / Explorer), an image for the cover, or a
  // direct link to an audio file. Links only play through the analyser when the host allows CORS.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length && takeFiles(files)) { e.preventDefault(); return; }
      const text = e.clipboardData?.getData("text")?.trim() ?? "";
      if (/^https?:\/\/\S+\.(mp3|wav|m4a|aac|ogg|flac)(\?\S*)?$/i.test(text)) {
        e.preventDefault();
        fetch(text)
          .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
          .then((b) => onTrack(new File([b], text.split("/").pop()?.split("?")[0] || "track", { type: b.type || "audio/mpeg" })))
          .catch(() => {
            const el = audioRef.current!;
            el.src = text;
            setTrackName(text.split("/").pop()?.split("?")[0] || "link");
            ensureEngine();
            el.play().catch(() => undefined);
          });
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <aside className="panel">
        <h1>CreatorSet<span className="ai">.ai</span></h1>
        <p className="tag">Music visualizer. Drop or paste a track. Pick a look. Export.</p>

        <section>
          <h2>1 · Source</h2>
          <div className="cards">
            <label className={trackName && !live ? "card on" : "card"}>
              <input type="file" accept="audio/*,video/*" onChange={(e) => e.target.files?.[0] && onTrack(e.target.files[0])} />
              <span className="ic">♪</span>
              <b>{trackName ? "Track loaded" : "Upload a track"}</b>
              <small>{trackName || "Drop, paste or pick a file"}</small>
            </label>
            <button className={live ? "card on" : "card"} onClick={listenLive} disabled={exporting !== null}>
              <span className="ic">{live ? "●" : "◉"}</span>
              <b>{live ? "Listening" : "Listen live"}</b>
              <small>{live ? `${live.kind} · tap to stop` : "React to what I'm playing"}</small>
            </button>
          </div>
        </section>

        <section>
          <h2>2 · Style</h2>
          <div className="row">
            {STYLES.map((s) => (
              <button key={s.id} className={style === s.id ? "on" : ""} onClick={() => setStyle(s.id)}>{s.label}</button>
            ))}
          </div>
        </section>

        <section>
          <h2>3 · Color</h2>
          <div className="row">
            {PALETTES.map((p, i) => (
              <button key={p.name} className={paletteIdx === i ? "on swatch" : "swatch"} style={{ background: `linear-gradient(135deg, ${p.fg[0]}, ${p.fg[2]})` }} title={p.name} onClick={() => setPaletteIdx(i)} />
            ))}
            <button className={paletteIdx === -1 ? "on swatch custom" : "swatch custom"} style={{ background: `linear-gradient(135deg, ${custom.fg[0]}, ${custom.fg[2]})` }} title="Custom" onClick={() => setPaletteIdx(-1)}>✎</button>
          </div>
          {paletteIdx === -1 && (
            <div className="palEdit">
              <div className="palRow">
                <span>Glow</span>
                {custom.fg.map((c, i) => (
                  <input key={i} type="color" value={c} onChange={(e) => setCustom({ ...custom, fg: custom.fg.map((v, j) => (j === i ? e.target.value : v)) })} />
                ))}
              </div>
              <div className="palRow">
                <span>Background</span>
                {custom.bg.map((c, i) => (
                  <input key={i} type="color" value={c} onChange={(e) => setCustom({ ...custom, bg: custom.bg.map((v, j) => (j === i ? e.target.value : v)) as [string, string] })} />
                ))}
                <span>Text</span>
                <input type="color" value={custom.text} onChange={(e) => setCustom({ ...custom, text: e.target.value })} />
              </div>
              <div className="row">
                <button onClick={() => cover && paletteFromImage(cover)} disabled={!cover}>From cover</button>
                <button onClick={() => background && paletteFromImage(background)} disabled={!background}>From background</button>
              </div>
            </div>
          )}
          <label className="file">
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onBackground(e.target.files[0])} />
            <span>{background ? "Background image ✓ (click to change)" : "Background image (optional)"}</span>
          </label>
          {background && (
            <label className="slider">
              <span>Dim</span>
              <input type="range" min={0} max={0.95} step={0.05} value={bgDim} onChange={(e) => setBgDim(Number(e.target.value))} />
              <button className="x" onClick={() => setBackground(null)} title="Remove background">×</button>
            </label>
          )}
        </section>

        <section>
          <h2>4 · Display Labels</h2>
          <label className="file">
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onCover(e.target.files[0])} />
            <span>{cover ? "Cover art ✓ (click to change)" : "Cover art (optional)"}</span>
          </label>
          <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input placeholder="Artist" value={artist} onChange={(e) => setArtist(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} /> "made with CreatorSet.ai" tag
          </label>
        </section>

        <section>
          <h2>5 · Aspect Ratio</h2>
          <div className="row">
            {ASPECTS.map((a) => (
              <button key={a.id} className={aspect.id === a.id ? "on" : ""} onClick={() => setAspect(a)}>{a.id}</button>
            ))}
          </div>
        </section>

        <section>
          <h2>Export</h2>
          <div className="row actions">
            {live ? (
              <button className="primary" onClick={recordLive}>
                {exporting === null ? "Start recording" : `Stop recording · ${Math.floor(exporting / 60)}:${String(Math.floor(exporting % 60)).padStart(2, "0")}`}
              </button>
            ) : (
              <>
                <button className="primary" onClick={exportVideo} disabled={!trackName || exporting !== null}>
                  {exporting === null ? "Export video" : `Recording ${Math.round(exporting * 100)}%`}
                </button>
              </>
            )}
          </div>
          <div className="bar"><div style={{ width: `${progress * 100}%` }} /></div>
          <p className="hint">{live ? "Recording runs until you stop it." : "Export records in real time, so it takes as long as the song. Keep this tab in front."}</p>
        </section>
        <a className="gh" href="https://github.com/CreatorSet/o-dio" target="_blank" rel="noreferrer">open source · github.com/CreatorSet/o-dio</a>
      </aside>

      <main className="stage">
        <canvas ref={canvasRef} width={aspect.w} height={aspect.h} style={{ aspectRatio: `${aspect.w} / ${aspect.h}` }} />
        <Transport
          audio={audioRef}
          eng={engRef}
          peaks={peaks}
          live={live !== null}
          playing={playing}
          enabled={Boolean(trackName)}
          accent={PALETTES[paletteIdx].fg[0]}
          onToggle={toggle}
        />
      </main>
      <audio ref={audioRef} crossOrigin="anonymous" />
    </div>
  );
}
