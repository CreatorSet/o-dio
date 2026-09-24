# CreatorSet.ai · Music Visualizer

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

## AI background

"Generate" in the Color section posts `{ prompt, aspect }` to a small endpoint that starts a Nano Banana 2 task and returns `{ taskId }`; the app then polls `GET ?taskId=` until it gets `{ state: "success", dataUrl }`. The default endpoint is CreatorSet's (`https://creatorset.com/api/odio/background`, 12 per hour per IP). Self-hosting? Set `VITE_BG_API` at build time to your own; the reference implementation is `src/pages/api/odio/background.ts` in the CreatorSet shop.

## Captions

"Transcribe lyrics" asks `VITE_CAPTIONS_TOKEN_API` (default CreatorSet's `/api/odio/captions-token`) for a short-lived token and the upload URL, then posts the file there (a Modal app running faster-whisper large-v3-turbo with word timestamps; source in the CreatorSet API repo under `modal/whisper/`). If that fails for any reason the app falls back to Whisper-base in the browser via transformers.js, so a fork with no backend still works.
