import { cn } from "@/lib/utils";
import type { PipGroup } from "@/state/pips";
import type { ReservationState, SlotKey } from "@/state/types";

type Props = {
  groups: PipGroup[];
  state: ReservationState;
  busy: boolean;
  disabled: boolean;
  onSend: (message: string) => void;
};

export function PipDeck({ groups, state, busy, disabled, onSend }: Props) {
  if (groups.length === 0) return null;

  const locked = busy || disabled;

  return (
    <div className="pip-deck flex min-w-0 flex-col gap-3">
      {groups.map((group) => (
        <section
          key={group.slot}
          aria-label={group.caption}
          className="pip-group flex min-w-0 flex-col gap-1.5"
        >
          <p className="eyebrow text-ink-400">{group.caption}</p>

          <div className="pip-choices flex flex-wrap gap-1.5">
            {group.choices.map((choice) => {
              const selected =
                choice.value !== null && choice.value === currentValue(state, group.slot);
              return (
                <button
                  key={choice.label}
                  type="button"
                  disabled={locked}
                  aria-pressed={selected}
                  onClick={() => onSend(choice.message)}
                  className={cn(
                    "flex min-h-[44px] min-w-[44px] items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-left text-[12px] leading-4 transition-colors duration-200",
                    selected
                      ? "border-ink bg-ink text-linen"
                      : "border-linen-300 bg-paper text-ink hover:border-ink-400 hover:bg-linen",
                    "disabled:cursor-not-allowed disabled:opacity-45",
                  )}
                >
                  <span>{choice.label}</span>
                  {choice.hint && (
                    <span
                      className={cn(
                        "text-[10px] tracking-wide",
                        selected ? "text-gold-200" : "text-ink-400",
                      )}
                    >
                      {choice.hint}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function currentValue(state: ReservationState, slot: SlotKey): string | null {
  const value = state[slot];
  return value === null ? null : String(value);
}
