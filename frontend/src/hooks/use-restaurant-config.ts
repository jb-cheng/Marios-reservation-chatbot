import { useEffect, useState } from "react";

import { ApiError, fetchConfig } from "@/api/client";
import type { RestaurantConfig } from "@/state/types";

/**
 * Restaurant facts, fetched once per page.
 *
 * The conversation and the marketing sections both need the opening hours and
 * the answers to general questions, and neither owns them. Sharing one promise
 * means one request rather than two, and it keeps a single source for a fact
 * that the availability engine also depends on.
 */
let inflight: Promise<RestaurantConfig> | null = null;

function loadConfig(): Promise<RestaurantConfig> {
  inflight ??= fetchConfig();
  return inflight;
}

export function useRestaurantConfig(): {
  config: RestaurantConfig | null;
  error: string | null;
} {
  const [config, setConfig] = useState<RestaurantConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadConfig()
      .then((loaded) => {
        if (!cancelled) setConfig(loaded);
      })
      .catch((cause: unknown) => {
        // A failed attempt is not cached, so a later mount can try again.
        inflight = null;
        if (cancelled) return;
        setError(
          cause instanceof ApiError
            ? "Could not reach the reservation service. Details may not validate."
            : "Could not load the restaurant details.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { config, error };
}