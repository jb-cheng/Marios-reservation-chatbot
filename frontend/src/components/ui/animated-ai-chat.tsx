"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type ShellProps = {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
};

/**
 * The shell this page shipped with, kept and stripped down.
 *
 * Retained because it was good work: the layered ambient wash, the glass panel,
 * the entrance animation, the dark page it needs behind it. Removed because a
 * reservation conversation has no use for it: the command palette, the mock PDF
 * attachments, the three second fake round trip, and the pointer-following glow.
 * The textarea moved into Composer, which owns its own sizing, and the typing
 * indicator moved into MessageList, which owns the transcript.
 *
 * It renders children rather than a conversation of its own, so the panel styling
 * and the reservation logic never have to change together.
 */
export function AnimatedAIChat({
  title = "Reserve a table",
  subtitle = "Tell me when, and for how many.",
  children,
  className,
}: ShellProps) {
  return (
    <div
      className={cn(
        "relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-transparent p-6 text-white",
        className,
      )}
    >
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute top-0 left-1/4 h-96 w-96 rounded-full bg-amber-500/[0.09] blur-[128px]" />
        <div className="absolute right-1/4 bottom-0 h-96 w-96 rounded-full bg-orange-700/[0.09] blur-[128px]" />
        <div className="absolute top-1/3 right-1/3 h-64 w-64 rounded-full bg-rose-500/[0.06] blur-[96px]" />
      </div>

      <div className="relative mx-auto w-full max-w-2xl">
        <motion.div
          className="relative z-10 space-y-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <header className="space-y-2 text-center">
            <h1 className="bg-clip-text bg-gradient-to-r from-white/90 to-white/45 pb-1 text-3xl font-medium tracking-tight text-transparent">
              {title}
            </h1>
            <div className="mx-auto h-px w-2/3 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <p className="text-sm text-white/40">{subtitle}</p>
          </header>

          <motion.div
            className="relative rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 shadow-2xl backdrop-blur-2xl"
            initial={{ scale: 0.985, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.08, duration: 0.35 }}
          >
            {children}
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
