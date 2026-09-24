/// <reference lib="webworker" />
// Whisper in a worker so the page keeps animating while a song is transcribed.
// Model files come from the Hugging Face hub on first use and are cached by the browser.
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

env.allowLocalModels = false;

type Word = { text: string; start: number; end: number };
let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

async function load(device: "webgpu" | "wasm") {
  if (!asr) {
    asr = pipeline("automatic-speech-recognition", "onnx-community/whisper-base", {
      device,
      dtype: device === "webgpu" ? "fp32" : "q8",
      progress_callback: (p: { status: string; progress?: number; file?: string }) => {
        if (p.status === "progress" && p.progress != null) self.postMessage({ type: "load", progress: p.progress, file: p.file });
      },
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
  }
  return asr;
}

self.onmessage = async (e: MessageEvent<{ audio: Float32Array; device: "webgpu" | "wasm"; language?: string }>) => {
  const { audio, device, language } = e.data;
  try {
    const model = await load(device);
    self.postMessage({ type: "status", text: "Listening to the track…" });
    const out = (await model(audio, {
      return_timestamps: "word",
      chunk_length_s: 30,
      stride_length_s: 5,
      language: language || undefined,
      task: "transcribe",
    })) as { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] };
    const words: Word[] = (out.chunks ?? [])
      .map((c) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.4 }))
      .filter((w) => w.text);
    self.postMessage({ type: "done", words, text: out.text });
  } catch (err) {
    self.postMessage({ type: "error", message: (err as Error).message || String(err) });
  }
};
