import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, ApiError } from "./api.js";
import { resourceReducer } from "./resource-state.js";

type Resource<T> = { data: T | null; error: string | null; errorStatus?: number | null; loading: boolean; reload: () => void };

/** Minimal data hook: one request, one reload, no cache. Enough for panels of this size. */
export function useResource<T>(path: string | null, deps: unknown[] = []): Resource<T> {
  const [state, dispatch] = useReducer(resourceReducer<T>, { path, data: null, error: null, loading: Boolean(path) });
  const [nonce, setNonce] = useState(0);
  const pending = useRef(false);

  // Polling must not discard a response that takes longer than the refresh interval.
  const reload = useCallback(() => { if (!pending.current) setNonce((value) => value + 1); }, []);

  useEffect(() => {
    dispatch({ type: "start", path });
    pending.current = Boolean(path);
    if (!path) return;
    let active = true;
    api
      .get<T>(path)
      .then((data) => active && dispatch({ type: "success", data }))
      .catch((cause: unknown) => active && dispatch({ type: "error", error: cause instanceof Error ? cause.message : "Falha ao carregar", status: cause instanceof ApiError ? cause.status : undefined }))
      .finally(() => { if (active) pending.current = false; });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  // Never expose the previous sensor/building while the new effect is being scheduled.
  return state.path === path ? { ...state, reload } : { data: null, error: null, loading: Boolean(path), reload };
}
