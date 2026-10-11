import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";

import {
  ApiError,
  fetchConfig,
  fetchSpeechCapabilities,
  postChat,
  submitReservation,
} from "@/api/client";
import type { SpeechCapabilities } from "@/api/client";
import { Avatar } from "@/components/Avatar";
import type { AvatarState } from "@/components/Avatar";
import { Composer } from "@/components/Composer";
import type { Suggestion } from "@/components/Composer";
import { ConfirmCard } from "@/components/ConfirmCard";
import { MessageList } from "@/components/MessageList";
import {
  ASSISTANT_NAME,
  PLACEHOLDER_CONFIG,
  initialMode,
} from "@/config";
import type { AgentMode } from "@/config";
import { createRecorder } from "@/speech/recorder";
import type { Recorder } from "@/speech/recorder";
import { createRecognizer, isSpeechRecognitionSupported } from "@/speech/stt";
import type { Recognizer } from "@/speech/stt";
import { speak } from "@/speech/tts";
import type { SpeechPlayback } from "@/speech/tts";
import { isAffirmation } from "@/state/confirmation";
import { isComplete, mergeSlots } from "@/state/merge";
import {
  browserStorage,
  clearDraft,
  purgeLegacyKeys,
  readState,
  toChatPayload,
  writeState,
} from "@/state/storage";
import type { KVStorage } from "@/state/storage";
import type {
  AvailabilityStatus,
  ChatMessage,
  Opening,
  ReservationState,
  RestaurantConfig,
  SubmitOutcome,
} from "@/state/types";
import { SLOT_KEYS, emptyState } from "@/state/types";

type Phase = "idle" | "sending" | "error";

type Confirmation = { submission_id: string; table_id: string };

/** Local calendar date, not UTC: a customer booking "tonight" at 11pm is not
 *  booking tomorrow. */
function localDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Whether the draft already holds anything. This is how a reload part way through a
 * booking is told apart from a first visit, now that the transcript no longer
 * survives a refresh to make that distinction obvious.
 */
function hasAnySlot(state: ReservationState): boolean {
  return SLOT_KEYS.some((key) => state[key] !== null);
}

function describeInvalid(outcome: Extract<SubmitOutcome, { kind: "invalid" }>): string {
  switch (outcome.error) {
    case "incomplete":
      return `The booking is still missing ${(outcome.missing ?? []).join(", ")}.`;
    case "date_invalid":
      return "That date is not one we can book. Please pick another day.";
    case "not_a_seating_time":
      return "That is not a seating time. Please pick a time within our opening hours.";
    case "party_size_invalid":
      return "That party size is outside what we can take online.";
    default:
      return `The booking was refused (${outcome.error}).`;
  }
}

