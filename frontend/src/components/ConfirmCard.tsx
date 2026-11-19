type Props = {
  submitting: boolean;
  disabled: boolean;
  onConfirm: () => void;
  onKeepEditing: () => void;
};

export function ConfirmCard({ submitting, disabled, onConfirm, onKeepEditing }: Props) {
  return (
    <section aria-label="Confirm your reservation" className="space-y-2">
      <p className="text-[12px] leading-4 text-ink-400">
        Check these details, then confirm your table.
      </p>
      <button type="button" onClick={onConfirm} disabled={disabled}
        className="min-h-11 w-full rounded-[4px] bg-ink px-3 text-[13px] text-linen hover:bg-ink-600 disabled:cursor-not-allowed disabled:opacity-40">
        {submitting ? "Booking…" : "Confirm booking"}
      </button>
      <button type="button" onClick={onKeepEditing} disabled={disabled}
        className="min-h-11 w-full rounded-[4px] border border-linen-300 text-[12px] text-ink-400 hover:bg-linen-200 hover:text-ink disabled:opacity-40">Change something</button>
    </section>
  );
}
