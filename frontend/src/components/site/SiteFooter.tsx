import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { STATE_KEY } from "@/state/storage";

/**
 * The footer, and the only page on this site about the data.
 *
 * A native dialog rather than a div with a click handler: showModal gives the
 * focus trap, the Escape key and the inert background without reimplementing
 * them, which is the platform doing the work a modal library would charge for.
 *
 * Every claim below was read off the code rather than written from a template.
 * If the storage keys or the email behaviour change, this text is wrong.
 */
export function SiteFooter({ name, compact = false }: { name: string; compact?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <footer className="relative bg-linen">
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 xl:px-16">
        <div className="h-px w-full bg-linen-300" />

        <div className={cn(
          "flex flex-col sm:flex-row sm:items-center sm:justify-between",
          compact ? "gap-2 py-3" : "gap-4 py-7",
        )}>
          <p className="text-[12px] leading-[15px] text-ink-400">
            Restaurant closed? Our virtual host is always here.
          </p>

          <div className="flex items-center gap-8">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-[12px] leading-[15px] text-ink-400 underline decoration-linen-300 underline-offset-4 transition-colors hover:text-ink hover:decoration-gold"
            >
              Privacy
            </button>
            {/* A marker, not a control: there is one translation, so a language
                switcher here would be a button that does nothing. */}
            <span className="text-[12px] leading-[15px] text-ink-400" lang="en">
              EN
            </span>
          </div>
        </div>
      </div>

      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-labelledby="privacy-heading"
        className="m-auto w-[min(640px,calc(100vw-2.5rem))] rounded-md border border-linen-300 bg-paper p-0 text-ink shadow-card backdrop:bg-ink/45 backdrop:backdrop-blur-sm"
      >
        <div className="flex items-start justify-between gap-6 border-b border-linen-300 px-7 py-6">
          <div>
            <p className="eyebrow text-ink-400">Your details</p>
            <h2 id="privacy-heading" className="display mt-1 text-[28px] leading-9">
              What we keep, and where it goes
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] border border-linen-300 text-ink-400 transition-colors hover:bg-linen hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[min(60vh,520px)] space-y-6 overflow-y-auto px-7 py-6 text-[14px] leading-6">
          <section>
            <h3 className="eyebrow text-ink-400">In this browser</h3>
            <p className="mt-2 text-ink">
              Two things are saved on your device: the reservation you are building (date,
              time, party size, seating, name, email, phone and any note), and a random
              session id that ties it to your booking. Nothing else. There are no advertising
              or analytics cookies on this page.
            </p>
            <p className="mt-2 text-ink-400">
              The conversation itself is deliberately not saved. Refresh the page and the
              transcript is gone, while the details you have already given remain. Choosing
              &ldquo;Start over&rdquo; clears the draft and starts a new session. It never
              cancels a submitted booking.
            </p>
          </section>

          <section>
            <h3 className="eyebrow text-ink-400">What leaves your device</h3>
            <p className="mt-2 text-ink">
              Each message you send goes to {name}&rsquo;s reservation service together with
              the details collected so far. The service passes them to a language model
              provider, whose only job is to read your sentence and fill in the fields. It is
              not able to make a booking: that happens on our server, from the summary you
              confirmed.
            </p>
            <p className="mt-2 text-ink-400">
              In Voice mode, recordings can be sent to the service for transcription,
              and the host&rsquo;s replies are sent out to be spoken. The dictation microphone
              uses your browser&rsquo;s speech service. Typing a message sends no audio.
            </p>
          </section>

          <section>
            <h3 className="eyebrow text-ink-400">Who reads it</h3>
            <p className="mt-2 text-ink">
              A person on the restaurant team reviews every booking made here before the
              evening begins. You get a receipt by email when you submit. If the team has to
              decline the booking, that email says so and offers the times still free. An
              approval sends nothing, because you were already told the table was yours.
            </p>
            <p className="mt-2 text-ink-400">
              Your phone number is optional and is only used if the team needs to call you.
              No payment details are asked for or stored at any point.
            </p>
          </section>

          <section>
            <h3 className="eyebrow text-ink-400">Clearing it yourself</h3>
            <p className="mt-2 text-ink">
              Clearing this site&rsquo;s data in your browser removes both saved items,
              including the one named{" "}
              <code className="rounded-[3px] bg-linen px-1.5 py-0.5 text-[12px]">{STATE_KEY}</code>.
              To ask about a booking you have already made, call the restaurant using the
              number in{" "}
              <a href="/our-story/" className="underline decoration-linen-300 underline-offset-4 hover:decoration-gold">
                Our story
              </a>.
            </p>
          </section>
        </div>

        <div className="border-t border-linen-300 px-7 py-5">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-11 rounded-[3px] bg-ink px-6 text-[14px] leading-[17px] text-linen transition-colors hover:bg-ink-600"
          >
            Close
          </button>
        </div>
      </dialog>
    </footer>
  );
}