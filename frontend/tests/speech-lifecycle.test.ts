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
