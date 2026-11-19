import { motion } from "framer-motion";

import portrait from "@/assets/host/host-portrait.svg";
import { cn } from "@/lib/utils";

/**
 * One component per avatar state, as the brief asks.
 *
 * The states are a discriminated union driven by the turn flow and the audio
 * lifecycle, never by four independent booleans that can disagree and produce a
 * face that is listening and speaking at once.
 *
 * The portrait is the team's illustration, exported from the Figma file. It
 * stays still; what changes between states is the light around the oval, so the
 * host is recognisably the same person whether he is waiting, listening or
 * talking.
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
 * The shared frame.
 *
 * Inside the 236x276 export the oval sits about 11% in from each side, 7% from
 * the top and 10% from the bottom, so a ring inset by those amounts lands on the
 * gold rather than floating outside the portrait.
 */
function Frame({
  children,
  className,
  glow = null,
}: {
  children?: React.ReactNode;
  className?: string;
  glow?: React.ReactNode;
}) {
  return (
    <div className={cn("relative w-[236px] max-w-full", className)}>
      {glow}
      <img
        src={portrait}
        alt="Mario's virtual host, in a white jacket and bow tie"
        width={236}
        height={276}
        draggable={false}
        className="relative block h-auto w-full select-none"
      />
      <div className="pointer-events-none absolute inset-[7%_11%_10%_11%]">{children}</div>
    </div>
  );
}

function IdleAvatar({ className }: { className?: string }) {
  return (
    <Frame
      className={className}
      glow={
        <div
          aria-hidden="true"
          className="animate-candle absolute inset-[4%_8%_8%_8%] rounded-[50%] bg-gold/25 blur-2xl"
        />
      }
    />
  );
}

function ListeningAvatar({ className }: { className?: string }) {
  return (
    <Frame
      className={className}
      glow={
        <div
          aria-hidden="true"
          className="absolute inset-[4%_8%_8%_8%] rounded-[50%] bg-terracotta/30 blur-2xl"
        />
      }
    >
      <motion.div
        className="h-full w-full rounded-[50%] ring-2 ring-terracotta/70"
        animate={{ opacity: [0.35, 0.9, 0.35], scale: [0.99, 1.015, 0.99] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-end gap-1 rounded-full bg-ink/85 px-2.5 py-1.5">
        {[0, 1, 2].map((bar) => (
          <motion.span
            key={bar}
            className="w-[3px] rounded-full bg-terracotta"
            animate={{ height: [4, 13, 4] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: bar * 0.12, ease: "easeInOut" }}
          />
        ))}
      </div>
    </Frame>
  );
}

function ThinkingAvatar({ className }: { className?: string }) {
  return (
    <Frame
      className={className}
      glow={
        <div
          aria-hidden="true"
          className="absolute inset-[4%_8%_8%_8%] rounded-[50%] bg-cream/10 blur-2xl"
        />
      }
    >
      <div className="h-full w-full rounded-[50%] ring-1 ring-cream/25" />
      <motion.div
        className="absolute inset-0"
        animate={{ rotate: 360 }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "linear" }}
      >
        <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-gold-200 shadow-[0_0_10px_2px_rgba(210,186,142,0.6)]" />
      </motion.div>
    </Frame>
  );
}

/**
 * Light driven by real audio.
 *
 * `level` comes from an AnalyserNode reading the decoded TTS buffer, so the glow
 * follows the actual waveform rather than a timer that happens to look
 * plausible. With no decoded stream (browser synthesis fallback, or a muted
 * tab) `level` stays zero and the ring breathes on a loop instead: a degraded
 * visual is honest, while a host who never reacts during audio is not.
 */
function SpeakingAvatar({ level, className }: { level: number; className?: string }) {
  const driven = level > 0.001;
  const intensity = driven ? Math.min(1, level * 2.4) : 0.4;

  return (
    <Frame
      className={className}
      glow={
        <motion.div
          aria-hidden="true"
          className="absolute inset-[2%_6%_6%_6%] rounded-[50%] bg-gold/40 blur-2xl"
          animate={driven ? { opacity: 0.3 + intensity * 0.6 } : { opacity: [0.3, 0.7, 0.3] }}
          transition={
            driven
              ? { duration: 0.08, ease: "linear" }
              : { duration: 1.1, repeat: Infinity, ease: "easeInOut" }
          }
        />
      }
    >
      <motion.div
        className="h-full w-full rounded-[50%] ring-2 ring-gold-200"
        animate={
          driven
            ? { opacity: 0.35 + intensity * 0.6, scale: 1 + intensity * 0.02 }
            : { opacity: [0.35, 0.85, 0.35], scale: [1, 1.012, 1] }
        }
        transition={
          driven
            ? { duration: 0.08, ease: "linear" }
            : { duration: 1.1, repeat: Infinity, ease: "easeInOut" }
        }
      />
    </Frame>
  );
}

function ErrorAvatar({ className }: { className?: string }) {
  return (
    <Frame
      className={className}
      glow={
        <div
          aria-hidden="true"
          className="absolute inset-[4%_8%_8%_8%] rounded-[50%] bg-brick/25 blur-2xl"
        />
      }
    >
      <div className="h-full w-full rounded-[50%] ring-2 ring-brick/60" />
      <span className="absolute -bottom-1 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-brick text-[0.7rem] font-medium text-cream">
        !
      </span>
    </Frame>
  );
}