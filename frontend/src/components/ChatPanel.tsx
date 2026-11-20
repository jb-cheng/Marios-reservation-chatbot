import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { RotateCcw } from "lucide-react";

import { ApiError, fetchSpeechCapabilities, postChat, submitReservation } from "@/api/client";
import type { SpeechCapabilities } from "@/api/client";
import type { AvatarState } from "@/components/Avatar";
import { Composer } from "@/components/Composer";
import type { Suggestion } from "@/components/Composer";
import { ConfirmCard } from "@/components/ConfirmCard";
import { EveningPanel } from "@/components/EveningPanel";
import { HostCard } from "@/components/HostCard";
import { MessageList } from "@/components/MessageList";
import { PipDeck } from "@/components/PipDeck";
import { ASSISTANT_NAME, PLACEHOLDER_CONFIG, initialMode } from "@/config";
import type { AgentMode } from "@/config";
import { useRestaurantConfig } from "@/hooks/use-restaurant-config";
import { createRecorder } from "@/speech/recorder";
import type { Recorder } from "@/speech/recorder";
import { createRecognizer, isSpeechRecognitionSupported } from "@/speech/stt";
import type { Recognizer } from "@/speech/stt";
import { speak, unlockSpeechAudio } from "@/speech/tts";
import type { SpeechPlayback } from "@/speech/tts";
import { isAffirmation } from "@/state/confirmation";
import { isComplete, mergeSlots } from "@/state/merge";
import { detectPipGroups } from "@/state/pips";
import { STATE_KEY, browserStorage, clearDraft, purgeLegacyKeys, readState, toChatPayload, writeState } from "@/state/storage";
import type { KVStorage } from "@/state/storage";
import type { ChatMessage, Opening, ReservationState, SubmitOutcome } from "@/state/types";
import { SLOT_KEYS, emptyState } from "@/state/types";

type Phase = "idle" | "sending" | "error";
type Confirmation = { submission_id: string; table_id: string };

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function hasAnySlot(state: ReservationState): boolean {
  return SLOT_KEYS.some((key) => state[key] !== null);
}

function describeInvalid(outcome: Extract<SubmitOutcome, { kind: "invalid" }>): string {
  switch (outcome.error) {
    case "incomplete": return `The booking is still missing ${(outcome.missing ?? []).join(", ")}.`;
    case "date_invalid": return "That date is not one we can book. Please pick another day.";
    case "not_a_seating_time": return "That is not a seating time. Please pick a time within our opening hours.";
    case "party_size_invalid": return "That party size is outside what we can take online.";
    default: return `The booking was refused (${outcome.error}).`;
  }
}

const VOICE_LABELS: Record<string, string> = {
  elevenlabs: "ElevenLabs",
  "edge-tts": "Edge TTS, because ElevenLabs did not answer",
  browser: "this browser, because the server produced no audio",
};

