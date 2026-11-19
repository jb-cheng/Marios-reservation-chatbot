import type { KeyboardEvent } from "react";
import { ArrowRight, LoaderIcon, Mic, MicOff, Square } from "lucide-react";

import type { AgentMode } from "@/config";
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea";
import { cn } from "@/lib/utils";

export type Suggestion = { label: string; message: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  busy: boolean;
  disabled: boolean;
  mode: AgentMode;
  listening: boolean;
  transcribing: boolean;
  micAvailable: boolean;
  onToggleMic: () => void;
  suggestions: Suggestion[];
  onSuggestion: (message: string) => void;
  placeholder: string;
};

export function Composer({ value, onChange, onSend, busy, disabled, mode, listening,
  transcribing, micAvailable, onToggleMic, suggestions, onSuggestion, placeholder }: Props) {
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({ minHeight: 52, maxHeight: 100 });
  const canSend = value.trim().length > 0 && !busy && !disabled && !listening;
  const micDisabled = !micAvailable || disabled || (busy && !listening);
  const micLabel = listening ? "Stop listening" : "Start speaking";

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <div className="composer min-w-0 shrink-0 space-y-2">
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Available alternatives">
          <span className="eyebrow text-brick">Still free</span>
          {suggestions.map((suggestion) => (
            <button key={suggestion.label} type="button" disabled={disabled || busy}
              onClick={() => onSuggestion(suggestion.message)}
              className="min-h-11 rounded-[4px] border border-brick/40 bg-brick/[0.06] px-3 text-[13px] text-brick hover:bg-brick/[0.12] disabled:opacity-40">
              {suggestion.label}
            </button>
          ))}
        </div>
      )}

      {mode === "voice" ? (
        <div>
          <button type="button" onClick={onToggleMic} disabled={micDisabled}
            aria-pressed={listening} aria-label={micLabel}
            className={cn("voice-composer flex min-h-[112px] w-full flex-col items-center justify-center gap-2 rounded-[4px] border px-4 py-4 transition-colors disabled:cursor-not-allowed",
              listening ? "border-terracotta bg-terracotta/10 text-terracotta" : "border-gold/60 bg-linen text-ink hover:border-gold hover:bg-linen-200",
              micDisabled && "opacity-60")}>
            {busy ? <LoaderIcon className="h-8 w-8 animate-spin" />
              : !micAvailable ? <MicOff className="h-8 w-8" />
                : listening ? <Square className="h-8 w-8" /> : <Mic className="h-8 w-8" />}
            <span className="text-[15px] font-medium">
              {transcribing ? "Transcribing…" : busy ? "Mario is thinking…" : listening ? "Listening. Tap to finish" : micAvailable ? "Tap to speak" : "Microphone unavailable"}
            </span>
            <span className="text-[12px] leading-4">
              {listening && value ? value : !micAvailable ? "Switch to Text to keep planning." : "Your words appear in the conversation."}
            </span>
          </button>
        </div>
      ) : (
        <div className={cn("rounded-[4px] border bg-paper", listening ? "border-terracotta" : "border-linen-300 focus-within:border-ink-400")}>
          <textarea ref={textareaRef} value={value} disabled={disabled || busy || listening}
            onChange={(event) => { onChange(event.target.value); adjustHeight(); }}
            onKeyDown={handleKeyDown} placeholder={placeholder} aria-label="Message" rows={1}
            className="block w-full resize-none bg-transparent px-3.5 py-3 text-[14px] leading-5 text-ink placeholder:text-ink-400 focus:outline-none disabled:opacity-50" />
          <div className="flex items-center justify-between gap-3 border-t border-linen-300 px-2 py-1.5">
            <div className="flex items-center gap-2">
              <button type="button" onClick={onToggleMic} disabled={micDisabled}
                aria-pressed={listening} aria-label={micLabel}
                title={micAvailable ? "Dictate a message" : "Speech recognition is not supported in this browser"}
                className={cn("flex h-11 w-11 items-center justify-center rounded-[4px] border transition-colors disabled:opacity-35",
                  listening ? "border-terracotta text-terracotta" : "border-linen-300 text-ink-400 hover:text-ink")}>
                {micAvailable ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              </button>
              <span className="text-[11px] text-ink-400">{listening ? "Listening" : "Enter to send"}</span>
            </div>
            <button type="button" onClick={onSend} disabled={!canSend}
              className="flex h-11 items-center gap-2 rounded-[4px] bg-ink px-4 text-[13px] text-linen hover:bg-ink-600 disabled:cursor-not-allowed disabled:bg-linen-200 disabled:text-ink-400">
              {busy ? <LoaderIcon className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
