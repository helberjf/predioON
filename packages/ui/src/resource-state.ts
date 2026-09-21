export type ResourceState<T> = { path: string | null; data: T | null; error: string | null; loading: boolean };
type Action<T> = { type: "start"; path: string | null } | { type: "success"; data: T } | { type: "error"; error: string };

export function resourceReducer<T>(state: ResourceState<T>, action: Action<T>): ResourceState<T> {
  if (action.type === "start") return {
    path: action.path, data: action.path && action.path === state.path ? state.data : null,
    error: null, loading: Boolean(action.path),
  };
  if (action.type === "success") return { ...state, data: action.data, error: null, loading: false };
  return { ...state, data: null, error: action.error, loading: false };
}
