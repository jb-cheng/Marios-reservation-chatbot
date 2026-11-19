import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { MapPin, Phone } from "lucide-react";

import { Reveal, SectionMark } from "@/components/site/Reveal";
import { hoursSummary } from "@/lib/hours";
import type { RestaurantConfig } from "@/state/types";

/**
 * The room, in the restaurant's own words.
 *
 * Everything factual here is read from /api/config: the address, the telephone,
 * the hours and the cuisine are the same strings the agent is allowed to answer
 * with, so the page cannot promise something the host will then contradict. Only
 * the prose around them is authored.
 */
export function StorySection({ config }: { config: RestaurantConfig | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const drift = useTransform(scrollYProgress, [0, 1], [40, -40]);
  const turn = useTransform(scrollYProgress, [0, 1], [-6, 6]);

  const facts = config?.facts ?? {};
  const hours = config === null ? [] : hoursSummary(config);

  return (
    <section
      id="our-story"
      ref={ref}
      aria-labelledby="our-story-heading"
      className="relative overflow-hidden border-t border-linen-300 bg-paper"
    >
      {/* One warm source, moving with the scroll rather than sitting still. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 right-[-10%] h-[420px] w-[420px] rounded-full bg-gold/[0.09] blur-[110px]" />
        <div className="absolute bottom-[-20%] left-[-8%] h-[360px] w-[360px] rounded-full bg-olive/[0.07] blur-[110px]" />
      </div>

      <div className="relative mx-auto grid max-w-[1440px] gap-12 px-5 py-20 sm:px-8 md:py-28 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20 xl:px-16">
        <div className="lg:sticky lg:top-[calc(var(--nav-height)+48px)] lg:self-start">
          <SectionMark index="02" label="Our story" />

          <Reveal>
            <h2
              id="our-story-heading"
              className="display mt-5 text-[40px] leading-[1.12] text-ink sm:text-[52px]"
            >
              A small room,
              <br />
              kept properly.
            </h2>
          </Reveal>

          <Reveal delay={0.08}>
            <p className="mt-5 max-w-[42ch] text-[15px] leading-6 text-ink-400">
              {facts.cuisine ??
                "Northern Italian cooking, a wood-fired oven and a pasta menu that changes with the season."}
            </p>
          </Reveal>

          <motion.svg
            aria-hidden="true"
            viewBox="0 0 260 200"
            style={{ y: drift, rotate: turn }}
            className="mt-10 hidden h-[200px] w-[260px] text-gold lg:block"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
          >
            {/* A cover laid for two, drawn rather than photographed. */}
            <ellipse cx="130" cy="104" rx="66" ry="66" opacity="0.55" />
            <ellipse cx="130" cy="104" rx="52" ry="52" opacity="0.3" />
            <ellipse cx="130" cy="104" rx="30" ry="30" opacity="0.18" />
            <path d="M40 52v56M34 52v22a6 6 0 0 0 12 0V52M40 108v48" opacity="0.7" />
            <path d="M220 52c8 10 8 30 0 40h-6V52zM214 92v64" opacity="0.7" />
            <path d="M186 30h26l-4 24a9 9 0 0 1-18 0zM199 63v28M188 91h22" opacity="0.45" />
            <path d="M48 30h26l-4 24a9 9 0 0 1-18 0zM61 63v28M50 91h22" opacity="0.45" />
            <path d="M96 176h68" opacity="0.4" />
          </motion.svg>
        </div>

        <div className="flex flex-col gap-10">
          <Reveal>
            <p className="text-[17px] leading-7 text-ink">
              Mario&rsquo;s opened with twelve tables and one rule: nobody leaves without being
              looked after. The oven was built before the bar was, and it still runs every
              service, which is why the bread arrives warm and the kitchen smells of it from
              the doorway.
            </p>
          </Reveal>

          <Reveal delay={0.06}>
            <p className="text-[15px] leading-7 text-ink-400">
              The pasta is rolled in the morning and the menu turns with what the market has.
              Ask the floor what is on tonight; they will tell you honestly, including the
              nights when the answer is that something has run out. Bookings are taken by our
              virtual host at any hour, and every one of them is read by a person on the team
              before the evening begins.
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="h-px w-full rule-gold opacity-60" />
          </Reveal>

          <Reveal delay={0.12}>
            <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
              <div>
                <dt className="eyebrow text-ink-400">Find us</dt>
                <dd className="mt-2 flex items-start gap-2 text-[14px] leading-5 text-ink">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                  <span>{facts.address ?? "Oshawa, Ontario"}</span>
                </dd>
                {facts.phone && (
                  <dd className="mt-2 flex items-start gap-2 text-[14px] leading-5 text-ink">
                    <Phone className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                    <a
                      href={`tel:${facts.phone.replace(/[^\d+]/g, "")}`}
                      className="underline decoration-linen-300 underline-offset-4 transition-colors hover:decoration-gold"
                    >
                      {facts.phone}
                    </a>
                  </dd>
                )}
              </div>

              <div>
                <dt className="eyebrow text-ink-400">Hours</dt>
                <dd className="mt-2 space-y-1.5">
                  {hours.length === 0 ? (
                    <span className="text-[14px] leading-5 text-ink-400">Loading the hours</span>
                  ) : (
                    hours.map((row) => (
                      <span key={row.label} className="flex justify-between gap-4 text-[14px] leading-5">
                        <span className="text-ink">{row.label}</span>
                        <span className="shrink-0 text-ink-400 tabular-nums">{row.value}</span>
                      </span>
                    ))
                  )}
                </dd>
              </div>

              {facts.dress_code && (
                <div>
                  <dt className="eyebrow text-ink-400">What to wear</dt>
                  <dd className="mt-2 text-[14px] leading-5 text-ink">{facts.dress_code}</dd>
                </div>
              )}

              {facts.parking && (
                <div>
                  <dt className="eyebrow text-ink-400">Parking</dt>
                  <dd className="mt-2 text-[14px] leading-5 text-ink">{facts.parking}</dd>
                </div>
              )}
            </dl>
          </Reveal>
        </div>
      </div>
    </section>
  );
}