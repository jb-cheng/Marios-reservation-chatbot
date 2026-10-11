import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ApiError,
  approveReservation,
  fetchQueue,
  rejectReservation,
  resetQueue,
  subscribeQueue,
} from "@/api/client";
import type { QueueSnapshot, Reservation } from "@/state/types";

/**
 * The staff queue.
 *
 * Deliberately plain: this is an internal tool, and the brief asks for minimal
 * styling. It is a table with two buttons per row, and the only visual emphasis is
 * reserved for a table clash, which is the one thing on this page that means
 * something went wrong.
 *
 * Freshness comes from the server's event stream rather than a polling interval,
 * because criterion 8 asks for a new booking to appear within a second and an
 * interval can only promise its own length. A refetch on focus and a manual button
 * back it up, so a dropped stream cannot leave stale rows on screen.
 */
export function AdminPage() {
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const snapshot = await fetchQueue();
      setQueue(snapshot);
      setError(null);
      setUpdatedAt(new Date());
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? `Could not load the queue: ${cause.message}`
          : "Could not load the queue.",
      );
    }
  }, []);

  useEffect(() => {
    void refresh();

    const unsubscribe = subscribeQueue({
      onEvent: () => void refresh(),
      onOpen: () => setLive(true),
      onError: () => setLive(false),
    });

    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const decide = async (submissionId: string, action: "approve" | "reject") => {
    setBusyId(submissionId);
    try {
      if (action === "approve") await approveReservation(submissionId);
      else await rejectReservation(submissionId);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? `Could not ${action} that booking: ${cause.message}`
          : `Could not ${action} that booking.`,
      );
    } finally {
      setBusyId(null);
    }
  };

  const clashes = queue?.double_booked ?? [];

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-8 text-neutral-900">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Reservation queue</h1>
            <p className="text-sm text-neutral-500">
              Approving moves a booking to the official list and tells the customer
              nothing, because they were told at submission. Rejecting is the only
              decision that contacts them.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-neutral-500">
            <span aria-live="polite">
              {updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : "Loading"}
            </span>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded border border-neutral-300 px-2.5 py-1 text-neutral-700 hover:border-neutral-400 hover:bg-white"
            >
              Refresh
            </button>
          </div>
        </header>

        {error && (
          <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        {clashes.length > 0 && (
          <section className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-medium">
              {clashes.length} table {clashes.length === 1 ? "clash" : "clashes"}
            </p>
            <p className="text-amber-800">
              Availability gates every submission, so this should be empty. A clash
              means something wrote a booking without asking the room first.
            </p>
            <ul className="mt-1 list-inside list-disc text-amber-900">
              {clashes.map((clash) => (
                <li key={`${clash.date}-${clash.time}-${clash.table_id}`}>
                  {clash.date} {clash.time}, table {clash.table_id}: {clash.claims}{" "}
                  claims
                </li>
              ))}
            </ul>
          </section>
        )}

        <Section title="Awaiting a decision" count={queue?.pending.length ?? 0}>
          {queue && queue.pending.length > 0 ? (
            <Table
              rows={queue.pending}
              busyId={busyId}
              onDecide={(id, action) => void decide(id, action)}
            />
          ) : (
            <Empty label="Nothing waiting." />
          )}
        </Section>

        <Section title="Approved" count={queue?.official.length ?? 0}>
          {queue && queue.official.length > 0 ? (
            <Table rows={queue.official} busyId={busyId} onDecide={null} />
          ) : (
            <Empty label="No approved bookings yet." />
          )}
        </Section>

        <footer className="flex items-center justify-between border-t border-neutral-200 pt-4 text-xs text-neutral-500">
          <span>
            {live ? "Live updates on." : "Live updates interrupted; refetching on focus."}
          </span>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Clear every pending and approved booking?")) {
                void resetQueue().then(() => refresh());
              }
            }}
            className="rounded border border-neutral-300 px-2.5 py-1 text-neutral-600 hover:border-red-300 hover:text-red-700"
          >
            Reset for a demo rerun
          </button>
        </footer>
      </div>
    </main>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-neutral-700">
        {title} <span className="text-neutral-400">({count})</span>
      </h2>
      <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
        {children}
      </div>
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="px-3 py-6 text-sm text-neutral-400">{label}</p>;
}

function Table({
  rows,
  busyId,
  onDecide,
}: {
  rows: Reservation[];
  busyId: string | null;
  onDecide: ((submissionId: string, action: "approve" | "reject") => void) | null;
}) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
          <Head>When</Head>
          <Head>Party</Head>
          <Head>Table</Head>
          <Head>Name</Head>
          <Head>Contact</Head>
          <Head>Notes</Head>
          <Head>Age</Head>
          {onDecide && <Head>Decision</Head>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.submission_id}
            className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
          >
            <Cell>
              {row.date} {row.time}
            </Cell>
            <Cell>{row.party_size}</Cell>
            <Cell>
              {row.table_id}
              <span className="block text-xs text-neutral-400">{row.table_type}</span>
            </Cell>
            <Cell>{row.name}</Cell>
            <Cell>
              {row.email}
              <span className="block text-xs text-neutral-400">{row.phone}</span>
            </Cell>
            <Cell>{row.special_requests ?? ""}</Cell>
            <Cell>{age(row.created_at)}</Cell>
            {onDecide && (
              <Cell>
                <span className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === row.submission_id}
                    onClick={() => onDecide(row.submission_id, "approve")}
                    className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-50 disabled:opacity-40"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busyId === row.submission_id}
                    onClick={() => onDecide(row.submission_id, "reject")}
                    className="rounded border border-red-300 px-2 py-1 text-xs text-red-800 hover:bg-red-50 disabled:opacity-40"
                  >
                    Reject
                  </button>
                </span>
              </Cell>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Head({ children }: { children: ReactNode }) {
  return <th className="px-3 py-2 text-left align-bottom font-medium">{children}</th>;
}

function Cell({ children }: { children: ReactNode }) {
  return <td className="px-3 py-2 align-top">{children}</td>;
}

function age(createdAt: string): string {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - created) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}
