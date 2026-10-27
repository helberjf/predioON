import { migrationChecksum, type Migration } from "./migration-runner.js";

const reviewed: Record<string, { checksum: string; roles: string[] }> = {
  "015-api-runtime-roles": { checksum: "6d186c496b4835d3950694d6a2a9733612c0b4be345c88cb02ef04986790e1e2", roles: ["predioon_app", "predioon_identity", "predioon_broker_auth"] },
  "038-durable-alert-delivery": { checksum: "65c1b502621ceebc82021c9c94648de55e9ff9c63907237dd81866ce44f8c3c7", roles: ["predioon_notifications"] },
  "052-ingest-runtime-roles": { checksum: "95d5c8fd9a1f1268ad8c97e02ba92919d311d707deeaa3179ee9526d68683ed4", roles: ["predioon_ingest", "predioon_access_service"] },
};

/** Neon cannot execute ALTER ROLE ... NOSUPERUSER even for an ordinary role.
 * Assert the same postcondition instead; preserve every other restriction.
 * Original SQL files stay immutable, and the adapter has its own ledger checksum.
 */
export function adaptNeonMigrations(migrations: Migration[]): Migration[] {
  return migrations.map(migration => {
    if (migration.id === "057-automation-schedules") {
      if (migration.execute || migrationChecksum(migration.source) !== "08d88f99f48ac0608144c9322f4510188207a62921b1751ebd0ba2016db09cf6") {
        throw new Error("Migration 057: perfil Neon demo exige revisão explícita do agendador");
      }
      // The Apache edition in Neon refuses add_job(). Keep the complete domain
      // schema/functions, and leave an explicit capability notice in the catalog.
      const registration = ` IF NOT EXISTS(SELECT 1 FROM timescaledb_information.jobs WHERE proc_schema='public' AND proc_name='app_automation_schedule_job') THEN
  PERFORM add_job('public.app_automation_schedule_job', interval '5 minutes');
 END IF;`;
      const executable = migration.source.replaceAll("\r\n", "\n").replace(registration, "") +
        "\nCOMMENT ON PROCEDURE app_automation_schedule_job(integer,jsonb) IS 'Neon demo: scheduler unavailable; use the VPS deployment for scheduled automations.';\n";
      return { id: migration.id, source: `${migration.source}\n-- Reviewed Neon demo scheduler adapter v1 follows:\n${executable}`,
        execute: async connection => { await connection.unsafe(executable); } };
    }
    const target = reviewed[migration.id];
    if (!target) return migration;
    if (migration.execute || migrationChecksum(migration.source) !== target.checksum) {
      throw new Error(`Migration ${migration.id}: adapte o perfil Neon somente após revisão explícita do SQL`);
    }
    const guard = `DO $neon_role_guard$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN (${target.roles.map(role => `'${role}'`).join(",")}) AND rolsuper) THEN
  RAISE EXCEPTION 'Neon runtime role must not be a superuser' USING ERRCODE='42501';
 END IF;
END $neon_role_guard$;`;
    const executable = `${guard}\n${migration.source.replaceAll(/\bNOSUPERUSER\b/g, "")}\n${guard}`;
    return {
      id: migration.id,
      source: `${migration.source}\n-- Reviewed Neon role adapter v1 follows:\n${executable}`,
      execute: async connection => { await connection.unsafe(executable); },
    };
  });
}
