import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

type Resource<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void };

/** Minimal data hook: one request, one reload, no cache. Enough for panels of this size. */
export function useResource<T>(path: string | null, deps: unknown[] = []): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!path) return;
    let active = true;
    setLoading(true);
    api
      .get<T>(path)
      .then((result) => active && setData(result))
      .catch((cause: unknown) => active && setError(cause instanceof Error ? cause.message : "Falha ao carregar"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  return { data, error, loading, reload };
}
