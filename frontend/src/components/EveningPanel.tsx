import { useId } from "react";
import type { ReactNode } from "react";
import { Check } from "lucide-react";

import { clockLabel, longDate, tableTypeLabel } from "@/lib/format";
import type { ReservationState, RestaurantConfig } from "@/state/types";

type Props = {
  state: ReservationState;
  config: RestaurantConfig;
  confirmation: { submission_id: string; table_id: string } | null;
  children?: ReactNode;
};

export function EveningPanel({ state, config, confirmation, children }: Props) {
  const booked = state.submitted;
  const filled = config.required_slots.filter(key => state[key] !== null).length;
  const remaining = config.required_slots.length - filled;
  return (
    <aside aria-label="Your evening so far" className="evening-panel flex min-w-0 flex-col rounded-[4px] bg-linen p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="display text-[26px] leading-8 text-ink">{booked ? "Your table is held." : "Your evening"}</h3>
        {booked && <Check className="h-4 w-4 shrink-0 text-sage" />}
      </div>
      <p className="mt-1 text-[11px] leading-4 text-ink-400">
        {booked ? "Reservation submitted" : remaining === 0 ? "Ready to confirm" : `${remaining} more ${remaining === 1 ? "detail" : "details"} to go`}
      </p>
      <div className="my-3 h-px bg-linen-300"><div className="h-px bg-gold transition-[width]" style={{ width: `${filled / Math.max(1, config.required_slots.length) * 100}%` }} /></div>
      <dl className="receipt-details grid grid-cols-2 gap-x-3 gap-y-3">
        <Row label="Date" value={state.date === null ? null : longDate(state.date)} />
        <Row label="Time" value={state.time === null ? null : clockLabel(state.time)} />
        <Row label="Guests" value={state.party_size === null ? null : `${state.party_size} ${state.party_size === 1 ? "guest" : "guests"}`} />
        <Row label="Seating" value={state.type === null ? "No preference" : tableTypeLabel(state.type)} />
        {state.name !== null && <Row label="Under" value={state.name} />}
        {state.phone !== null && <Row label="Call" value={state.phone} />}
        {state.email !== null && <Row label="Receipt to" value={state.email} wide />}
        {state.special_requests !== null && <Row label="Notes" value={state.special_requests} wide />}
        {booked && confirmation !== null && <>
          <Row label="Table" value={confirmation.table_id || null} />
          <Row label="Reference" value={confirmation.submission_id.slice(0, 8)} />
        </>}
      </dl>
      <div className="receipt-actions mt-auto border-t border-linen-300 pt-3">
        <div className="mt-3">{children}</div>
        <p className="mt-2 text-[11px] leading-4 text-ink-400">
          {booked ? "Starting over does not cancel this booking." : remaining > 0 ? "Your table is not reserved yet. No payment required." : "No payment required to reserve."}
        </p>
      </div>
    </aside>
  );
}

function Row({ label, value, wide = false }: { label: string; value: string | null; wide?: boolean }) {
  const id = useId();
  const long = value !== null && value.length > 48;
  return (
    <div className={wide ? "col-span-2 min-w-0" : "min-w-0"}>
      <dt className="eyebrow text-ink-400">{label}</dt>
      <dd className="mt-0.5 text-[13px] leading-[18px] break-words text-ink">
        {long ? <>
          <button type="button" popoverTarget={id} aria-label={`Read full ${label.toLowerCase()}`} className="underline decoration-gold underline-offset-4 hover:text-ink-600">View in full</button>
          <div id={id} popover="auto" className="m-auto w-[min(360px,calc(100vw-2rem))] rounded-md border border-linen-300 bg-paper p-5 text-ink shadow-card">
            <p className="eyebrow text-ink-400">{label}</p>
            <p className="mt-2 text-[14px] leading-6 break-words">{value}</p>
            <button type="button" popoverTarget={id} popoverTargetAction="hide" className="mt-4 min-h-11 rounded-[3px] bg-ink px-5 text-linen">Close</button>
          </div>
        </> : value ?? <span className="text-ink-400">Not chosen yet</span>}
      </dd>
    </div>
  );
}
