import { synthesizeSpeech } from "@/api/client";
import type { SynthesizedSpeech } from "@/api/client";

export type SpeakHandlers = {
  onLevel: (level: number) => void;
  onStart?: () => void;
  onBlocked?: () => void;
  onEnd: () => void;
  onError: (message: string) => void;
  onProvider?: (provider: string) => void;
};

export type SpeechPlayback = { stop: () => void };

let sharedContext: AudioContext | null = null;

function audioContext(): AudioContext | null {
  const Ctor = globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (sharedContext === null) sharedContext = new Ctor();
  return sharedContext;
}

// Resume inside the gesture, not after the synthesis request has consumed user activation.
export function unlockSpeechAudio(): void {
  const context = audioContext();
  if (context?.state === "suspended") void context.resume().catch(() => undefined);
}

function waitForAudio(context: AudioContext, handlers: SpeakHandlers, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  if (context.state === "running") return Promise.resolve(true);
  handlers.onBlocked?.();
  return new Promise(resolve => {
    const finish = (ready: boolean) => {
      context.removeEventListener("statechange", changed);
      signal?.removeEventListener("abort", aborted);
      resolve(ready);
    };
    const changed = () => {
      if (context.state === "running") finish(true);
      else if (context.state === "closed") finish(false);
    };
    const aborted = () => finish(false);
    context.addEventListener("statechange", changed);
    signal?.addEventListener("abort", aborted, { once: true });
    changed();
  });
}

function browserFallback(text: string, handlers: SpeakHandlers, signal?: AbortSignal): SpeechPlayback {
  const synth = globalThis.speechSynthesis;
  if (!synth) {
    handlers.onError("This browser cannot speak the reply.");
    handlers.onEnd();
    return { stop: () => undefined };
  }

  const utterance = new SpeechSynthesisUtterance(text);
  let finished = false;
  let boundaryTimer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(boundaryTimer);
    signal?.removeEventListener("abort", stop);
    handlers.onLevel(0);
    handlers.onEnd();
  };
  const stop = () => {
    if (finished) return;
    finish();
    synth.cancel();
  };
  utterance.onstart = () => {
    if (finished || signal?.aborted) return;
    handlers.onProvider?.("browser");
    handlers.onStart?.();
  };
  // Browser synthesis exposes word boundaries, not an analysable audio stream.
  utterance.onboundary = event => {
    if (finished || signal?.aborted || event.name !== "word") return;
    clearTimeout(boundaryTimer);
    handlers.onLevel(0.35);
    boundaryTimer = setTimeout(() => handlers.onLevel(0), 140);
  };
  utterance.onend = finish;
  utterance.onerror = event => {
    if (!finished && event.error !== "canceled" && event.error !== "interrupted") {
      handlers.onError(event.error === "not-allowed"
        ? "Your browser blocked sound. Interact with the page, then unmute to hear the reply."
        : "The browser could not speak this reply. The text is still available.");
    }
    finish();
  };
  signal?.addEventListener("abort", stop, { once: true });
  synth.speak(utterance);
  return { stop };
}

export async function speak(text: string, handlers: SpeakHandlers, signal?: AbortSignal): Promise<SpeechPlayback> {
  const silent = { stop: () => undefined };
  if (signal?.aborted) return silent;
  const trimmed = text.trim();
  if (!trimmed) {
    handlers.onEnd();
    return silent;
  }

  const context = audioContext();
  unlockSpeechAudio();
  let speech: SynthesizedSpeech;
  try {
    speech = await synthesizeSpeech(trimmed, signal);
  } catch {
    if (signal?.aborted) return silent;
    return browserFallback(trimmed, handlers, signal);
  }
  if (signal?.aborted) return silent;
  if (context === null) return browserFallback(trimmed, handlers, signal);

  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(speech.audio);
  } catch {
    if (signal?.aborted) return silent;
    return browserFallback(trimmed, handlers, signal);
  }
  if (!await waitForAudio(context, handlers, signal) || signal?.aborted) return silent;

  const source = context.createBufferSource();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.buffer = buffer;
  source.connect(analyser);
  analyser.connect(context.destination);

  const samples = new Uint8Array(analyser.fftSize);
  let frame = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    signal?.removeEventListener("abort", stop);
    source.disconnect();
    analyser.disconnect();
    handlers.onLevel(0);
    handlers.onEnd();
  };
  const stop = () => {
    if (finished) return;
    source.onended = null;
    source.stop();
    finish();
  };
  const tick = () => {
    if (finished) return;
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const deviation = (sample - 128) / 128;
      sum += deviation * deviation;
    }
    handlers.onLevel(context.state === "running" ? Math.min(1, Math.sqrt(sum / samples.length) * 3) : 0);
    frame = requestAnimationFrame(tick);
  };

  signal?.addEventListener("abort", stop, { once: true });
  source.onended = finish;
  source.start();
  handlers.onProvider?.(speech.provider ?? "unknown");
  handlers.onStart?.();
  frame = requestAnimationFrame(tick);
  return { stop };
}
