import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * One component per avatar state, as the brief asks.
 *
 * The states are a discriminated union driven by the turn flow and the audio
 * lifecycle, never by four independent booleans that can disagree with each other
 * and produce a face that is listening and speaking at once.
 */
export type AvatarState = "idle" | "listening" | "thinking" | "speaking" | "error";

type AvatarProps = {
  state: AvatarState;
  /** Zero to one, from the Web Audio analyser reading the TTS output. */
  level?: number;
  className?: string;
};

export function Avatar({ state, level = 0, className }: AvatarProps) {
  switch (state) {
    case "listening":
      return <ListeningAvatar className={className} />;
    case "thinking":
      return <ThinkingAvatar className={className} />;
    case "speaking":
      return <SpeakingAvatar level={level} className={className} />;
    case "error":
      return <ErrorAvatar className={className} />;
    default:
      return <IdleAvatar className={className} />;
  }
}

/**
 * The shared frame. Warm rather than the violet neon this page shipped with,
 * because the agent speaks for an Italian restaurant and not for a dev tool.
 */
function Frame({
  children,
  className,
  tone = "bg-amber-500/10 ring-amber-200/20",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full ring-1",
        tone,
        className,
      )}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}

function IdleAvatar({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <div className="h-2.5 w-2.5 rounded-full bg-amber-200/70" />
    </Frame>
  );
}

function ListeningAvatar({ className }: { className?: string }) {
  return (
    <Frame className={className} tone="bg-rose-500/10 ring-rose-200/25">
      <div className="flex items-end gap-1">
        {[0, 1, 2].map((bar) => (
          <motion.span
            key={bar}
            className="w-1 rounded-full bg-rose-200/80"
            animate={{ height: ["0.5rem", "1.1rem", "0.5rem"] }}
            transition={{
              duration: 0.9,
              repeat: Infinity,
              delay: bar * 0.12,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
    </Frame>
  );
}

function ThinkingAvatar({ className }: { className?: string }) {
  return (
    <Frame className={className} tone="bg-white/5 ring-white/15">
      <motion.div
        className="h-8 w-8 rounded-full border-2 border-white/15 border-t-amber-200/80"
        animate={{ rotate: 360 }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
      />
    </Frame>
  );
}

/**
 * Mouth movement driven by real audio.
 *
 * `level` comes from an AnalyserNode reading the decoded TTS buffer, so the mouth
 * follows the actual waveform rather than a timer that happens to look plausible.
 * When there is no decoded stream (browser speech synthesis fallback, or a muted
 * tab) `level` stays zero and the mouth animates on a loop instead: a degraded
 * visual is honest, while a mouth that never moves during audio is not.
 */
function SpeakingAvatar({ level, className }: { level: number; className?: string }) {
  const driven = level > 0.001;
  const openness = driven ? Math.min(1, level * 2.4) : 0.35;

  return (
    <Frame className={className}>
      <motion.div
        className="w-6 rounded-full bg-amber-200/85"
        animate={
          driven
            ? { height: `${0.35 + openness * 1.4}rem` }
            : { height: ["0.35rem", "1.2rem", "0.35rem"] }
        }
        transition={
          driven
            ? { duration: 0.08, ease: "linear" }
            : { duration: 0.7, repeat: Infinity, ease: "easeInOut" }
        }
        style={{ minHeight: "0.35rem" }}
      />
    </Frame>
  );
}

function ErrorAvatar({ className }: { className?: string }) {
  return (
    <Frame className={className} tone="bg-red-500/10 ring-red-200/25">
      <span className="text-lg font-medium text-red-200/90">!</span>
    </Frame>
  );
}
