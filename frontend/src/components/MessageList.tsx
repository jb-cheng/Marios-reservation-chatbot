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
  const scrollRef = useRef<HTMLDivElement>(null);

  // Only this box scrolls. scrollIntoView would walk every ancestor including the
  // window, so the greeting on load would drag the whole page past the hero down
  // to the conversation.
  useEffect(() => {
    const box = scrollRef.current;
    if (box !== null) box.scrollTop = box.scrollHeight;
  }, [messages.length, thinking]);

  if (messages.length === 0 && !thinking) return null;

  return (
    <div
      ref={scrollRef}
      className="message-list flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain pr-1"
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
        <div className="flex items-center gap-2 self-start rounded-[4px] bg-linen px-4 py-3">
          <span className="sr-only">{assistantName} is thinking</span>
          <ThinkingDots />
        </div>
      )}
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
      className={cn("flex", fromUser ? "justify-end" : "justify-start")}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 0.68, 0.24, 1] }}
    >
      <div
        className={cn(
          "flex max-w-[88%] items-start gap-2 rounded-[4px] px-4 py-3 text-[14px] leading-5 whitespace-pre-wrap",
          fromUser ? "bg-ink text-linen" : "bg-linen text-ink",
        )}
      >
        <span className="sr-only">{fromUser ? "You said" : `${assistantName} said`}:</span>
        {spoken && <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-200" aria-hidden="true" />}
        <span>{message.content}</span>
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
          className="h-1.5 w-1.5 rounded-full bg-ink-400"
          animate={{ opacity: [0.25, 0.9, 0.25] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: dot * 0.15 }}
        />
      ))}
    </span>
  );
}