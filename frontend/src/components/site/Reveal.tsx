import type { ReactNode } from "react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

/**
 * One entrance, used everywhere below the fold.
 *
 * `once` matters: a section that re-animates every time it scrolls back into view
 * reads as a glitch rather than as choreography, and it makes long pages feel
 * unstable. The reduced-motion setting is honoured by framer-motion's own
 * `useReducedMotion`, so this does not need a second implementation of it.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li" | "article";
}) {
  const Component = motion[as];

  return (
    <Component
      className={className}
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, delay, ease: [0.22, 0.68, 0.24, 1] }}
    >
      {children}
    </Component>
  );
}

/** The numbered index the design puts beside each region. */
export function SectionMark({
  index,
  label,
  tone = "text-ink-400",
  className,
}: {
  index: string;
  label: string;
  tone?: string;
  className?: string;
}) {
  return (
    <p className={cn("flex items-center gap-3 text-[11px] leading-[13px] tracking-[0.22em] uppercase", tone, className)}>
      <span className="tabular-nums">{index}</span>
      <span aria-hidden="true" className="h-px w-8 bg-current opacity-40" />
      <span>{label}</span>
    </p>
  );
}