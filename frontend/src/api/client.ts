import { API_BASE } from "@/config";
import type {
  AvailabilityStatus,
  ChatPayload,
  QueueSnapshot,
  ReservationState,
  RestaurantConfig,
  SlotAlternative,
  SlotValues,
  SubmitOutcome,
  TurnResponse,
} from "@/state/types";
import {
  browserStorage,
  getSessionId,
  readState,
  toChatPayload,
} from "@/state/storage";
import type { KVStorage } from "@/state/storage";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (cause) {
    // No status code exists here: the backend is unreachable, which for a demo on
    // campus wifi is a distinct failure worth naming rather than reporting as a
    // generic error.
    throw new ApiError("cannot reach the reservation service", 0, String(cause));
  }

  const text = await response.text();
  const body: unknown = text === "" ? null : safeParse(text);

  if (!response.ok) {
    throw new ApiError(
      `request to ${path} failed with ${response.status}`,
      response.status,
      body,
    );
  }

  return body as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function jsonBody(payload: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export function fetchConfig(): Promise<RestaurantConfig> {
  return request<RestaurantConfig>("/api/config");
}

export function postChat(payload: ChatPayload): Promise<TurnResponse> {
  return request<TurnResponse>("/api/chat", jsonBody(payload));
}

export function fetchAvailability(params: {
  date: string;
  time: string;
  party_size: number;
  type?: string | null;
}): Promise<AvailabilityStatus> {
  const query = new URLSearchParams({
    date_text: params.date,
    time_text: params.time,
    party_size: String(params.party_size),
  });
  if (params.type) query.set("type_text", params.type);

  return request<AvailabilityStatus>(`/api/availability?${query.toString()}`);
}

/**
 * The one tool call in the system, and it takes no arguments.
 *
 * Everything it needs comes from the browser's own memory: the state the customer
 * built up over the conversation, and the session id that ties the draft to the
 * queue. The model never supplies a value here, which is why it cannot book a
 * table the customer did not ask for.
 */
export async function submitReservation(
  store: KVStorage = browserStorage,
): Promise<SubmitOutcome> {
  const state: ReservationState = readState(store);
  const body: SlotValues & { session_id: string } = {
    ...toChatPayload(state),
    session_id: getSessionId(store),
  };

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/submit`, jsonBody(body));
  } catch (cause) {
    throw new ApiError("cannot reach the reservation service", 0, String(cause));
  }

  const text = await response.text();
  const payload: unknown = text === "" ? null : safeParse(text);

  if (response.status === 409) {
    const detail = (payload ?? {}) as { alternatives?: SlotAlternative[] };
    return { kind: "slot_taken", alternatives: detail.alternatives ?? [] };
  }

  if (response.status === 422) {
    const detail = (payload ?? {}) as {
      error?: string;
      missing?: string[];
      slots?: string[];
      largest_table?: number;
    };
    if (detail.error === "no_table") {
      return { kind: "no_table", largest_table: detail.largest_table ?? 0 };
    }
    return {
      kind: "invalid",
      error: detail.error ?? "rejected",
      missing: detail.missing,
      slots: detail.slots,
    };
  }

  if (!response.ok) {
    throw new ApiError(
      `submission failed with ${response.status}`,
      response.status,
      payload,
    );
  }

  const accepted = (payload ?? {}) as {
    submission_id?: string;
    table_id?: string;
    state?: string;
  };
  return {
    kind: accepted.state === "already_submitted" ? "already_submitted" : "pending",
    submission_id: accepted.submission_id ?? "",
    table_id: accepted.table_id ?? "",
  };
}

export function fetchQueue(): Promise<QueueSnapshot> {
  return request<QueueSnapshot>("/api/admin/queue");
}

export function approveReservation(submissionId: string): Promise<unknown> {
  return request(`/api/admin/approve/${submissionId}`, { method: "POST" });
}

export function rejectReservation(submissionId: string): Promise<unknown> {
  return request(`/api/admin/reject/${submissionId}`, { method: "POST" });
}

export function resetQueue(): Promise<{ cleared: boolean }> {
  return request("/api/admin/reset", { method: "POST" });
}

/**
 * Live queue updates.
 *
 * Criterion 8 asks for a new booking to appear within a second, which polling
 * cannot promise. The server publishes on submission and the admin page listens,
 * with a full refetch on reconnect so a dropped stream cannot leave the queue
 * showing stale rows.
 */
export function subscribeQueue(handlers: {
  onEvent: () => void;
  onOpen?: () => void;
  onError?: () => void;
}): () => void {
  const source = new EventSource(`${API_BASE}/api/admin/stream`);

  const notify = () => handlers.onEvent();
  source.addEventListener("reservation", notify);
  source.onopen = () => {
    handlers.onOpen?.();
    notify();
  };
  source.onerror = () => {
    handlers.onError?.();
    // Refetch on failure too: the stream may have missed events while it was down,
    // and EventSource reconnects on its own.
    handlers.onEvent();
  };

  return () => source.close();
}
