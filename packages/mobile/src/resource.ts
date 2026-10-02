import { useEffect, useState } from "react";
import { AppState } from "react-native";
import type { ApiClient } from "@predioon/api-client";
import { createResourcePoller } from "./resource-poller.ts";

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
    if (!path) {
      setState({ path, data: null, error: null, loading: false, updatedAt: null });
      return;
    }
    const poller = createResourcePoller({
      active: AppState.currentState === "active",
      read: () => api.get<T>(path),
      loading: () =>
        setState((previous) => ({
          ...previous,
          path,
          data: previous.path === path ? previous.data : null,
          loading: true,
        })),
      loaded: (data) =>
        setState({
          path,
          data,
          error: null,
          loading: false,
          updatedAt: Date.now(),
        }),
      failed: (error) =>
        setState((previous) => ({
          ...previous,
          data: null,
          error: error instanceof Error ? error.message : "Falha ao carregar.",
          loading: false,
        })),
      // This clears screen data; it is not an OS screenshot guarantee.
      inactive: () =>
        setState({
          path,
          data: null,
          error: null,
          loading: false,
          updatedAt: null,
        }),
    });
    poller.start();
    const listener = AppState.addEventListener("change", (next) => {
      poller.setActive(next === "active");
    });
    return () => {
      poller.dispose();
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
