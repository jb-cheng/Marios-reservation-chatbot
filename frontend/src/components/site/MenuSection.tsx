import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Flame } from "lucide-react";

import { SectionMark } from "@/components/site/Reveal";
import { tabKeyDown } from "@/components/site/tabs";
import { cn } from "@/lib/utils";

type Dish = { name: string; note: string; price: number; fired?: boolean };

const COURSES: { id: string; label: string; caption: string; dishes: Dish[] }[] = [
  {
    id: "antipasti",
    label: "Antipasti",
    caption: "To begin, meant for the middle of the table.",
    dishes: [
      { name: "Vitello tonnato", note: "Thin-sliced veal, tuna and caper cream, fried capers", price: 18 },
      { name: "Burrata e prosciutto", note: "Burrata, 24-month prosciutto, grilled peach, basil", price: 21 },
      { name: "Polenta e funghi", note: "Soft polenta, roasted mushrooms, taleggio, thyme", price: 16, fired: true },
      { name: "Fritto di mare", note: "Calamari, gulf shrimp, lemon, Calabrian aioli", price: 22 },
    ],
  },
  {
    id: "primi",
    label: "Primi",
    caption: "Rolled in the morning. The shapes change with the market.",
    dishes: [
      { name: "Tagliatelle al ragù", note: "Eight-hour beef and pork ragù, parmigiano", price: 26 },
      { name: "Agnolotti del plin", note: "Roast veal filling, brown butter, sage, hazelnut", price: 29 },
      { name: "Risotto ai porcini", note: "Carnaroli, porcini, aged parmigiano, white wine", price: 27 },
      { name: "Spaghetti alle vongole", note: "Manila clams, garlic, chili, parsley", price: 28 },
      { name: "Gnocchi al gorgonzola", note: "Potato gnocchi, gorgonzola dolce, walnut", price: 24 },
    ],
  },
  {
    id: "secondi",
    label: "Secondi",
    caption: "From the oven, which was built before the bar was.",
    dishes: [
      { name: "Branzino al forno", note: "Whole sea bass, fennel, salmoriglio", price: 38, fired: true },
      { name: "Bistecca alla Fiorentina", note: "32oz dry-aged ribeye for two, rosemary, lemon", price: 96, fired: true },
      { name: "Pollo al mattone", note: "Brick-pressed half chicken, salsa verde", price: 31, fired: true },
      { name: "Melanzane alla parmigiana", note: "Layered aubergine, San Marzano, basil, mozzarella", price: 25, fired: true },
    ],
  },
  {
    id: "dolci",
    label: "Dolci",
    caption: "Made once a day. When it is gone, it is gone.",
    dishes: [
      { name: "Tiramisù", note: "Made in the morning, usually gone by ten", price: 12 },
      { name: "Panna cotta", note: "Vanilla bean, macerated berries", price: 11 },
      { name: "Torta di nocciole", note: "Piedmont hazelnut cake, zabaglione", price: 13 },
      { name: "Affogato", note: "Fior di latte, double espresso", price: 9 },
    ],
  },
];

/**
 * The menu, on the dark band.
 *
 * The page changes hue here on purpose: four sections of cream would read as one
 * long document, and the ink band gives the eye a rest before the room itself.
 * Course switching is real state, not anchors, so the list stays short enough to
 * read on a phone.
 */
export function MenuSection() {
  const [course, setCourse] = useState(COURSES[1].id);
  const active = COURSES.find((item) => item.id === course) ?? COURSES[0];

  return (
    <section
      id="the-menu"
      aria-labelledby="the-menu-heading"
      className="on-ink relative overflow-hidden bg-ink text-cream"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="animate-drift absolute -left-40 top-10 h-[520px] w-[520px] rounded-full bg-terracotta/[0.13] blur-[130px]" />
        <div className="animate-candle absolute -right-32 bottom-0 h-[460px] w-[460px] rounded-full bg-gold/[0.14] blur-[130px]" />
        <div className="absolute inset-0 bg-[linear-gradient(160deg,rgba(53,88,107,0.16)_0%,rgba(36,45,39,0)_45%,rgba(122,35,51,0.14)_100%)]" />
      </div>

      <div className="relative mx-auto max-w-[1440px] px-5 py-20 sm:px-8 md:py-28 xl:px-16">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <SectionMark index="03" label="The menu" tone="text-gold-200" />
            <h2
              id="the-menu-heading"
              className="display mt-5 text-[40px] leading-[1.12] text-linen sm:text-[52px]"
            >
              What the kitchen
              <br />
              is cooking.
            </h2>
          </div>
          <p className="max-w-[38ch] text-[14px] leading-6 text-cream-dim">
            Northern Italian, wood-fired, and shorter than it could be. Prices in Canadian
            dollars. Tell the host about any allergy when you book and the kitchen will have
            it before you arrive.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Courses"
          onKeyDown={(event) =>
            tabKeyDown(
              event,
              COURSES.map((item) => item.id),
              active.id,
              setCourse,
            )
          }
          className="mt-12 flex flex-wrap gap-1 border-b border-ink-500"
        >
          {COURSES.map((item) => {
            const selected = item.id === active.id;
            return (
              <button
                key={item.id}
                role="tab"
                type="button"
                id={`course-tab-${item.id}`}
                aria-selected={selected}
                aria-controls={`course-panel-${item.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setCourse(item.id)}
                className={cn(
                  "relative px-4 py-3 text-[14px] leading-[17px] transition-colors duration-200 sm:px-6",
                  selected ? "text-linen" : "text-cream-dim/70 hover:text-cream",
                )}
              >
                {item.label}
                {selected && (
                  <motion.span
                    layoutId="course-underline"
                    className="absolute inset-x-2 -bottom-px h-0.5 bg-gold"
                    transition={{ duration: 0.35, ease: [0.22, 0.68, 0.24, 1] }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={active.id}
            role="tabpanel"
            id={`course-panel-${active.id}`}
            aria-labelledby={`course-tab-${active.id}`}
            tabIndex={0}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.32, ease: [0.22, 0.68, 0.24, 1] }}
            className="mt-8"
          >
            <p className="display text-[22px] leading-8 text-gold-200">{active.caption}</p>

            <ul className="mt-6 grid gap-x-16 lg:grid-cols-2">
              {active.dishes.map((dish, index) => (
                <motion.li
                  key={dish.name}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.05 + index * 0.05 }}
                  className="group flex items-baseline gap-4 border-b border-ink-500/70 py-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[16px] leading-6 text-linen">
                      {dish.name}
                      {dish.fired && (
                        <span
                          title="From the wood-fired oven"
                          className="flex items-center gap-1 rounded-full bg-terracotta/20 px-2 py-0.5 text-[10px] tracking-[0.08em] text-terracotta uppercase"
                        >
                          <Flame className="h-3 w-3" aria-hidden="true" />
                          Wood-fired
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-cream-dim/80">{dish.note}</p>
                  </div>
                  <span
                    aria-hidden="true"
                    className="mb-1.5 hidden h-px flex-1 bg-ink-500 transition-colors duration-300 group-hover:bg-gold/50 sm:block"
                  />
                  <span className="shrink-0 text-[15px] leading-6 text-gold-200 tabular-nums">
                    {dish.price}
                  </span>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        </AnimatePresence>

        <a
          href="/"
          className="mt-12 inline-flex h-11 items-center gap-2 rounded-[3px] border border-ink-500 px-6 text-[14px] leading-[17px] text-linen transition-colors duration-200 hover:border-gold hover:bg-cream/[0.06]"
        >
          Ask the host about tonight
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}