export function ChatPanel({ store = browserStorage }: { store?: KVStorage }) {
  const { config, error: configError } = useRestaurantConfig();
  const [state, setState] = useState<ReservationState>(() => readState(store));
  const [dialog, setDialog] = useState<"resume" | "reset" | null>(() => state.submitted || hasAnySlot(state) ? "resume" : null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [mode, setMode] = useState<AgentMode>(() => initialMode());
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const soundEnabledRef = useRef(true);
  const [level, setLevel] = useState(0);
  const [voiceProvider, setVoiceProvider] = useState<string | null>(null);
  const [speechCaps, setSpeechCaps] = useState<SpeechCapabilities | null>(null);
  const [lastTurnSpoken, setLastTurnSpoken] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submittingRef = useRef(false);
  const conversationRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const audioRequestRef = useRef<AbortController | null>(null);
  const recognizerRef = useRef<Recognizer | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const playbackRef = useRef<SpeechPlayback | null>(null);
  const modeRef = useRef(mode);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const micSupported = isSpeechRecognitionSupported();
  const recordingSupported = typeof globalThis.MediaRecorder !== "undefined" && typeof globalThis.navigator?.mediaDevices?.getUserMedia === "function";

  const commitState = useCallback((next: ReservationState) => {
    setState(next);
    writeState(store, next);
  }, [store]);

  const pushMessage = useCallback((message: ChatMessage) => {
    setMessages(previous => [...previous, message]);
  }, []);

  const stopAudio = useCallback(() => {
    audioRequestRef.current?.abort();
    playbackRef.current?.stop();
    playbackRef.current = null;
    setSpeaking(false);
    setAudioBlocked(false);
    setLevel(0);
  }, []);

  const stopCapture = useCallback(() => {
    recorderRef.current?.cancel();
    recognizerRef.current?.cancel();
    setListening(false);
    setTranscribing(false);
  }, []);

  const speakReply = useCallback((text: string) => {
    if (!soundEnabledRef.current) return;
    stopAudio();
    setVoiceProvider(null);
    const controller = new AbortController();
    audioRequestRef.current = controller;
    void speak(text, {
      onLevel: value => { if (!controller.signal.aborted) setLevel(value); },
      onProvider: provider => { if (!controller.signal.aborted) setVoiceProvider(provider); },
      onStart: () => { if (!controller.signal.aborted) { setSpeaking(true); setAudioBlocked(false); } },
      onBlocked: () => { if (!controller.signal.aborted) setAudioBlocked(true); },
      onEnd: () => { if (!controller.signal.aborted) { setSpeaking(false); setAudioBlocked(false); setLevel(0); } },
      onError: message => { if (!controller.signal.aborted) { setNotice(message); setSpeaking(false); setAudioBlocked(false); } },
    }, controller.signal).then(playback => {
      if (controller.signal.aborted) playback.stop();
      else playbackRef.current = playback;
    });
  }, [stopAudio]);

  useEffect(() => { purgeLegacyKeys(store); }, [store]);

  useEffect(() => {
    let active = true;
    fetchSpeechCapabilities().then(caps => { if (active) setSpeechCaps(caps); }).catch(() => {
      if (active) setSpeechCaps({ elevenlabs: false, tts_provider: "unavailable", server_stt: false });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (dialog && !element.open) element.showModal();
    if (!dialog && element.open) element.close();
  }, [dialog]);

  useEffect(() => {
    if (config === null || dialog !== null || messages.length > 0 || state.submitted || phase !== "idle") return;
    const opening = `Hi, I'm ${ASSISTANT_NAME} at ${config.name}. Tell me the date, the time and how many of you, and I'll take it from there.`;
    pushMessage({ role: "assistant", content: opening });
    speakReply(opening);
  }, [config, dialog, messages.length, phase, pushMessage, speakReply, state.submitted]);

  const confirmBooking = useCallback(async (current: ReservationState) => {
    if (submittingRef.current || current.submitted) return;
    submittingRef.current = true;
    const conversation = conversationRef.current;
    setSubmitting(true);
    setSubmitError(null);
    stopCapture();
    try {
      const outcome = await submitReservation(store);
      if (conversation !== conversationRef.current) return;
      switch (outcome.kind) {
        case "pending":
        case "already_submitted": {
          commitState({ ...current, submitted: true });
          setConfirmation({ submission_id: outcome.submission_id, table_id: outcome.table_id });
          setSuggestions([]);
          const line = outcome.kind === "already_submitted"
            ? "That booking was already submitted, so nothing was created twice."
            : `Booked. A receipt is on its way to ${current.email ?? "your email"}.`;
          pushMessage({ role: "assistant", content: line });
          speakReply(line);
          break;
        }
        case "slot_taken":
          setSubmitError("That time was taken while we were talking. Choose one of the available alternatives.");
          setSuggestions(outcome.alternatives.map(item => ({ label: item.time, message: `Actually, ${item.time} works.` })));
          break;
        case "no_table":
          setSubmitError(`The largest table seats ${outcome.largest_table}. Please call us to arrange a larger party.`);
          break;
        case "invalid": setSubmitError(describeInvalid(outcome)); break;
      }
    } catch (error) {
      if (conversation !== conversationRef.current) return;
      setSubmitError(error instanceof ApiError ? `Could not submit the booking: ${error.message}` : "Could not submit the booking.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [commitState, pushMessage, speakReply, stopCapture, store]);

  const send = useCallback(async (raw: string, spoken = false, current = state, resume = false) => {
    const text = raw.trim();
    if (!text || current.submitted || requestRef.current || submittingRef.current || (dialog === "resume" && !resume)) return;
    const activeConfig = config ?? PLACEHOLDER_CONFIG;
    const today = localDate();
    const wasComplete = isComplete(current, activeConfig);
    const voiceTurn = spoken && modeRef.current === "voice";
    const controller = new AbortController();
    requestRef.current = controller;
    const history = resume ? [] : messages;
    pushMessage({ role: "user", content: resume ? "Continue my reservation." : text });
    setDraft("");
    setNotice(null);
    setSubmitError(null);
    setSuggestions([]);
    setPhase("sending");
    setLastTurnSpoken(spoken);
    stopAudio();
    try {
      const response = await postChat({ state: toChatPayload(current), messages: history, message: text, current_date: today }, controller.signal);
      if (controller.signal.aborted) return;
      // Continuing supplies no new slot values, so it cannot change the saved answers.
      const merged = resume ? current : mergeSlots(current, response.slots, response.changed, { today, config: activeConfig, date: current.date });
      const willBook = !resume && voiceTurn && response.submit && modeRef.current === "voice" && wasComplete && isAffirmation(text);
      commitState(merged);
      setOpenings(response.openings ?? []);
      setSuggestions(response.availability?.state === "booked"
        ? response.availability.alternatives.map(item => ({ label: item.time, message: `Actually, ${item.time} works.` })) : []);
      if (!willBook) {
        pushMessage({ role: "assistant", content: response.reply });
        speakReply(response.reply);
      }
      setPhase("idle");
      if (willBook) await confirmBooking(merged);
    } catch (error) {
      if (controller.signal.aborted) return;
      pushMessage({ role: "assistant", content: error instanceof ApiError
        ? `I could not reach the reservation service (${error.message}). Your details are saved. Please try again.`
        : "Something went wrong reaching the reservation service. Your details are saved. Please try again." });
      setPhase("error");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [commitState, config, confirmBooking, dialog, messages, pushMessage, speakReply, state, stopAudio]);

  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; }, [send]);

  useEffect(() => {
    recorderRef.current = createRecorder({
      onStart: () => { setListening(true); setNotice(null); },
      onTranscribing: () => { setListening(false); setTranscribing(true); },
      onStop: () => { setListening(false); setTranscribing(false); },
      onTranscript: text => { void sendRef.current(text, true); },
      onError: message => { setNotice(message); setListening(false); setTranscribing(false); },
      onUnavailable: () => {
        setSpeechCaps(caps => caps === null ? caps : { ...caps, server_stt: false });
        setNotice("Server transcription is not responding. Tap the microphone again to use this browser's recognition, or switch to Text.");
      },
    });
    recognizerRef.current = createRecognizer({
      onInterim: setDraft,
      onFinal: text => { setDraft(""); setListening(false); void sendRef.current(text, true); },
      onError: message => { setNotice(message); setListening(false); },
      onEnd: () => setListening(false),
    });
    return () => {
      conversationRef.current++;
      recorderRef.current?.cancel();
      recognizerRef.current?.cancel();
      requestRef.current?.abort();
      requestRef.current = null;
      audioRequestRef.current?.abort();
      playbackRef.current?.stop();
    };
  }, []);

  const clearConversation = useCallback(() => {
    conversationRef.current++;
    requestRef.current?.abort();
    requestRef.current = null;
    stopCapture();
    stopAudio();
    setDraft("");
    setMessages([]);
    setOpenings([]);
    setSuggestions([]);
    setConfirmation(null);
    setSubmitError(null);
    setNotice(null);
    setLastTurnSpoken(false);
    setPhase("idle");
  }, [stopAudio, stopCapture]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== STATE_KEY) return;
      const next = readState(store);
      clearConversation();
      setState(next);
      setDialog(hasAnySlot(next) || next.submitted ? "resume" : null);
    };
    globalThis.addEventListener("storage", onStorage);
    return () => globalThis.removeEventListener("storage", onStorage);
  }, [clearConversation, store]);

  const toggleMic = () => {
    if (requestRef.current || submittingRef.current || transcribing || dialog) return;
    stopAudio();
    const recorder = recorderRef.current;
    const useServer = mode === "voice" && speechCaps?.server_stt === true && recorder?.supported;
    if (useServer && recorder) {
      if (listening) void recorder.stop();
      else { setNotice(null); void recorder.start(); }
    } else if (listening) {
      recognizerRef.current?.stop();
      setListening(false);
    } else {
      setNotice(null);
      recognizerRef.current?.start();
      setListening(micSupported);
    }
  };

  const changeMode = (next: AgentMode) => {
    if (next === mode) return;
    stopCapture();
    if (listening) setDraft("");
    modeRef.current = next;
    setMode(next);
  };

  const unlockFromInteraction = (event: KeyboardEvent | PointerEvent) => {
    const soundControl = (event.target as Element).closest("[data-sound-toggle]");
    if (soundControl && (!("key" in event) || event.key === "Enter" || event.key === " ")) {
      // Cancel before a mute gesture can release the browser's pending autoplay permission.
      if (soundEnabledRef.current) stopAudio();
      return;
    }
    if (soundEnabledRef.current) unlockSpeechAudio();
  };

  const toggleSound = () => {
    const enabled = !soundEnabledRef.current;
    soundEnabledRef.current = enabled;
    setSoundEnabled(enabled);
    if (!enabled) {
      stopAudio();
      return;
    }
    unlockSpeechAudio();
    const last = messages.at(-1);
    if (last?.role === "assistant" && !busy && !listening && dialog === null) speakReply(last.content);
  };

  const startOver = () => {
    if (submittingRef.current) return;
    clearConversation();
    clearDraft(store);
    setState(emptyState());
    setDialog(null);
  };

  const continueReservation = () => {
    if (!config) return;
    setDialog(null);
    if (state.submitted) {
      pushMessage({ role: "assistant", content: "This reservation was already submitted. Your saved booking details are shown here. Start a new reservation if you would like another table; that will not cancel this booking." });
      return;
    }
    const restored = mergeSlots(emptyState(), state, [], { today: localDate(), config, date: null });
    if (state.date !== null && restored.date === null) restored.time = null;
    commitState(restored);
    void send("Continue my reservation using the saved details. Ask for the next missing required detail, or ask me to confirm the summary if those details are complete. Recheck the room before offering times.", false, restored, true);
  };

  const activeConfig = config ?? PLACEHOLDER_CONFIG;
  const complete = isComplete(state, activeConfig);
  const busy = phase === "sending" || transcribing || submitting;
  const lastReply = [...messages].reverse().find(message => message.role === "assistant")?.content ?? null;
  const pipGroups = suggestions.length ? [] : detectPipGroups({ reply: lastReply, state, config: activeConfig, openings, today: localDate() });
  const avatarState: AvatarState = phase === "error" ? "error" : busy ? "thinking" : listening ? "listening" : speaking ? "speaking" : "idle";
  const alert = notice ?? configError;

  return (
    <div className="reservation-workspace" onPointerDownCapture={unlockFromInteraction} onKeyDownCapture={unlockFromInteraction}>
      <HostCard avatar={avatarState} level={level} mode={mode} onModeChange={changeMode}
        soundEnabled={soundEnabled} audioBlocked={audioBlocked} onToggleSound={toggleSound}
        voiceProvider={voiceProvider !== null ? VOICE_LABELS[voiceProvider] ?? voiceProvider : null} />
      <section aria-label="Plan your reservation" className="reservation-card rounded-md border border-linen-300 bg-paper shadow-card">
        <header className="reservation-card-header flex items-center justify-between gap-4 border-b border-linen-300">
          <div>
            <p className="eyebrow text-ink-400">Your reservation</p>
            <h2 className="display text-[27px] leading-8 text-ink">Let&rsquo;s plan your visit</h2>
          </div>
          <button type="button" disabled={submitting} onClick={() => { stopCapture(); stopAudio(); setDialog("reset"); }}
            className="flex min-h-11 shrink-0 items-center gap-2 rounded-[4px] px-2 text-[12px] text-ink-400 hover:bg-linen hover:text-ink disabled:opacity-40">
            <RotateCcw className="h-3.5 w-3.5" /> Start over
          </button>
        </header>
        <div className="reservation-body">
          <div className="conversation-column">
            <MessageList messages={messages} thinking={phase === "sending"} assistantName={ASSISTANT_NAME} lastTurnSpoken={lastTurnSpoken} />
            {alert && <p role="status" className="rounded-[4px] border border-brass/35 bg-brass/[0.07] px-3 py-2 text-[12px] leading-4 text-brass">{alert}</p>}
            {state.submitted ? (
              <p className="rounded-[4px] border border-linen-300 bg-linen px-4 py-3 text-[12px] leading-5 text-ink-400">This booking has been submitted. Start over to plan another visit.</p>
            ) : (
              <>
                <PipDeck groups={dialog === "resume" ? [] : pipGroups} state={state} busy={busy || listening} disabled={config === null || dialog !== null} onSend={message => void send(message)} />
                <Composer value={draft} onChange={setDraft} onSend={() => void send(draft)} busy={busy} disabled={config === null || dialog !== null}
                  mode={mode} listening={listening} transcribing={transcribing}
                  micAvailable={micSupported || (mode === "voice" && speechCaps?.server_stt === true && recordingSupported)}
                  onToggleMic={toggleMic} suggestions={suggestions} onSuggestion={message => void send(message)}
                  placeholder={config === null ? "Loading the restaurant details" : "Tell me in your own words…"} />
              </>
            )}
          </div>
          <EveningPanel state={state} config={activeConfig} confirmation={confirmation}>
            {submitError && <p role="alert" className="mb-2 text-[12px] leading-4 text-brick">{submitError}</p>}
            {complete && !state.submitted && dialog === null && (
              <ConfirmCard submitting={submitting} disabled={busy || listening || config === null}
                onConfirm={() => void confirmBooking(state)}
                onKeepEditing={() => { changeMode("text"); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.focus()); }} />
            )}
          </EveningPanel>
        </div>
      </section>
      <dialog ref={dialogRef} aria-labelledby="reservation-dialog-heading"
        onCancel={event => { if (dialog === "resume") event.preventDefault(); else setDialog(null); }}
        className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-md border border-linen-300 bg-paper p-6 text-ink shadow-card backdrop:bg-ink/45 backdrop:backdrop-blur-sm">
        <p className="eyebrow text-ink-400">Your reservation</p>
        <h2 id="reservation-dialog-heading" className="display mt-2 text-[30px] leading-9">{dialog === "resume" ? "Continue your reservation?" : "Start a new reservation?"}</h2>
        <p className="mt-3 text-[14px] leading-6 text-ink-400">
          {dialog === "resume"
            ? state.submitted ? "You have a submitted booking saved in this browser. View it or start planning a new visit."
              : "Your reservation details are saved in this browser. Pick up where you left off, or clear them and start fresh."
            : "This clears the conversation and saved details so you can start fresh."}
          {state.submitted && " Starting fresh does not cancel your existing booking."}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" disabled={config === null || submitting} onClick={dialog === "resume" ? continueReservation : () => setDialog(null)}
            className="min-h-11 rounded-[4px] bg-ink px-5 text-[13px] text-linen hover:bg-ink-600 disabled:opacity-40">
            {dialog === "resume" ? state.submitted ? "View booking" : "Continue" : "Keep planning"}
          </button>
          <button type="button" disabled={submitting} onClick={startOver}
            className="min-h-11 rounded-[4px] border border-linen-300 px-5 text-[13px] hover:bg-linen disabled:opacity-40">Start fresh</button>
        </div>
      </dialog>
    </div>
  );
}
