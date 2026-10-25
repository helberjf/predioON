export const runtimeRoles = {
  DATABASE_URL_APP: "predioon_app",
  DATABASE_URL_IDENTITY: "predioon_identity",
  DATABASE_URL_BROKER_AUTH: "predioon_broker_auth",
  DATABASE_URL_NOTIFICATIONS: "predioon_notifications",
  DATABASE_URL_INGEST: "predioon_ingest",
  DATABASE_URL_ACCESS_SERVICE: "predioon_access_service",
} as const;

export type RuntimeRole = (typeof runtimeRoles)[keyof typeof runtimeRoles];
export type RuntimeRoleCredential = { role: RuntimeRole; password: string };

function parseConnection(environment: Record<string, string | undefined>, key: string): URL {
  try {
    const url = new URL(environment[key] ?? "");
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password || url.pathname.length < 2) throw new Error();
    for (const [parameter, value] of url.searchParams) {
      if (parameter.includes("\0") || value.includes("\0") ||
        ["role", "options", "session_authorization", "user", "database", "client_encoding"].includes(parameter.trim().toLowerCase())) throw new Error();
    }
    decodeURIComponent(url.username); decodeURIComponent(url.password); decodeURIComponent(url.pathname);
    return url;
  } catch { throw new Error(`${key}: conexão PostgreSQL inválida ou incompleta`); }
}

/** Validate the entire configuration before any credential can be changed. */
export function runtimeRoleCredentials(environment: Record<string, string | undefined>, scope: "all" | "api" = "all"): RuntimeRoleCredential[] {
  const owner = parseConnection(environment, "DATABASE_URL");
  return Object.entries(runtimeRoles).filter(([key]) => scope === "all" ||
    ["DATABASE_URL_APP", "DATABASE_URL_IDENTITY", "DATABASE_URL_BROKER_AUTH"].includes(key)).map(([key, role]) => {
    const connection = parseConnection(environment, key);
    if (decodeURIComponent(connection.username) !== role || connection.hostname !== owner.hostname ||
      (connection.port || "5432") !== (owner.port || "5432") || connection.pathname !== owner.pathname || connection.username === owner.username) {
      throw new Error(`${key}: use a role ${role} no mesmo servidor e banco de DATABASE_URL`);
    }
    return { role, password: decodeURIComponent(connection.password) };
  });
}
