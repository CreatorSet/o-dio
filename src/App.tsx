import { useEffect, useRef, useState } from "react";
import { createEngine, type Engine } from "./audio";
import { draw, PALETTES, STYLES, type Palette, type Scene, type StyleId } from "./visualizers";
import { download, startRecording } from "./export";
import { computePeaks, Transport, type Peaks } from "./Transport";
import { CAPTION_STYLES, decodeForWhisper, transcribe, type CaptionStyle, type Transcribe } from "./captions";

const ASPECTS = [
  { id: "16:9", w: 1920, h: 1080 },
  { id: "9:16", w: 1080, h: 1920 },
  { id: "1:1", w: 1080, h: 1080 },
] as const;

/** Little glyphs so each style reads at a glance. */
function StyleIcon({ id }: { id: StyleId }) {
  const c = "currentColor";
  switch (id) {
    case "xp": return <svg viewBox="0 0 40 24"><g fill={c}>{[4,10,16,22,28,34].map((x, i) => <rect key={x} x={x} y={20 - [10,16,8,18,12,6][i]} width="4" height={[10,16,8,18,12,6][i]} rx="1" />)}</g></svg>;
    case "radial": return <svg viewBox="0 0 40 24"><g stroke={c} strokeWidth="2" fill="none"><circle cx="20" cy="12" r="5" />{Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2, l = 3 + (i % 3) * 2; return <line key={i} x1={20 + Math.cos(a) * 7} y1={12 + Math.sin(a) * 7} x2={20 + Math.cos(a) * (7 + l)} y2={12 + Math.sin(a) * (7 + l)} />; })}</g></svg>;
    case "wave": return <svg viewBox="0 0 40 24"><path d="M0 12 C4 2 8 22 12 12 S20 2 24 12 S32 22 36 12 40 12 40 12" stroke={c} strokeWidth="2" fill="none" /></svg>;
    case "orb": return <svg viewBox="0 0 40 24"><circle cx="20" cy="12" r="7" fill={c} /><circle cx="20" cy="12" r="10" stroke={c} strokeWidth="1" fill="none" opacity="0.5" /></svg>;
    case "bars": return <svg viewBox="0 0 40 24"><g fill={c}>{[2,7,12,17,22,27,32].map((x, i) => <rect key={x} x={x} y={22 - [8,14,20,12,16,6,10][i]} width="4" height={[8,14,20,12,16,6,10][i]} rx="1.5" />)}</g></svg>;
    case "rings": return <svg viewBox="0 0 40 24"><g stroke={c} fill="none"><circle cx="20" cy="12" r="3" strokeWidth="2" /><circle cx="20" cy="12" r="7" strokeWidth="1.5" opacity="0.7" /><circle cx="20" cy="12" r="11" strokeWidth="1" opacity="0.4" /></g></svg>;
    case "dots": return <svg viewBox="0 0 40 24"><g fill={c}>{Array.from({ length: 21 }, (_, i) => { const x = 5 + (i % 7) * 5, y = 6 + Math.floor(i / 7) * 6; const on = Math.abs(y - 12) < [6,12,2,8,12,4,8][i % 7]; return <circle key={i} cx={x} cy={y} r="1.6" opacity={on ? 1 : 0.25} />; })}</g></svg>;
    case "scope": return <svg viewBox="0 0 40 24"><g stroke={c} strokeWidth="0.6" opacity="0.4"><line x1="0" y1="12" x2="40" y2="12" /><line x1="20" y1="0" x2="20" y2="24" /></g><polyline points="0,12 5,12 8,4 11,20 14,8 17,15 20,12 26,12 29,6 32,18 35,12 40,12" stroke={c} strokeWidth="2" fill="none" /></svg>;
  }
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const engRef = useRef<Engine | null>(null);
  const sceneRef = useRef<Scene>({ style: "radial", palette: PALETTES[0], title: "", artist: "", cover: null, artistPhoto: null, background: null, bgDim: 0.55, watermark: true, captions: null, captionStyle: "off", time: 0 });

  const [trackName, setTrackName] = useState("");
  const [style, setStyle] = useState<StyleId>("radial");
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>(ASPECTS[0]);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [cover, setCover] = useState<HTMLImageElement | null>(null);
  const [background, setBackground] = useState<HTMLImageElement | null>(null);
  const [artistPhoto, setArtistPhoto] = useState<HTMLImageElement | null>(null);
  const [bgDim, setBgDim] = useState(0.55);
  // paletteIdx === -1 means the custom palette below
  const [custom, setCustom] = useState<Palette>({ ...PALETTES[0], name: "Custom" });
  const [watermark, setWatermark] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState<null | number>(null);
  const [captions, setCaptions] = useState<Transcribe | null>(null);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("karaoke");
  const [captionJob, setCaptionJob] = useState<string | null>(null);
  const trackFile = useRef<File | null>(null);
  const [live, setLive] = useState<{ stream: MediaStream; kind: string } | null>(null);
  const liveRec = useRef<{ stop: () => void } | null>(null);
  const [progress, setProgress] = useState(0);
  const [peaks, setPeaks] = useState<Peaks | null>(null);

  const palette = paletteIdx === -1 ? custom : PALETTES[paletteIdx];
  sceneRef.current = { style, palette, title, artist, cover, artistPhoto, background, bgDim, watermark, captions, captionStyle, time: sceneRef.current.time };

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
      sceneRef.current.time = audioRef.current?.currentTime ?? 0;
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
    if (live) stopLive();
    const el = audioRef.current!;
    el.src = URL.createObjectURL(f);
    setTrackName(f.name);
    trackFile.current = f;
    setCaptions(null);
    setPeaks(null);
    computePeaks(f).then(setPeaks).catch(() => setPeaks(null));
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/\s*\(\d+\)\s*$/, "").replace(/(mp3|wav|m4a|flac)$/i, "").replace(/[_-]+/g, " ").trim());
    ensureEngine();
    el.play().then(() => setPlaying(true)).catch(() => undefined);
  };

  const loadImage = (f: File) => new Promise<HTMLImageElement>((res) => { const img = new Image(); img.onload = () => res(img); img.src = URL.createObjectURL(f); });
  const onCover = (f: File) => loadImage(f).then(setCover);
  const onBackground = (f: File) => loadImage(f).then(setBackground);
  const onArtistPhoto = (f: File) => loadImage(f).then(setArtistPhoto);

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

  const makeCaptions = async () => {
    const f = trackFile.current;
    if (!f || captionJob) return;
    try {
      setCaptionJob("Decoding audio…");
      const audio = await decodeForWhisper(f);
      setCaptionJob("Loading Whisper (first time downloads ~80 MB)…");
      const tr = await transcribe(audio, (p) => {
        if (p.type === "load") setCaptionJob(`Loading Whisper… ${Math.round(p.progress)}%`);
        else setCaptionJob(p.text);
      });
      setCaptions(tr);
      if (captionStyle === "off") setCaptionStyle("karaoke");
      setCaptionJob(null);
    } catch (e) {
      setCaptionJob(`Failed: ${(e as Error).message}`);
      setTimeout(() => setCaptionJob(null), 6000);
    }
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
            <label className={live ? "card dim" : trackName ? "card on" : "card"}>
              <input type="file" accept="audio/*,video/*" onChange={(e) => e.target.files?.[0] && onTrack(e.target.files[0])} />
              <span className="ic">{trackName ? "↻" : "♪"}</span>
              <b>{trackName ? "Change track" : "Upload a track"}</b>
              <small>{trackName ? trackName : "Drop, paste or pick a file"}</small>
            </label>
            <button className={live ? "card on" : "card"} onClick={listenLive} disabled={exporting !== null}>
              <span className="ic">{live ? "■" : "◉"}</span>
              <b>{live ? "Stop listening" : "Listen live"}</b>
              <small>{live ? `Hearing ${live.kind}` : "React to what I'm playing"}</small>
            </button>
          </div>
        </section>

        <section>
          <h2>2 · Visualizer</h2>
          <p className="hint">Pick how the music looks. Switch any time, even while playing.</p>
          <div className="tiles">
            {STYLES.map((s) => (
              <button key={s.id} className={style === s.id ? "tile on" : "tile"} onClick={() => setStyle(s.id)} title={s.label}>
                <StyleIcon id={s.id} />
                <span>{s.label}</span>
              </button>
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
          <label className="file">
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onArtistPhoto(e.target.files[0])} />
            <span>{artistPhoto ? "Artist photo ✓ (click to change)" : "Artist photo (optional, shows next to the name)"}</span>
          </label>
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
          <h2>6 · Captions</h2>
          <button className="live" onClick={makeCaptions} disabled={!trackFile.current || captionJob !== null || live !== null}>
            {captionJob ?? (captions ? `✓ ${captions.words.length} words · transcribe again` : "Transcribe lyrics with Whisper (in your browser)")}
          </button>
          {captions && (
            <div className="row">
              {CAPTION_STYLES.map((c) => (
                <button key={c.id} className={captionStyle === c.id ? "on" : ""} onClick={() => setCaptionStyle(c.id)}>{c.label}</button>
              ))}
            </div>
          )}
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
          enabled={Boolean(trackName) || live !== null}
          accent={PALETTES[paletteIdx].fg[0]}
          onToggle={toggle}
        />
      </main>
      <audio ref={audioRef} crossOrigin="anonymous" />
    </div>
  );
}
