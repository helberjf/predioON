export type ResourceState<T> = { path: string | null; data: T | null; error: string | null; errorStatus?: number | null; loading: boolean };
type Action<T> = { type: "start"; path: string | null } | { type: "success"; data: T } | { type: "error"; error: string; status?: number };

export function resourceReducer<T>(state: ResourceState<T>, action: Action<T>): ResourceState<T> {
  if (action.type === "start") return {
    path: action.path, data: action.path && action.path === state.path ? state.data : null,
    error: null, errorStatus: null, loading: Boolean(action.path),
  };
  if (action.type === "success") return { ...state, data: action.data, error: null, errorStatus: null, loading: false };
  return { ...state, data: null, error: action.error, errorStatus: action.status ?? null, loading: false };
}
