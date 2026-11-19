import { useEffect, useState } from "react";
import { motion } from "framer-motion";

import { SectionMark } from "@/components/site/Reveal";
import { serviceStatus } from "@/lib/hours";
import { cn } from "@/lib/utils";
import type { RestaurantConfig } from "@/state/types";

/**
 * The line above the conversation.
 *
 * The status pill is computed from the server's opening hours against the
 * visitor's own clock and re-read every minute, because a page left open across
 * four o'clock should stop saying it is closed. It is the one claim on this page
 * that can go stale while nobody is looking at it.
 */
export function HeroBand({ config }: { config: RestaurantConfig | null }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const status = config === null ? null : serviceStatus(config, now);

  return (
    <div className="relative">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <motion.h1
            className="display text-[38px] leading-[1.15] text-ink sm:text-[46px] sm:leading-[56px]"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 0.68, 0.24, 1] }}
          >
            A place at our table.
          </motion.h1>

          <motion.p
            className="mt-2 max-w-[46ch] text-[14px] leading-[17px] text-ink-400"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.12, ease: [0.22, 0.68, 0.24, 1] }}
          >
            Good evenings begin here. Reserve with our virtual host, any time.
          </motion.p>
        </div>

        <motion.div
          className="flex flex-col items-start gap-3 md:items-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9, delay: 0.24 }}
        >
          <SectionMark index="01" label="Plan your evening" />

          {status && (
            <p
              className={cn(
                "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[11px] leading-4",
                status.open
                  ? "border-sage/35 bg-sage/[0.08] text-sage"
                  : "border-linen-300 bg-paper text-ink-400",
              )}
            >
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                {status.open && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sage opacity-60" />
                )}
                <span
                  className={cn(
                    "relative inline-flex h-1.5 w-1.5 rounded-full",
                    status.open ? "bg-sage" : "bg-ink-400",
                  )}
                />
              </span>
              <span className="font-medium">{status.label}</span>
              <span aria-hidden="true" className="opacity-40">
                ·
              </span>
              <span>{status.detail}</span>
            </p>
          )}
        </motion.div>
      </div>
    </div>
  );
}