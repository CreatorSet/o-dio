import { useEffect, useRef, useState } from "react";
import { createEngine, type Engine } from "./audio";
import { draw, PALETTES, STYLES, type Scene, type StyleId } from "./visualizers";
import { download, startRecording } from "./export";

const ASPECTS = [
  { id: "9:16", w: 1080, h: 1920 },
  { id: "1:1", w: 1080, h: 1080 },
  { id: "16:9", w: 1920, h: 1080 },
] as const;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const engRef = useRef<Engine | null>(null);
  const sceneRef = useRef<Scene>({ style: "radial", palette: PALETTES[0], title: "", artist: "", cover: null, watermark: true });

  const [trackName, setTrackName] = useState("");
  const [style, setStyle] = useState<StyleId>("radial");
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>(ASPECTS[0]);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [cover, setCover] = useState<HTMLImageElement | null>(null);
  const [watermark, setWatermark] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState<null | number>(null);
  const [progress, setProgress] = useState(0);

  sceneRef.current = { style, palette: PALETTES[paletteIdx], title, artist, cover, watermark };

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
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
    ensureEngine();
    el.play().then(() => setPlaying(true)).catch(() => undefined);
  };

  const onCover = (f: File) => {
    const img = new Image();
    img.onload = () => setCover(img);
    img.src = URL.createObjectURL(f);
  };

  const toggle = () => {
    const el = audioRef.current!;
    if (!el.src) return;
    ensureEngine();
    if (el.paused) el.play().then(() => setPlaying(true));
    else { el.pause(); setPlaying(false); }
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

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    for (const f of Array.from(e.dataTransfer.files)) {
      if (f.type.startsWith("audio/")) onTrack(f);
      else if (f.type.startsWith("image/")) onCover(f);
    }
  };

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <aside className="panel">
        <h1>O Dio</h1>
        <p className="tag">Drop a track. Pick a look. Export. Yours to remember.</p>

        <label className="file">
          <input type="file" accept="audio/*" onChange={(e) => e.target.files?.[0] && onTrack(e.target.files[0])} />
          <span>{trackName || "Choose audio"}</span>
        </label>
        <label className="file">
          <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onCover(e.target.files[0])} />
          <span>{cover ? "Cover set" : "Cover art (optional)"}</span>
        </label>

        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input placeholder="Artist" value={artist} onChange={(e) => setArtist(e.target.value)} />

        <div className="row">
          {STYLES.map((s) => (
            <button key={s.id} className={style === s.id ? "on" : ""} onClick={() => setStyle(s.id)}>{s.label}</button>
          ))}
        </div>
        <div className="row">
          {PALETTES.map((p, i) => (
            <button key={p.name} className={paletteIdx === i ? "on swatch" : "swatch"} style={{ background: `linear-gradient(135deg, ${p.fg[0]}, ${p.fg[2]})` }} title={p.name} onClick={() => setPaletteIdx(i)} />
          ))}
        </div>
        <div className="row">
          {ASPECTS.map((a) => (
            <button key={a.id} className={aspect.id === a.id ? "on" : ""} onClick={() => setAspect(a)}>{a.id}</button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} /> "made with O Dio" tag
        </label>

        <div className="row actions">
          <button onClick={toggle} disabled={!trackName || exporting !== null}>{playing ? "Pause" : "Play"}</button>
          <button className="primary" onClick={exportVideo} disabled={!trackName || exporting !== null}>
            {exporting === null ? "Export video" : `Recording ${Math.round(exporting * 100)}%`}
          </button>
        </div>
        <div className="bar"><div style={{ width: `${progress * 100}%` }} /></div>
        <p className="hint">Export records in real time, so it takes as long as the song. Keep this tab in front.</p>
        <a className="gh" href="https://github.com/CreatorSet/o-dio" target="_blank" rel="noreferrer">github.com/CreatorSet/o-dio</a>
      </aside>

      <main className="stage">
        <canvas ref={canvasRef} width={aspect.w} height={aspect.h} style={{ aspectRatio: `${aspect.w} / ${aspect.h}` }} />
      </main>
      <audio ref={audioRef} crossOrigin="anonymous" />
    </div>
  );
}