export function ChatPanel({ store = browserStorage }: { store?: KVStorage }) {
  const [config, setConfig] = useState<RestaurantConfig | null>(null);
  const [state, setState] = useState<ReservationState>(() => readState(store));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [availability, setAvailability] = useState<AvailabilityStatus | null>(null);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [cardDismissed, setCardDismissed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [mode, setMode] = useState<AgentMode>(() => initialMode());
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [level, setLevel] = useState(0);
  const [speechCaps, setSpeechCaps] = useState<SpeechCapabilities | null>(null);
  const [lastTurnSpoken, setLastTurnSpoken] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // The latch behind criterion 7 and the brief's "never submit twice". A ref
  // rather than state, because two rapid clicks can both read a stale false
  // before either render lands.
  const submittingRef = useRef(false);
  const recognizerRef = useRef<Recognizer | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const playbackRef = useRef<SpeechPlayback | null>(null);
  const micSupported = isSpeechRecognitionSupported();

  const commitState = useCallback(
    (next: ReservationState) => {
      setState(next);
      writeState(store, next);
    },
    [store],
  );

  /**
   * The transcript lives in React state only, never in storage. See storage.ts for
   * the reasoning: it is where the customer's name, email and phone would otherwise
   * be persisted in plaintext, and the slot object is already everything the agent
   * needs to carry on without it.
   */
  const pushMessage = useCallback((message: ChatMessage) => {
    setMessages((previous) => [...previous, message]);
  }, []);

  // Runs once per visit so a transcript left behind by an earlier build is deleted
  // rather than merely ignored.
  useEffect(() => {
    purgeLegacyKeys(store);
  }, [store]);

  // What the server can do for voice mode. Asked rather than inferred, because
  // whether ElevenLabs is configured is a server-side fact and finding out in the
  // browser would mean shipping the key.
  useEffect(() => {
    let cancelled = false;

    fetchSpeechCapabilities()
      .then((caps) => {
        if (!cancelled) setSpeechCaps(caps);
      })
      .catch(() => {
        if (!cancelled) {
          setSpeechCaps({
            elevenlabs: false,
            tts_provider: "unavailable",
            server_stt: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Speak one assistant line, in voice mode only.
   *
   * Text mode stays silent on purpose: nobody wants a page reading itself aloud
   * when they are reading it, and it keeps the API cost out of the path that does
   * not need it. Any previous line is stopped first, so a fast exchange cannot
   * leave two replies talking over each other.
   */
  const speakReply = useCallback(
    (text: string) => {
      if (mode !== "voice") return;

      playbackRef.current?.stop();
      setSpeaking(true);

      void speak(text, {
        onLevel: setLevel,
        onEnd: () => {
          setSpeaking(false);
          setLevel(0);
          playbackRef.current = null;
        },
        onError: (message) => {
          setNotice(message);
          setSpeaking(false);
        },
      }).then((playback) => {
        playbackRef.current = playback;
      });
    },
    [mode],
  );

  // Built once. Transcripts are dispatched through sendRef, so a state change
  // mid-utterance cannot tear down a recording in progress.
  useEffect(() => {
    recorderRef.current = createRecorder({
      onStart: () => {
        setListening(true);
        setNotice(null);
      },
      onTranscribing: () => {
        setListening(false);
        setTranscribing(true);
      },
      onStop: () => {
        setListening(false);
        setTranscribing(false);
      },
      onTranscript: (text) => {
        setLastTurnSpoken(true);
        void sendRef.current(text, true);
      },
      onError: (message) => {
        setNotice(message);
        setListening(false);
        setTranscribing(false);
      },
      // A configured key that the provider rejects looks exactly like no key at
      // all from out here, so the capability is withdrawn for the rest of the
      // visit and the next tap goes to the browser's own recognition.
      onUnavailable: () => {
        setSpeechCaps((caps) => (caps === null ? caps : { ...caps, server_stt: false }));
        setNotice(
          "Server transcription is not responding, so the microphone will use this browser's recognition. Tap it again and say that once more.",
        );
      },
    });

    return () => {
      void recorderRef.current?.stop();
      recorderRef.current = null;
      playbackRef.current?.stop();
    };
  }, []);

  // Restaurant facts come from the server so opening hours have one source. Until
  // they arrive the composer stays disabled: the placeholder config closes every
  // day, which would reject every time a customer typed.
  useEffect(() => {
    let cancelled = false;

    fetchConfig()
      .then((loaded) => {
        if (!cancelled) setConfig(loaded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setNotice(
          error instanceof ApiError
            ? "Could not reach the reservation service. Details may not validate."
            : "Could not load the restaurant details.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // The first thing the customer sees. Gated on the config load so the greeting
  // names the actual restaurant rather than a fallback, and on an empty transcript
  // so it is seeded once rather than repeated on every render.
  //
  // After a refresh mid-booking the transcript is empty but the slots are not, and
  // a greeting would then be a lie. Say what actually happened instead, because an
  // unexplained empty conversation next to a half-filled summary reads as a bug.
  useEffect(() => {
    if (config === null || messages.length > 0 || state.submitted) return;

    const opening = hasAnySlot(state)
      ? "Welcome back. The details you gave me are still here, but the conversation itself is not kept across a refresh, so let us pick up where we left off."
      : `Hi, I'm ${ASSISTANT_NAME} at ${config.name}. Tell me the date, the time and how many of you, and I'll take it from there.`;

    pushMessage({ role: "assistant", content: opening });
    // Browsers block audio before a gesture, so on a first visit this may be
    // silent. The text is already on screen, which is the part that has to work.
    speakReply(opening);
  }, [config, messages.length, pushMessage, speakReply, state]);

  const confirmBooking = useCallback(
    async (current: ReservationState) => {
      if (submittingRef.current || current.submitted) return;

      submittingRef.current = true;
      setSubmitting(true);
      setSubmitError(null);

      try {
        const outcome = await submitReservation(store);

        switch (outcome.kind) {
          case "pending":
          case "already_submitted": {
            commitState({ ...current, submitted: true });
            setConfirmation({
              submission_id: outcome.submission_id,
              table_id: outcome.table_id,
            });
            setSuggestions([]);
            setCardDismissed(false);
            // The only line in the app that is allowed to say the booking exists,
            // and it runs after the server has accepted it.
            const receiptLine =
              outcome.kind === "already_submitted"
                ? "That booking was already submitted, so nothing was created twice."
                : `Booked. A receipt is on its way to ${current.email ?? "your email"}.`;
            pushMessage({ role: "assistant", content: receiptLine });
            speakReply(receiptLine);
            break;
          }
          case "slot_taken":
            setSubmitError(
              "That time was taken while we were talking. These are still free:",
            );
            setSuggestions(
              outcome.alternatives.map((item) => ({
                label: item.time,
                message: `Actually, ${item.time} works.`,
              })),
            );
            break;
          case "no_table":
            setSubmitError(
              `The largest table in the room seats ${outcome.largest_table}, so we cannot seat that party at one table. Please call us and the team will arrange the room.`,
            );
            break;
          case "invalid":
            setSubmitError(describeInvalid(outcome));
            break;
        }
      } catch (error) {
        setSubmitError(
          error instanceof ApiError
            ? `Could not submit the booking: ${error.message}`
            : "Could not submit the booking.",
        );
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [pushMessage, commitState, speakReply, store],
  );

  const send = useCallback(
    async (raw: string, spoken = false) => {
      const text = raw.trim();
      if (text === "" || state.submitted || phase === "sending") return;

      const activeConfig = config ?? PLACEHOLDER_CONFIG;
      const today = localDate();
      // Captured before the turn, so a spoken "yes" can only book a summary the
      // customer has already had a chance to see. Without this the model can return
      // submit on the same turn the last field arrives, and the booking lands while
      // the card is still animating in.
      const wasComplete = isComplete(state, activeConfig);
      // History without the new message: the server appends `message` itself, so
      // sending both would duplicate the turn in the prompt.
      const history = messages;

      pushMessage({ role: "user", content: text });
      setDraft("");
      setNotice(null);
      setSubmitError(null);
      setSuggestions([]);
      setPhase("sending");
      setLastTurnSpoken(spoken);

      try {
        const response = await postChat({
          state: toChatPayload(state),
          messages: history,
          message: text,
          current_date: today,
        });

        const merged = mergeSlots(state, response.slots, response.changed, {
          today,
          config: activeConfig,
          date: state.date,
        });

        // Decided before the reply is shown. Voice mode has no reliable click, so a
        // spoken yes is the confirmation, but only for a summary that was already on
        // screen before this turn and only when the customer's own words are an
        // unambiguous yes. Text mode always books from the card's button, and neither
        // mode lets the model book on the turn the last field arrives.
        const willBook =
          response.submit && mode === "voice" && wasComplete && isAffirmation(text);

        commitState(merged);
        // A turn that books does not also show the model's line. That line was
        // written before anything existed, so beside the confirmation it is at best
        // redundant and at worst asks the customer to confirm a booking that is
        // already made. confirmBooking always reports what happened, including when
        // the room said no.
        if (!willBook) {
          pushMessage({ role: "assistant", content: response.reply });
          speakReply(response.reply);
        }
        setAvailability(response.availability);
        setOpenings(response.openings ?? []);
        setSuggestions(
          response.availability?.state === "booked"
            ? response.availability.alternatives.map((item) => ({
                label: item.time,
                message: `Actually, ${item.time} works.`,
              }))
            : [],
        );
        setPhase("idle");

        if (willBook) {
          await confirmBooking(merged);
        }
      } catch (error) {
        pushMessage({
          role: "assistant",
          content:
            error instanceof ApiError
              ? `I could not reach the reservation service (${error.message}). Your details are saved, so we can pick up where we left off.`
              : "Something went wrong reaching the reservation service. Your details are saved.",
        });
        setPhase("error");
      }
    },
    [pushMessage, commitState, config, confirmBooking, messages, mode, phase, speakReply, state, store],
  );

  // The recognizer is built once and reads the latest send through a ref, so a
  // state change mid-utterance cannot tear down an in-flight session.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  useEffect(() => {
    recognizerRef.current = createRecognizer({
      onInterim: (text) => setDraft(text),
      onFinal: (text) => {
        setDraft("");
        setListening(false);
        void sendRef.current(text, true);
      },
      onError: (message) => {
        setNotice(message);
        setListening(false);
      },
      onEnd: () => setListening(false),
    });

    return () => {
      recognizerRef.current?.stop();
      recognizerRef.current = null;
    };
  }, []);

  const toggleMic = () => {
    const recorder = recorderRef.current;
    // Voice mode prefers the server transcriber, which is the only place an
    // ElevenLabs key can live. Everything else falls back to the browser's own
    // recognition, so the microphone is never a dead button.
    const useServer =
      mode === "voice" &&
      speechCaps?.server_stt === true &&
      recorder?.supported === true;

    if (useServer && recorder) {
      if (listening || transcribing) {
        void recorder.stop();
        return;
      }
      setNotice(null);
      void recorder.start();
      return;
    }

    const recognizer = recognizerRef.current;
    if (recognizer === null) return;

    if (!recognizer.supported) {
      setNotice(
        "This browser has no speech recognition and server transcription is not configured, so the microphone is unavailable. Typing works the same.",
      );
      return;
    }

    if (listening) {
      recognizer.stop();
      setListening(false);
      return;
    }

    setNotice(null);
    recognizer.start();
    setListening(true);
  };

  const changeMode = (next: AgentMode) => {
    // Held in component state only. A reload returns to the URL or build default,
    // which is what the A/B arms are defined by anyway.
    setMode(next);
  };

  const startOver = () => {
    clearDraft(store);
    setState(emptyState());
    setMessages([]);
    setAvailability(null);
    setOpenings([]);
    setSuggestions([]);
    setConfirmation(null);
    setSubmitError(null);
    setCardDismissed(false);
    setPhase("idle");
  };

  const activeConfig = config ?? PLACEHOLDER_CONFIG;
  const complete = isComplete(state, activeConfig);
  const showCard = complete && (!state.submitted || confirmation !== null);

  // Conflict alternatives take precedence, because they answer a question the
  // customer has already been asked. Otherwise, once a date is known and no time
  // is chosen, offer the room's real openings, so picking a time is a click on
  // something the engine says is free rather than a guess that gets refused.
  const chips: Suggestion[] =
    suggestions.length > 0
      ? suggestions
      : state.date !== null && state.time === null && !state.submitted
        ? openings.map((opening) => ({
            label: opening.time,
            message: `Let's do ${opening.time}.`,
          }))
        : [];
  const avatarState: AvatarState =
    phase === "error"
      ? "error"
      : phase === "sending"
        ? "thinking"
        : listening
          ? "listening"
          : speaking
            ? "speaking"
            : "idle";

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-start gap-4">
        <Avatar state={avatarState} level={level} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white/85">{ASSISTANT_NAME}</p>
          <p className="text-xs text-white/40">
            {state.submitted
              ? "This booking is confirmed. Start a new request below."
              : "Reservations, questions about the room, and nothing else."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 p-1">
          {(["text", "voice"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => changeMode(option)}
              aria-pressed={mode === option}
              className={
                mode === option
                  ? "rounded-full bg-amber-100/90 px-3 py-1 text-xs font-medium text-neutral-900"
                  : "rounded-full px-3 py-1 text-xs text-white/50 transition-colors hover:text-white/85"
              }
            >
              {option === "text" ? "Text" : "Voice"}
            </button>
          ))}
        </div>
      </div>

      <MessageList
        messages={messages}
        thinking={phase === "sending"}
        assistantName={ASSISTANT_NAME}
        lastTurnSpoken={lastTurnSpoken}
      />

      {showCard && (
        <ConfirmCard
          state={state}
          availability={availability}
          submitting={submitting}
          error={submitError}
          confirmation={confirmation}
          onConfirm={() => void confirmBooking(state)}
          onKeepEditing={() => setCardDismissed(true)}
        />
      )}

      {notice && (
        <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60">
          {notice}
        </p>
      )}

      {state.submitted ? (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
          <p className="text-xs text-white/45">
            This session is read-only now that the booking is in the queue.
          </p>
          <button
            type="button"
            onClick={startOver}
            className="flex items-center gap-2 rounded-lg border border-white/12 px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-white/25 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Start a new request
          </button>
        </div>
      ) : (
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => void send(draft)}
          busy={phase === "sending" || transcribing}
          disabled={config === null}
          mode={mode}
          listening={listening}
          micAvailable={micSupported || speechCaps?.server_stt === true}
          onToggleMic={toggleMic}
          suggestions={chips}
          onSuggestion={(message) => void send(message)}
          placeholder={
            config === null
              ? "Loading the restaurant details"
              : mode === "voice"
                ? "Tap the microphone and speak, or type"
                : "Table for four on Saturday at seven, for example"
          }
        />
      )}

      {!state.submitted && cardDismissed && (
        <button
          type="button"
          onClick={() => setCardDismissed(false)}
          className="self-start text-xs text-white/40 underline decoration-white/20 underline-offset-4 transition-colors hover:text-white/75"
        >
          Show the summary again
        </button>
      )}
    </div>
  );
}
