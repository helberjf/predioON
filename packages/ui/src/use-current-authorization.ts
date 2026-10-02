import { useEffect } from "react";
import type { AuthorizationResponse } from "@predioon/contracts/tenancy";
import { useResource } from "./use-resource.js";
import { authorizationPath, type AuthorizationTarget } from "./resource-permissions.js";

/** Call only for the current selection, never once per list row. */
export function useCurrentAuthorization(target: AuthorizationTarget | null) {
  const path = target ? authorizationPath(target) : null;
  const resource = useResource<AuthorizationResponse>(path);
  useEffect(() => {
    if (!path) return;
    window.addEventListener("focus", resource.reload);
    const timer = setInterval(resource.reload, 30_000);
    return () => { window.removeEventListener("focus", resource.reload); clearInterval(timer); };
  }, [path, resource.reload]);
  return resource;
}
