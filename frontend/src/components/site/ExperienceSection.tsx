import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";

import { Reveal, SectionMark } from "@/components/site/Reveal";
import { tabKeyDown } from "@/components/site/tabs";
import { tableTypeLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RestaurantConfig } from "@/state/types";

const AREAS: Record<string, { blurb: string; detail: string }> = {
  standard: {
    blurb: "The main floor, under the pendant lights.",
    detail:
      "Where most of the room sits: linen, candlelight and the oven at the far end. Tables are held for the whole evening, so there is no second sitting to hurry you along.",
  },
  booth: {
    blurb: "Deep green banquettes along the wall.",
    detail:
      "Four booths, the quietest seats in the room and the ones people ask for by name. Good for a long dinner or a conversation that should not carry to the next table.",
  },
  patio: {
    blurb: "Three tables outside, under the awning.",
    detail:
      "Open in warmer weather and strung with lights after dusk. Patio seats are requested like any other table, and on a wet evening the team will move you inside.",
  },
};

/** Which zone of the schematic each seating type lights up. */
const ZONE_IDS: Record<string, string[]> = {
  booth: ["booth-1", "booth-2", "booth-3", "booth-4"],
  standard: ["floor-1", "floor-2", "floor-3", "floor-4", "floor-5"],
  patio: ["patio-1", "patio-2", "patio-3"],
};

/**
 * The room itself.
 *
 * The drawing is a schematic of the three seating areas, not a live table map:
 * the floor plan lives on the server and is what the availability engine reads,
 * so drawing table ids here would be a second copy of a fact that can change
 * without this page knowing. Seating types and every caveat below come from
 * /api/config for that reason.
 */
