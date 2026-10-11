import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AvailabilityStatus, ReservationState } from "@/state/types";

type Props = {
  state: ReservationState;
  availability: AvailabilityStatus | null;
  submitting: boolean;
  error: string | null;
  confirmation: { submission_id: string; table_id: string } | null;
  onConfirm: () => void;
  onKeepEditing: () => void;
};

/**
 * The summary the customer agrees to.
 *
 * Every value here is read from the browser's own merged state, never from the
 * model's prose. That is what makes criterion 6 hold: the card cannot flatter a
 * reply that got something wrong, because it does not read the reply.
 */
export function ConfirmCard({
  state,
  availability,
  submitting,
  error,
  confirmation,
  onConfirm,
  onKeepEditing,
}: Props) {
  const booked = confirmation !== null;

  return (
    <section
      aria-label="Reservation summary"
      className={cn(
        "rounded-2xl border p-5 backdrop-blur-xl",
        booked
          ? "border-emerald-300/25 bg-emerald-400/[0.06]"
          : "border-amber-200/20 bg-amber-100/[0.04]",
      )}
    >
      <header className="mb-4 flex items-center gap-2">
        {booked && <CheckCircle2 className="h-4 w-4 text-emerald-300" />}
        <h2 className="text-sm font-medium tracking-wide text-white/85">
          {booked ? "Reservation confirmed" : "Please check the details"}
        </h2>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Row label="Date" value={formatDate(state.date)} />
        <Row label="Time" value={state.time ?? null} />
        <Row
          label="Party"
          value={state.party_size === null ? null : `${state.party_size}`}
        />
        <Row label="Seating" value={state.type ?? "no preference"} />
        <Row label="Name" value={state.name} />
        <Row label="Phone" value={state.phone} />
        <Row label="Email" value={state.email} className="col-span-2" />
        {state.special_requests && (
          <Row
            label="Notes"
            value={state.special_requests}
            className="col-span-2"
          />
        )}
        {booked && (
          <>
            <Row label="Table" value={confirmation.table_id || null} />
            <Row label="Reference" value={confirmation.submission_id.slice(0, 8)} />
          </>
        )}
      </dl>

      {!booked && availability?.state === "available" && (
        <p className="mt-4 text-xs text-white/45">
          The room has this slot free, so the booking can be held right now.
        </p>
      )}

      {booked && (
        <p className="mt-4 text-xs text-emerald-100/70">
          A receipt is on its way. Our team verifies every booking made through the
          assistant and will only contact you if something needs to change.
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-red-300/25 bg-red-400/10 px-3 py-2 text-xs text-red-100/90">
          {error}
        </p>
      )}

      {!booked && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              submitting
                ? "cursor-wait bg-white/20 text-white/60"
                : "bg-amber-100 text-neutral-900 hover:bg-amber-50",
            )}
          >
            {submitting ? "Booking" : "Confirm booking"}
          </button>
          <button
            type="button"
            onClick={onKeepEditing}
            disabled={submitting}
            className="rounded-lg border border-white/12 px-4 py-2 text-sm text-white/65 transition-colors hover:border-white/25 hover:text-white/90 disabled:opacity-40"
          >
            Change something
          </button>
        </div>
      )}
    </section>
  );
}

function Row({
  label,
  value,
  className,
}: {
  label: string;
  value: string | null;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[0.7rem] uppercase tracking-wider text-white/35">
        {label}
      </dt>
      <dd className={cn("text-white/85", value === null && "text-white/30")}>
        {value ?? "not given"}
      </dd>
    </div>
  );
}

function formatDate(value: string | null): string | null {
  if (value === null) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
