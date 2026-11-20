import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";

let vite: ViteDevServer;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null } });
});
after(async () => { await vite?.close(); });

function replaceGlobal(t: TestContext, key: string, value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
}

test("cancelled recognition cannot send a queued final result into a fresh draft", async t => {
  let aborted = 0;
  const instances: Recognition[] = [];
  class Recognition {
    onresult: any;
    onend: any;
    constructor() { instances.push(this); }
    start() {}
    stop() {}
    abort() { aborted++; }
  }
  replaceGlobal(t, "SpeechRecognition", Recognition);
  const { createRecognizer } = await vite.ssrLoadModule("/src/speech/stt.ts");
  const final: string[] = [];
  const recognizer = createRecognizer({ onInterim() {}, onFinal: (text: string) => final.push(text), onError() {}, onEnd() {} });
  recognizer.start();
  const queued = instances[0].onresult;
  assert.equal(typeof recognizer.cancel, "function");
  recognizer.cancel();
  queued({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "A table for 4" } }] });
  assert.equal(aborted, 1);
  assert.deepEqual(final, []);
});

test("cancelling a pending microphone permission releases the eventual stream without recording", async t => {
  let grant!: (stream: unknown) => void;
  let stopped = 0;
  let started = 0;
  class Recorder {
    static isTypeSupported() { return true; }
    start() { started++; }
  }
  replaceGlobal(t, "MediaRecorder", Recorder);
  replaceGlobal(t, "navigator", { mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } });
  const { createRecorder } = await vite.ssrLoadModule("/src/speech/recorder.ts");
  const recorder = createRecorder({ onStart() {}, onStop() {}, onTranscribing() {}, onTranscript() {}, onError() {}, onUnavailable() {} });
  const pending = recorder.start();
  assert.equal(typeof recorder.cancel, "function");
  recorder.cancel();
  grant({ getTracks: () => [{ stop: () => stopped++ }] });
  await pending;
  assert.equal(stopped, 1);
  assert.equal(started, 0);
});

test("cancelling active recording discards the utterance instead of uploading it", async t => {
  let stopped = 0;
  let uploads = 0;
  class Recorder {
    state = "inactive";
    mimeType = "audio/webm";
    onstop: any;
    ondataavailable: any;
    static isTypeSupported() { return true; }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["audio"]) });
      this.onstop?.();
    }
  }
  replaceGlobal(t, "MediaRecorder", Recorder);
  replaceGlobal(t, "navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped++ }] }) } });
  t.mock.method(globalThis, "fetch", async () => { uploads++; return new Response('{"text":"table for 4"}'); });
  const { createRecorder } = await vite.ssrLoadModule("/src/speech/recorder.ts");
  const recorder = createRecorder({ onStart() {}, onStop() {}, onTranscribing() {}, onTranscript() {}, onError() {}, onUnavailable() {} });
  await recorder.start();
  assert.equal(typeof recorder.cancel, "function");
  recorder.cancel();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, 1);
  assert.equal(uploads, 0);
});

function audioHarness(t: TestContext, state = "running") {
  const events: string[] = [];
  const levels: number[] = [];
  let frame: FrameRequestCallback | undefined;
  let sample = 128;
  const source = {
    buffer: null, onended: null as (() => void) | null,
    connect() {}, disconnect() { events.push("disconnect source"); },
    start() { events.push("play"); }, stop() { events.push("stop"); },
  };
  const context = new EventTarget() as EventTarget & Record<string, any>;
  Object.assign(context, {
    state, destination: {}, resume: async () => {},
    decodeAudioData: async () => ({}),
    createBufferSource: () => source,
    createAnalyser: () => ({
      fftSize: 512, frequencyBinCount: 256, connect() {},
      disconnect() { events.push("disconnect analyser"); },
      getByteTimeDomainData(samples: Uint8Array) { samples.fill(sample); },
    }),
  });
  replaceGlobal(t, "AudioContext", class { constructor() { return context; } });
  replaceGlobal(t, "requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
  replaceGlobal(t, "cancelAnimationFrame", () => { frame = undefined; });
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([0]), { headers: { "x-tts-provider": "elevenlabs" } }));
  vite.moduleGraph.invalidateAll();
  return {
    events, levels, context, source,
    handlers: {
      onStart: () => events.push("start"), onBlocked: () => events.push("blocked"),
      onEnd: () => events.push("end"), onError: (message: string) => events.push(message),
      onProvider: (provider: string) => events.push(provider), onLevel: (level: number) => levels.push(level),
    },
    tick(value: number) { sample = value; frame?.(0); },
  };
}

test("speech starts only with playback and waveform silence closes the mouth", async t => {
  const audio = audioHarness(t);
  const { speak } = await vite.ssrLoadModule("/src/speech/tts.ts");
  const playback = await speak("Hello", audio.handlers);
  assert.deepEqual(audio.events, ["play", "elevenlabs", "start"]);
  audio.tick(160);
  assert.ok(audio.levels.at(-1)! > 0);
  audio.tick(128);
  assert.equal(audio.levels.at(-1), 0);
  playback.stop();
  assert.equal(audio.levels.at(-1), 0);
  assert.ok(audio.events.includes("disconnect source"));
  assert.ok(audio.events.includes("disconnect analyser"));
  assert.equal(audio.events.filter(event => event === "end").length, 1);
});