export function ExperienceSection({ config }: { config: RestaurantConfig | null }) {
  const types = config?.table_types ?? ["standard", "booth", "patio"];
  const [selected, setSelected] = useState<string | null>(null);
  const active = selected !== null && types.includes(selected) ? selected : types[0];
  const facts = config?.facts ?? {};
  const area = AREAS[active] ?? {
    blurb: "Another part of the room.",
    detail: "Ask the host and the team will tell you where it sits.",
  };
  const lit = new Set(ZONE_IDS[active] ?? []);

  return (
    <section
      id="the-experience"
      aria-labelledby="the-experience-heading"
      className="relative overflow-hidden border-t border-linen-300 bg-linen"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute right-[-12%] top-1/4 h-[440px] w-[440px] rounded-full bg-adriatic/[0.07] blur-[120px]" />
        <div className="absolute bottom-[-15%] left-[10%] h-[380px] w-[380px] rounded-full bg-gold/[0.1] blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-[1440px] px-5 py-20 sm:px-8 md:py-28 xl:px-16">
        <SectionMark index="04" label="The experience" />

        <div className="mt-5 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <h2
            id="the-experience-heading"
            className="display text-[40px] leading-[1.12] text-ink sm:text-[52px]"
          >
            Choose where
            <br />
            the evening happens.
          </h2>
          <p className="max-w-[38ch] text-[14px] leading-6 text-ink-400">
            Tell the host which part of the room you would like. A preference is honoured
            strictly: if the terrace is full, you will be told rather than quietly moved
            somewhere else.
          </p>
        </div>

        <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
          <div>
            <div
              role="tablist"
              aria-label="Seating areas"
              aria-orientation="vertical"
              onKeyDown={(event) => tabKeyDown(event, types, active, setSelected, true)}
              className="flex flex-col"
            >
              {types.map((type) => {
                const chosen = type === active;
                return (
                  <button
                    key={type}
                    role="tab"
                    type="button"
                    id={`area-tab-${type}`}
                    // The blurb is inside the button for layout, so without this
                    // the tab's name is the label plus a whole sentence.
                    aria-label={tableTypeLabel(type)}
                    aria-selected={chosen}
                    aria-controls={`area-panel-${type}`}
                    tabIndex={chosen ? 0 : -1}
                    onClick={() => setSelected(type)}
                    className={cn(
                      "group flex items-start gap-4 border-b border-linen-300 py-6 text-left transition-colors duration-200",
                      chosen ? "text-ink" : "text-ink-400 hover:text-ink",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-2 h-2 w-2 shrink-0 rounded-full transition-colors duration-200",
                        chosen ? "bg-gold" : "bg-linen-300 group-hover:bg-ink-400",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="display block text-[26px] leading-8">
                        {tableTypeLabel(type)}
                      </span>
                      <span className="mt-1 block text-[14px] leading-5">
                        {(AREAS[type] ?? { blurb: "Ask the host about this part of the room." }).blurb}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                role="tabpanel"
                id={`area-panel-${active}`}
                aria-labelledby={`area-tab-${active}`}
                tabIndex={0}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.3 }}
                className="mt-6"
              >
                <p className="text-[15px] leading-7 text-ink-400">{area.detail}</p>
                {active === "patio" && facts.patio && (
                  <p className="mt-3 border-l-2 border-gold pl-4 text-[13px] leading-6 text-ink-400">
                    {facts.patio}
                  </p>
                )}
              </motion.div>
            </AnimatePresence>

            <a
              href="/"
              className="mt-8 inline-flex h-11 items-center gap-2 rounded-[3px] bg-ink px-6 text-[14px] leading-[17px] text-linen transition-colors duration-200 hover:bg-ink-600"
            >
              Ask for {tableTypeLabel(active).toLowerCase()}
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>

          <Reveal className="flex flex-col gap-8">
            <div className="rounded-md border border-linen-300 bg-paper p-6 shadow-card">
              <p className="eyebrow text-ink-400">The room, schematically</p>
              <svg
                viewBox="0 0 420 300"
                role="img"
                aria-label={`Schematic of the dining room with ${tableTypeLabel(active).toLowerCase()} highlighted`}
                className="mt-4 w-full"
              >
                <rect x="8" y="8" width="270" height="284" rx="4" fill="#f5f1e8" stroke="#dbd7cc" />
                <rect x="290" y="8" width="122" height="284" rx="4" fill="#ece7db" stroke="#dbd7cc" />
                <text x="24" y="30" fontSize="9" letterSpacing="1.6" fill="#696d63">
                  MAIN DINING ROOM
                </text>
                <text x="304" y="30" fontSize="9" letterSpacing="1.6" fill="#696d63">
                  TERRACE
                </text>

                {/* Banquettes down the left wall. */}
                {[0, 1, 2, 3].map((row) => (
                  <g key={`booth-${row + 1}`}>
                    <rect
                      x="24"
                      y={48 + row * 60}
                      width="52"
                      height="46"
                      rx="3"
                      fill={lit.has(`booth-${row + 1}`) ? "#b99a61" : "#fffdf8"}
                      fillOpacity={lit.has(`booth-${row + 1}`) ? 0.28 : 1}
                      stroke={lit.has(`booth-${row + 1}`) ? "#b99a61" : "#dbd7cc"}
                      strokeWidth={lit.has(`booth-${row + 1}`) ? 1.6 : 1}
                    />
                    <rect
                      x="24"
                      y={48 + row * 60}
                      width="10"
                      height="46"
                      rx="3"
                      fill={lit.has(`booth-${row + 1}`) ? "#6d7a4f" : "#dbd7cc"}
                    />
                  </g>
                ))}

                {/* The open floor. */}
                {[
                  { id: "floor-1", cx: 138, cy: 78, r: 19 },
                  { id: "floor-2", cx: 224, cy: 78, r: 19 },
                  { id: "floor-3", cx: 138, cy: 158, r: 23 },
                  { id: "floor-4", cx: 224, cy: 158, r: 23 },
                  { id: "floor-5", cx: 181, cy: 240, r: 29 },
                ].map((table) => (
                  <circle
                    key={table.id}
                    cx={table.cx}
                    cy={table.cy}
                    r={table.r}
                    fill={lit.has(table.id) ? "#b99a61" : "#fffdf8"}
                    fillOpacity={lit.has(table.id) ? 0.28 : 1}
                    stroke={lit.has(table.id) ? "#b99a61" : "#dbd7cc"}
                    strokeWidth={lit.has(table.id) ? 1.6 : 1}
                  />
                ))}

                {/* Outside. */}
                {[0, 1, 2].map((row) => (
                  <rect
                    key={`patio-${row + 1}`}
                    x="316"
                    y={62 + row * 76}
                    width="70"
                    height="52"
                    rx="3"
                    fill={lit.has(`patio-${row + 1}`) ? "#b99a61" : "#fffdf8"}
                    fillOpacity={lit.has(`patio-${row + 1}`) ? 0.28 : 1}
                    stroke={lit.has(`patio-${row + 1}`) ? "#b99a61" : "#dbd7cc"}
                    strokeWidth={lit.has(`patio-${row + 1}`) ? 1.6 : 1}
                  />
                ))}

                {/* The oven, which is the reason the room smells the way it does. */}
                <path d="M24 268h44a22 22 0 0 0-44 0z" fill="#b0522c" fillOpacity="0.35" />
                <text x="80" y="272" fontSize="9" letterSpacing="1.2" fill="#696d63">
                  WOOD OVEN
                </text>
              </svg>
            </div>

            <dl className="grid gap-6 sm:grid-cols-2">
              {facts.large_party && (
                <div>
                  <dt className="eyebrow text-ink-400">Large parties</dt>
                  <dd className="mt-2 text-[13px] leading-6 text-ink-400">{facts.large_party}</dd>
                </div>
              )}
              {facts.children && (
                <div>
                  <dt className="eyebrow text-ink-400">Children</dt>
                  <dd className="mt-2 text-[13px] leading-6 text-ink-400">{facts.children}</dd>
                </div>
              )}
              {facts.cancellation && (
                <div className="sm:col-span-2">
                  <dt className="eyebrow text-ink-400">Changing your mind</dt>
                  <dd className="mt-2 text-[13px] leading-6 text-ink-400">{facts.cancellation}</dd>
                </div>
              )}
            </dl>
          </Reveal>
        </div>
      </div>
    </section>
  );
}