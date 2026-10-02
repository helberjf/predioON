import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { loadTenancyCollection } from "./tenancy-state.js";

export function useTenancyCollection<T extends { id: string }>(path: string | null) {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ path: string | null; data: T[]; loading: boolean; error: string | null }>({ path, data: [], loading: Boolean(path), error: null });
  const reload = useCallback(() => setNonce(value => value + 1), []);
  useEffect(() => {
    let active = true;
    setState({ path, data: [], loading: Boolean(path), error: null });
    if (path) void loadTenancyCollection<T>(path, route => api.get(route), () => active)
      .then(data => { if (active) setState({ path, data, loading: false, error: null }); })
      .catch((cause: unknown) => { if (active) setState({ path, data: [], loading: false, error: cause instanceof Error ? cause.message : "Falha ao consultar o cadastro." }); });
    return () => { active = false; };
  }, [path, nonce]);
  return state.path === path ? { ...state, reload } : { data: [] as T[], loading: Boolean(path), error: null, reload };
}
