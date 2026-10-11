/**
 * Push to talk, transcribed on the server.
 *
 * Recording is done in the browser and transcription is not, because the only
 * transcription provider configured here needs an API key and a key cannot ship in a
 * bundle. A whole utterance is sent rather than streamed: a reservation sentence is
 * a few seconds long, and a websocket proxy would add reconnection logic and partial
 * transcript state for no benefit the customer can feel.
 *
 * The microphone track is stopped as soon as recording ends. Leaving it open keeps
 * the browser's recording indicator lit for the rest of the session, which reads as
 * surveillance even when nothing is being captured.
 */

import { ApiError, transcribeAudio } from "@/api/client";

export type RecorderHandlers = {
  onStart: () => void;
  onTranscribing: () => void;
  onStop: () => void;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
  /**
   * The server said its transcriber is not usable, which includes a rejected API
   * key. Kept apart from `onError` so the caller can stop asking for something
   * that cannot succeed and use the browser's own recognition instead.
   */
  onUnavailable: () => void;
};

export type Recorder = {
  supported: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  const supported = candidates.find(
    (candidate) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate),
  );
  return supported ?? "";
}

export function createRecorder(handlers: RecorderHandlers): Recorder {
  const supported =
    typeof globalThis.MediaRecorder !== "undefined" &&
    typeof globalThis.navigator?.mediaDevices?.getUserMedia === "function";

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];

  const release = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    recorder = null;
  };

  const start = async () => {
    if (!supported || recorder !== null) return;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      handlers.onError(
        "Microphone access was refused. Allow it in the browser, or type instead.",
      );
      handlers.onStop();
      return;
    }

    chunks = [];
    const mimeType = pickMimeType();
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recorder.onstop = async () => {
      const type = mimeType || recorder?.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type });
      release();
      chunks = [];

      if (blob.size === 0) {
        handlers.onError("Nothing was recorded.");
        handlers.onStop();
        return;
      }

      handlers.onTranscribing();
      try {
        const text = await transcribeAudio(blob);
        handlers.onStop();
        if (text.trim() === "") {
          handlers.onError("I did not catch that. Could you say it again?");
          return;
        }
        handlers.onTranscript(text.trim());
      } catch (error) {
        handlers.onStop();
        if (error instanceof ApiError && error.status === 502) {
          handlers.onUnavailable();
          return;
        }
        handlers.onError(
          "Transcription is unavailable right now. Typing still works.",
        );
      }
    };

    recorder.start();
    handlers.onStart();
  };

  const stop = async () => {
    if (recorder !== null && recorder.state !== "inactive") recorder.stop();
  };

  return { supported, start, stop };
}
