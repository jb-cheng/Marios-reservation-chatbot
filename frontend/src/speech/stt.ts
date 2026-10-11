/**
 * Speech to text through the Web Speech API.
 *
 * Chromium implements this and Firefox largely does not, which is why the text
 * composer always stays available and the mic button reports support rather than
 * failing silently. Capture needs a secure origin, so it works on localhost and
 * over HTTPS, and not on a plain http address.
 *
 * The ElevenLabs toggle is not here: a realtime voice API key must not ship in a
 * browser bundle, so that path goes through a backend proxy.
 */

type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type RecognitionErrorEvent = { error: string; message?: string };

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type RecognitionConstructor = new () => RecognitionLike;

function constructorFromWindow(): RecognitionConstructor | null {
  const candidate = (globalThis as unknown as Record<string, unknown>)[
    "SpeechRecognition"
  ] ??
    (globalThis as unknown as Record<string, unknown>)["webkitSpeechRecognition"];

  return typeof candidate === "function"
    ? (candidate as RecognitionConstructor)
    : null;
}

export function isSpeechRecognitionSupported(): boolean {
  return constructorFromWindow() !== null;
}

export type SpeechHandlers = {
  /** Partial transcript, shown live while the customer is still talking. */
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
};

export type Recognizer = {
  start: () => void;
  stop: () => void;
  supported: boolean;
};

export function createRecognizer(
  handlers: SpeechHandlers,
  options: { lang?: string } = {},
): Recognizer {
  const Constructor = constructorFromWindow();

  if (Constructor === null) {
    return {
      supported: false,
      start: () => handlers.onError("Speech recognition is not available here."),
      stop: () => undefined,
    };
  }

  let recognition: RecognitionLike | null = null;
  let stoppedByCaller = false;

  const start = () => {
    if (recognition !== null) return;

    const instance = new Constructor();
    instance.lang = options.lang ?? "en-CA";
    instance.continuous = false;
    instance.interimResults = true;
    stoppedByCaller = false;

    instance.onresult = (event) => {
      let interim = "";
      let final = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }

      if (interim) handlers.onInterim(interim);
      if (final.trim()) handlers.onFinal(final.trim());
    };

    instance.onerror = (event) => {
      // "no-speech" and "aborted" are ordinary endings of a mic session, not
      // faults worth showing the customer.
      if (event.error === "no-speech" || event.error === "aborted") return;
      handlers.onError(describeError(event.error));
    };

    instance.onend = () => {
      recognition = null;
      if (!stoppedByCaller) handlers.onEnd();
    };

    recognition = instance;

    try {
      instance.start();
    } catch {
      // start() throws if a session is already running in this tab.
      recognition = null;
    }
  };

  const stop = () => {
    stoppedByCaller = true;
    recognition?.stop();
    recognition = null;
    handlers.onEnd();
  };

  return { supported: true, start, stop };
}

function describeError(error: string): string {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow it in the browser to speak to the assistant.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Speech recognition could not reach its service. Typing still works.";
    default:
      return `Speech recognition stopped (${error}).`;
  }
}
