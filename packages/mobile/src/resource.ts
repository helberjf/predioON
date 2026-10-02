import { useEffect, useState } from "react";
import { AppState } from "react-native";
import type { ApiClient } from "@predioon/api-client";

export type Resource<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
  reload(): void;
};
export function useResource<T>(
  api: ApiClient,
  path: string | null,
): Resource<T> {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<
    Omit<Resource<T>, "reload"> & { path: string | null }
  >({ path, data: null, error: null, loading: true, updatedAt: null });
  useEffect(() => {
    let live = true;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = AppState.currentState === "active";
    async function load() {
      if (!live || !active || pending || !path) return;
      pending = true;
      setState((previous) => ({
        ...previous,
        path,
        data: previous.path === path ? previous.data : null,
        loading: true,
      }));
      try {
        const data = await api.get<T>(path);
        if (live && active)
          setState({
            path,
            data,
            error: null,
            loading: false,
            updatedAt: Date.now(),
          });
      } catch (error) {
        if (live && active)
          setState((previous) => ({
            ...previous,
            data: null,
            error:
              error instanceof Error ? error.message : "Falha ao carregar.",
            loading: false,
          }));
      } finally {
        pending = false;
        if (live && active) timer = setTimeout(() => void load(), 15_000);
      }
    }
    if (!path)
      setState({
        path,
        data: null,
        error: null,
        loading: false,
        updatedAt: null,
      });
    else void load();
    const listener = AppState.addEventListener("change", (next) => {
      active = next === "active";
      clearTimeout(timer);
      // Clear cached screen data on backgrounding; this is not an OS screenshot guarantee.
      if (!active)
        setState({
          path,
          data: null,
          error: null,
          loading: false,
          updatedAt: null,
        });
      else void load();
    });
    return () => {
      live = false;
      clearTimeout(timer);
      listener.remove();
    };
  }, [api, path, revision]);
  return {
    ...(state.path === path
      ? state
      : { data: null, error: null, loading: true, updatedAt: null }),
    reload: () => setRevision((value) => value + 1),
  };
}
