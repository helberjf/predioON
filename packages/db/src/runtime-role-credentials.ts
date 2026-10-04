export const runtimeRoles = {
  DATABASE_URL_APP: "predioon_app",
  DATABASE_URL_IDENTITY: "predioon_identity",
  DATABASE_URL_BROKER_AUTH: "predioon_broker_auth",
  DATABASE_URL_NOTIFICATIONS: "predioon_notifications",
} as const;

export type RuntimeRole = (typeof runtimeRoles)[keyof typeof runtimeRoles];
export type RuntimeRoleCredential = { role: RuntimeRole; password: string };

function parseConnection(environment: Record<string, string | undefined>, key: string): URL {
  try {
    const url = new URL(environment[key] ?? "");
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password || url.pathname.length < 2) throw new Error();
    for (const parameter of url.searchParams.keys()) {
      if (["role", "options", "session_authorization"].includes(parameter.trim().toLowerCase())) throw new Error();
    }
    decodeURIComponent(url.username); decodeURIComponent(url.password); decodeURIComponent(url.pathname);
    return url;
  } catch { throw new Error(`${key}: conexão PostgreSQL inválida ou incompleta`); }
}

/** Validate the entire configuration before any credential can be changed. */
export function runtimeRoleCredentials(environment: Record<string, string | undefined>): RuntimeRoleCredential[] {
  const owner = parseConnection(environment, "DATABASE_URL");
  return Object.entries(runtimeRoles).map(([key, role]) => {
    const connection = parseConnection(environment, key);
    if (decodeURIComponent(connection.username) !== role || connection.hostname !== owner.hostname ||
      (connection.port || "5432") !== (owner.port || "5432") || connection.pathname !== owner.pathname || connection.username === owner.username) {
      throw new Error(`${key}: use a role ${role} no mesmo servidor e banco de DATABASE_URL`);
    }
    return { role, password: decodeURIComponent(connection.password) };
  });
}
