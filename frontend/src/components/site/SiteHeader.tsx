import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

import { SECTIONS } from "@/components/site/sections";
import type { SectionId } from "@/components/site/sections";
import { cn } from "@/lib/utils";

export function SiteHeader({
  name,
  active = "reservations",
}: {
  name: string;
  active?: SectionId;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    globalThis.addEventListener("keydown", close);
    return () => globalThis.removeEventListener("keydown", close);
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-linen">
      <div className="mx-auto flex h-[calc(var(--nav-height)-1px)] max-w-[1440px] items-center justify-between gap-6 px-5 sm:px-8 xl:px-16">
        <a
          href="/"
          className="group flex shrink-0 flex-col leading-none"
          aria-label={`${name}, back to reservations`}
        >
          <span className="display text-[32px] leading-[1.1] text-ink transition-colors duration-300 group-hover:text-ink-600 md:text-[44px]">
            {name}
          </span>
          <span className="mt-0.5 text-[9px] leading-[11px] tracking-[0.34em] text-ink-400 uppercase">
            Ristorante Italiano
          </span>
        </a>

        <nav aria-label="Main navigation" className="hidden items-center gap-9 md:flex">
          {SECTIONS.slice(1).map((section) => (
            <a
              key={section.id}
              href={section.href}
              aria-current={active === section.id ? "page" : undefined}
              className="group relative py-2 text-[14px] leading-[17px] text-ink"
            >
              {section.label}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute -bottom-0.5 left-0 h-px bg-gold transition-all duration-300",
                  active === section.id ? "w-full" : "w-0 group-hover:w-full",
                )}
              />
            </a>
          ))}

          <a
            href="/"
            aria-current={active === "reservations" ? "page" : undefined}
            className={cn(
              "flex h-11 items-center rounded-[3px] bg-ink px-6 text-[14px] leading-[17px] text-linen transition-colors duration-300 hover:bg-ink-600",
              active === "reservations" && "ring-1 ring-gold ring-offset-2 ring-offset-linen",
            )}
          >
            Reservations
          </a>
        </nav>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-sections"
          aria-label={open ? "Close menu" : "Open menu"}
          className="flex h-11 w-11 items-center justify-center rounded-[3px] border border-linen-300 text-ink transition-colors hover:bg-linen-200 md:hidden"
        >
          {open ? <X className="h-4.5 w-4.5" /> : <Menu className="h-4.5 w-4.5" />}
        </button>
      </div>

      <div
        id="mobile-sections"
        hidden={!open}
        className="border-t border-linen-300 bg-linen px-5 pb-5 sm:px-8 md:hidden"
      >
        <nav aria-label="Main navigation" className="flex flex-col">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={section.href}
              onClick={() => setOpen(false)}
              aria-current={active === section.id ? "page" : undefined}
              className={cn(
                "flex items-center justify-between border-b border-linen-300 py-3.5 text-[15px] text-ink last:border-b-0",
                active === section.id && "text-ink-600",
              )}
            >
              {section.label}
              {active === section.id && <span className="h-1.5 w-1.5 rounded-full bg-gold" />}
            </a>
          ))}
        </nav>
      </div>

      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 xl:px-16">
        <div className="h-px w-full bg-linen-300" />
      </div>
    </header>
  );
}
