# O Dio

Open-source music visualizer. Drop a track, pick a look, export a video. Runs entirely in your browser: nothing is uploaded, nothing is stored.

**Live:** https://creatorset.github.io/o-dio/

## What it does

- Reads any audio file the browser can play (mp3, wav, m4a, ogg, flac): choose, drop, or paste it (a file or a direct link)
- **Listen live**: reacts to whatever you're playing. Chrome shares a tab or screen's audio; other browsers use the mic. Record the result as long as you like
- Four looks: Bars, Radial, Wave, Orb
- Five palettes, cover art, title and artist text
- 9:16, 1:1 and 16:9 canvases at 1080p
- Exports a video with the original audio, in real time, straight from the canvas (mp4 where the browser supports it, otherwise webm)

## Run it locally

```bash
npm install
npm run dev
```

Node 20 or newer.

## How it works

`src/audio.ts` wires the `<audio>` element into a WebAudio `AnalyserNode` and exposes log-spaced frequency bands, the waveform and an overall level. `src/visualizers.ts` draws one frame of the chosen look onto a 2D canvas. `src/export.ts` records `canvas.captureStream()` plus the audio graph with `MediaRecorder`.

Export is real time by design: it takes as long as the song. Keep the tab in the foreground while it records.

## Add a look

Add an id to `STYLES` in `src/visualizers.ts` and a branch in `draw()`. You get `eng.bands(n)`, `eng.waveform(points)` and `eng.level()`. Pull requests welcome.

## License

MIT. Made by [CreatorSet](https://creatorset.com).
