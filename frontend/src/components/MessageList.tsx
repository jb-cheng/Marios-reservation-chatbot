import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/state/types";

type Props = {
  messages: ChatMessage[];
  thinking: boolean;
  assistantName: string;
  /** True while the browser is transcribing, so a spoken turn is labelled. */
  lastTurnSpoken?: boolean;
};

export function MessageList({
  messages,
  thinking,
  assistantName,
  lastTurnSpoken = false,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, thinking]);

  if (messages.length === 0 && !thinking) return null;

  return (
    <div
      className="flex max-h-[46vh] flex-col gap-4 overflow-y-auto px-1 py-2"
      role="log"
      aria-live="polite"
      aria-label="Conversation"
    >
      {messages.map((message, index) => (
        <Bubble
          key={`${index}-${message.role}`}
          message={message}
          assistantName={assistantName}
          spoken={lastTurnSpoken && index === messages.length - 1 && message.role === "user"}
        />
      ))}

      {thinking && (
        <div className="flex items-center gap-2 self-start text-sm text-white/50">
          <span className="text-white/70">{assistantName}</span>
          <ThinkingDots />
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}

function Bubble({
  message,
  assistantName,
  spoken,
}: {
  message: ChatMessage;
  assistantName: string;
  spoken: boolean;
}) {
  const fromUser = message.role === "user";

  return (
    <motion.div
      className={cn("flex flex-col gap-1", fromUser ? "items-end" : "items-start")}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <span className="flex items-center gap-1 px-1 text-[0.7rem] text-white/35">
        {fromUser ? (
          <>
            {spoken && <Mic className="h-3 w-3" aria-hidden="true" />}
            You
          </>
        ) : (
          assistantName
        )}
      </span>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          fromUser
            ? "bg-amber-200/90 text-neutral-900"
            : "border border-white/10 bg-white/[0.04] text-white/85",
        )}
      >
        {message.content}
      </div>
    </motion.div>
  );
}

function ThinkingDots() {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((dot) => (
        <motion.span
          key={dot}
          className="h-1.5 w-1.5 rounded-full bg-white/70"
          animate={{ opacity: [0.25, 0.9, 0.25] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: dot * 0.15 }}
        />
      ))}
    </span>
  );
}
