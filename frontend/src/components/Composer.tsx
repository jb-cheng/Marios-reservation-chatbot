import type { KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { LoaderIcon, Mic, MicOff, SendIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea";
import type { AgentMode } from "@/config";

export type Suggestion = {
  label: string;
  message: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  busy: boolean;
  disabled: boolean;
  mode: AgentMode;
  listening: boolean;
  micAvailable: boolean;
  onToggleMic: () => void;
  suggestions: Suggestion[];
  onSuggestion: (message: string) => void;
  placeholder: string;
};

export function Composer({
  value,
  onChange,
  onSend,
  busy,
  disabled,
  mode,
  listening,
  micAvailable,
  onToggleMic,
  suggestions,
  onSuggestion,
  placeholder,
}: Props) {
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight: 56,
    maxHeight: 180,
  });

  const canSend = value.trim().length > 0 && !busy && !disabled;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <div className="space-y-3">
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.label}
              type="button"
              disabled={disabled || busy}
              onClick={() => onSuggestion(suggestion.message)}
              className="rounded-full border border-amber-200/25 bg-amber-200/[0.06] px-3 py-1.5 text-xs text-amber-100/85 transition-colors hover:border-amber-200/50 hover:bg-amber-200/[0.12] disabled:opacity-40"
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] backdrop-blur-xl">
        <textarea
          ref={textareaRef}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value);
            adjustHeight();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Message"
          rows={1}
          className={cn(
            "w-full resize-none bg-transparent px-4 pt-3.5 text-sm text-white/90",
            "placeholder:text-white/25 focus:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        />

        <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleMic}
              disabled={!micAvailable || disabled}
              aria-pressed={listening}
              aria-label={listening ? "Stop listening" : "Start speaking"}
              title={
                micAvailable
                  ? mode === "voice"
                    ? "Voice input"
                    : "Voice input is available in either mode"
                  : "Speech recognition is not supported in this browser"
              }
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
                listening
                  ? "border-rose-300/40 bg-rose-400/15 text-rose-100"
                  : "border-white/10 text-white/45 hover:border-white/25 hover:text-white/85",
                "disabled:cursor-not-allowed disabled:opacity-35",
              )}
            >
              {micAvailable ? (
                <Mic className="h-4 w-4" />
              ) : (
                <MicOff className="h-4 w-4" />
              )}
            </button>

            <span className="text-[0.7rem] text-white/30">
              {listening ? "Listening" : "Enter to send"}
            </span>
          </div>

          <motion.button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            whileTap={{ scale: 0.98 }}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              canSend
                ? "bg-amber-100 text-neutral-900 hover:bg-amber-50"
                : "cursor-not-allowed bg-white/[0.05] text-white/35",
            )}
          >
            {busy ? (
              <LoaderIcon className="h-4 w-4 animate-[spin_1.6s_linear_infinite]" />
            ) : (
              <SendIcon className="h-4 w-4" />
            )}
            Send
          </motion.button>
        </div>
      </div>
    </div>
  );
}
