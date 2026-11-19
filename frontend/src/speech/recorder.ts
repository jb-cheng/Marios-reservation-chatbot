import { ApiError, transcribeAudio } from "@/api/client";

export type RecorderHandlers = {
  onStart: () => void;
  onTranscribing: () => void;
  onStop: () => void;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
  onUnavailable: () => void;
};

export type Recorder = {
  supported: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => void;
};

function pickMimeType(): string {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
    .find(type => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) ?? "";
}

export function createRecorder(handlers: RecorderHandlers): Recorder {
  const supported = typeof globalThis.MediaRecorder !== "undefined" && typeof globalThis.navigator?.mediaDevices?.getUserMedia === "function";
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let capture: AbortController | null = null;

  const release = () => {
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    recorder = null;
  };

  const start = async () => {
    if (!supported || capture !== null) return;
    const controller = new AbortController();
    capture = controller;
    let acquired: MediaStream;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (controller.signal.aborted) return;
      capture = null;
      handlers.onError("Microphone access was refused. Allow it in the browser, or switch to Text.");
      handlers.onStop();
      return;
    }
    if (controller.signal.aborted) {
      acquired.getTracks().forEach(track => track.stop());
      return;
    }
    stream = acquired;
    const chunks: Blob[] = [];
    const mimeType = pickMimeType();
    const instance = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder = instance;
    instance.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data); };
    instance.onstop = async () => {
      if (controller.signal.aborted) return;
      const blob = new Blob(chunks, { type: mimeType || instance.mimeType || "audio/webm" });
      release();
      if (controller.signal.aborted) return;
      if (blob.size === 0) {
        capture = null;
        handlers.onError("Nothing was recorded.");
        handlers.onStop();
        return;
      }
      handlers.onTranscribing();
      try {
        const text = await transcribeAudio(blob, controller.signal);
        if (controller.signal.aborted) return;
        capture = null;
        handlers.onStop();
        if (text.trim() === "") handlers.onError("I did not catch that. Could you say it again?");
        else handlers.onTranscript(text.trim());
      } catch (error) {
        if (controller.signal.aborted) return;
        capture = null;
        handlers.onStop();
        if (error instanceof ApiError && error.status === 502) handlers.onUnavailable();
        else handlers.onError("Transcription is unavailable right now. Switch to Text to keep planning.");
      }
    };
    instance.start();
    handlers.onStart();
  };

  const stop = async () => {
    if (recorder !== null && recorder.state !== "inactive") recorder.stop();
  };

  const cancel = () => {
    capture?.abort();
    capture = null;
    if (recorder !== null) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    release();
  };

  return { supported, start, stop, cancel };
}
