import "./env.js";
import postgres from "postgres";
import { runtimeRoles, type RuntimeRole } from "./runtime-role-credentials.js";

export type RuntimeDatabaseRole = RuntimeRole;
type RuntimeDatabaseVariable = keyof typeof runtimeRoles;

/** The owner DATABASE_URL must never be a runtime fallback. */
export function runtimeDatabaseUrl(variable: RuntimeDatabaseVariable, role: RuntimeDatabaseRole): string {
  if (runtimeRoles[variable] !== role) throw new Error(`${variable}: role restrita incompatível`);
  const configured = process.env[variable];
  if (configured?.trim()) {
    try {
      const parsed = new URL(configured);
      if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.username || parsed.pathname.length < 2) throw new Error("Invalid URL");
      for (const parameter of parsed.searchParams.keys()) {
        if (["role", "options", "session_authorization"].includes(parameter.trim().toLowerCase())) throw new Error("Unsafe startup parameter");
      }
      // postgres decodes credentials during construction. Validate escapes here,
      // inside the sanitizing boundary, before invoking the driver's constructor.
      if (decodeURIComponent(parsed.username) !== role) throw new Error("Unexpected runtime username");
      decodeURIComponent(parsed.password); decodeURIComponent(parsed.pathname);
      return configured;
    } catch {
      throw new Error(`${variable} contém uma URL de banco inválida`);
    }
  }
  if (process.env.NODE_ENV === "production" || variable === "DATABASE_URL_NOTIFICATIONS") throw new Error(`${variable} é obrigatória para este runtime`);
  return `postgres://${role}:${role}@localhost:5434/predioon`;
}

/** Keep driver option parsing inside the same secret-safe boundary as URL parsing. */
export function createRuntimeSqlClient(variable: RuntimeDatabaseVariable, role: RuntimeDatabaseRole, max: number): postgres.Sql {
  try {
    return postgres(runtimeDatabaseUrl(variable, role), { max, connect_timeout: 5 });
  } catch {
    throw new Error(`${variable}: configuração de banco restrita inválida`);
  }
}

/** Check the actual server identity, not the untrusted username written in a DSN. */
export async function verifyRestrictedDatabaseRole(client: postgres.Sql, expectedRole: RuntimeDatabaseRole): Promise<void> {
  try {
    const [role] = await client`
      select current_user as effective_user, session_user as session_user_name,
        r.rolname, r.rolsuper, r.rolbypassrls, r.rolinherit, r.rolcreatedb, r.rolcreaterole, r.rolreplication,
        exists(select 1 from pg_catalog.pg_auth_members m where m.member=r.oid or (r.rolname='predioon_notifications' and m.roleid=r.oid)) as has_memberships,
        exists(select 1 from pg_catalog.pg_shdepend d where d.refclassid='pg_catalog.pg_authid'::pg_catalog.regclass and d.refobjid=r.oid and d.deptype='o') as owns_objects
      from pg_catalog.pg_stat_activity a join pg_catalog.pg_roles r on r.oid=a.usesysid
      where a.pid=pg_catalog.pg_backend_pid()`;
    // SET ROLE changes current_user; a superuser can also change session_user.
    // pg_stat_activity retains the authenticated backend identity in usesysid.
    if (!role || role.rolname !== expectedRole || role.effective_user !== expectedRole || role.session_user_name !== expectedRole ||
      role.rolsuper || role.rolbypassrls || role.rolinherit ||
      role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.has_memberships || role.owns_objects) {
      throw new Error("Invalid runtime role");
    }
  } catch {
    // PostgreSQL errors can contain connection details; never expose their cause.
    throw new Error(`Credencial de banco restrita inválida ou indisponível: ${expectedRole}`);
  }
}
