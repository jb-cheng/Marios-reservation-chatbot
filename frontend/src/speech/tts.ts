/**
 * Spoken replies, and the amplitude that drives the avatar's mouth.
 *
 * Audio comes from the backend, which is the only place a voice API key can live.
 * It is decoded into an AudioBuffer rather than handed to an <audio> element, because
 * an AnalyserNode can only read samples it can see, and a media element does not
 * expose them. That is what makes the mouth follow the actual waveform instead of a
 * timer that happens to look plausible.
 */

import { synthesizeSpeech } from "@/api/client";

export type SpeakHandlers = {
  /** Zero to one, sampled per animation frame while audio plays. */
  onLevel: (level: number) => void;
  onEnd: () => void;
  onError: (message: string) => void;
};

export type SpeechPlayback = {
  stop: () => void;
};

let sharedContext: AudioContext | null = null;

/**
 * One AudioContext per page.
 *
 * Browsers cap how many may exist, and creating one per reply exhausts that limit
 * part way through a conversation. It is created lazily because constructing one
 * before a user gesture leaves it suspended in some browsers.
 */
function audioContext(): AudioContext | null {
  const Ctor =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;

  if (sharedContext === null) sharedContext = new Ctor();
  if (sharedContext.state === "suspended") {
    // Rejects when the browser is still waiting for a user gesture. Nothing to
    // recover from: the text is already on screen.
    sharedContext.resume().catch(() => undefined);
  }
  return sharedContext;
}

/** Last resort when the backend cannot produce audio: the browser's own voice.
 *  There is no decoded stream to analyse, so the caller gets no levels and the
 *  avatar falls back to its loop. A degraded visual is honest; a mouth that never
 *  moves while audio plays is not. */
function browserFallback(text: string, handlers: SpeakHandlers): SpeechPlayback {
  const synth = globalThis.speechSynthesis;
  if (!synth) {
    handlers.onError("This browser cannot speak the reply.");
    handlers.onEnd();
    return { stop: () => undefined };
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.onend = () => handlers.onEnd();
  utterance.onerror = () => handlers.onEnd();
  synth.speak(utterance);

  return {
    stop: () => {
      synth.cancel();
      handlers.onEnd();
    },
  };
}

export async function speak(
  text: string,
  handlers: SpeakHandlers,
): Promise<SpeechPlayback> {
  const trimmed = text.trim();
  if (trimmed === "") {
    handlers.onEnd();
    return { stop: () => undefined };
  }

  let audio: ArrayBuffer;
  try {
    audio = await synthesizeSpeech(trimmed);
  } catch {
    return browserFallback(trimmed, handlers);
  }

  const context = audioContext();
  if (context === null) return browserFallback(trimmed, handlers);

  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(audio);
  } catch {
    return browserFallback(trimmed, handlers);
  }

  const source = context.createBufferSource();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.6;

  source.buffer = buffer;
  source.connect(analyser);
  analyser.connect(context.destination);

  const samples = new Uint8Array(analyser.frequencyBinCount);
  let frame = 0;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    handlers.onLevel(0);
    handlers.onEnd();
  };

  const tick = () => {
    if (finished) return;
    analyser.getByteTimeDomainData(samples);

    // RMS of the waveform, scaled to roughly zero to one. Peak normalisation would
    // make a whisper look like a shout, which is the wrong signal for a mouth.
    let sum = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const deviation = (samples[index] - 128) / 128;
      sum += deviation * deviation;
    }
    handlers.onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 3));

    frame = requestAnimationFrame(tick);
  };

  source.onended = finish;
  source.start();
  frame = requestAnimationFrame(tick);

  return {
    stop: () => {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // Already finished.
      }
      finish();
    },
  };
}