test("autoplay suspension waits without pretending the host is speaking", async t => {
  const audio = audioHarness(t, "suspended");
  const { speak, unlockSpeechAudio } = await vite.ssrLoadModule("/src/speech/tts.ts");
  const pending = speak("Hello", audio.handlers);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(audio.events, ["blocked"]);
  assert.equal(typeof unlockSpeechAudio, "function");
  audio.context.resume = async () => {
    audio.context.state = "running";
    audio.context.dispatchEvent(new Event("statechange"));
  };
  unlockSpeechAudio();
  const playback = await pending;
  assert.deepEqual(audio.events, ["blocked", "play", "elevenlabs", "start"]);
  playback.stop();
});

test("muting while autoplay is blocked discards queued speech", async t => {
  const audio = audioHarness(t, "suspended");
  const { speak } = await vite.ssrLoadModule("/src/speech/tts.ts");
  const controller = new AbortController();
  const pending = speak("Hello", audio.handlers, controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(audio.events, ["blocked"]);
  controller.abort();
  await pending;
  audio.context.state = "running";
  audio.context.dispatchEvent(new Event("statechange"));
  assert.ok(!audio.events.includes("play"));
});

test("aborting active playback stops audio and releases its graph", async t => {
  const audio = audioHarness(t);
  const { speak } = await vite.ssrLoadModule("/src/speech/tts.ts");
  const controller = new AbortController();
  await speak("Hello", audio.handlers, controller.signal);
  audio.tick(160);
  controller.abort();
  assert.ok(audio.events.includes("stop"));
  assert.ok(audio.events.includes("disconnect analyser"));
  assert.equal(audio.levels.at(-1), 0);
});

test("cancelling while decoding prevents both playback and fallback", async t => {
  const audio = audioHarness(t);
  let decoded!: (buffer: object) => void;
  audio.context.decodeAudioData = () => new Promise(resolve => { decoded = resolve; });
  const { speak } = await vite.ssrLoadModule("/src/speech/tts.ts");
  const controller = new AbortController();
  const pending = speak("Hello", audio.handlers, controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  decoded({});
  await pending;
  assert.deepEqual(audio.events, []);
});

test("natural playback end closes the mouth and releases its graph exactly once", async t => {
  const audio = audioHarness(t);
  const { speak } = await vite.ssrLoadModule("/src/speech/tts.ts");
  const playback = await speak("Hello", audio.handlers);
  audio.tick(160);
  audio.source.onended?.();
  playback.stop();
  assert.equal(audio.levels.at(-1), 0);
  assert.equal(audio.events.filter(event => event === "end").length, 1);
  assert.equal(audio.events.filter(event => event === "disconnect source").length, 1);
});

test("browser fallback reports actual start and ignores boundaries after cancellation", async t => {
  let utterance: any;
  let cancelled = 0;
  const events: string[] = [];
  const levels: number[] = [];
  replaceGlobal(t, "SpeechSynthesisUtterance", class { constructor(_text: string) {} });
  replaceGlobal(t, "speechSynthesis", { speak(value: unknown) { utterance = value; }, cancel() { cancelled++; } });
  t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 502 }));
  const { speak } = await vite.ssrLoadModule("/src/speech/tts.ts");
  const controller = new AbortController();
  await speak("Hello there", {
    onStart: () => events.push("start"), onEnd: () => events.push("end"), onError() {},
    onProvider: (provider: string) => events.push(provider), onLevel: (level: number) => levels.push(level),
  }, controller.signal);
  assert.deepEqual(events, []);
  utterance.onstart();
  assert.deepEqual(events, ["browser", "start"]);
  utterance.onboundary({ name: "word" });
  assert.ok(levels.at(-1)! > 0);
  controller.abort();
  assert.equal(cancelled, 1);
  assert.equal(levels.at(-1), 0);
  utterance.onboundary?.({ name: "word" });
  assert.equal(levels.at(-1), 0);
});

test("an aborted spoken reply never falls back to browser audio", async t => {
  let resolve!: (response: Response) => void;
  let spoken = 0;
  t.mock.method(globalThis, "fetch", () => new Promise<Response>(done => { resolve = done; }));
  replaceGlobal(t, "speechSynthesis", { speak: () => spoken++, cancel() {} });
  replaceGlobal(t, "SpeechSynthesisUtterance", class { constructor(_text: string) {} });
  const { speak } = await vite.ssrLoadModule("/src/speech/tts.ts");
  const controller = new AbortController();
  const pending = speak("Old reservation reply", { onLevel() {}, onEnd() {}, onError() {} }, controller.signal);
  controller.abort();
  resolve(new Response("Unavailable", { status: 502 }));
  await pending;
  assert.equal(spoken, 0);
});
