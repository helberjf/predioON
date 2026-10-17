import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";
import postgres from "postgres";
import { baseline, inspectBaseline } from "../../src/baseline-schema.js";
import { applyInfrastructure, loadInfrastructureMigrations } from "../../src/infrastructure-migrations.js";
import { migrationChecksum, type Migration } from "../../src/migration-runner.js";
import { runtimeRoles, type RuntimeRole } from "../../src/runtime-role-credentials.js";

// Administrative test utility: never import a runtime entrypoint, which opens pools eagerly.
const run = promisify(execFile);
const packageDirectory = fileURLToPath(new URL("../../", import.meta.url));
const projectEnv = new URL("../../../../.env", import.meta.url);
const roleNames = Object.values(runtimeRoles);
const roleList = roleNames.map(role => `'${role}'`).join(","); // Fixed source constants only.
const requiredVariables = ["TEST_INGEST_DISPOSABLE_DB", "TEST_INGEST_DATABASE_URL",
  "TEST_INGEST_EXPECTED_SYSTEM_IDENTIFIER", "TEST_INGEST_CONTAINER_ID", "TEST_INGEST_EXPECTED_CONTAINER_ID"] as const;
export const runtimeServicesSkipReason = "requires complete TEST_INGEST_* opt-in and a root-attested exclusive disposable PostgreSQL cluster";

type Configuration = { adminUrl: string; systemIdentifier: string; containerId: string };
type RuntimeUrls = Record<keyof typeof runtimeRoles, string>;
type ServiceRole = "predioon_ingest" | "predioon_access_service";
type RoleSnapshot = {
  oid: number; rolname: RuntimeRole; rolsuper: boolean; rolinherit: boolean; rolcreaterole: boolean;
  rolcreatedb: boolean; rolcanlogin: boolean; rolreplication: boolean; rolbypassrls: boolean;
  rolconnlimit: number; rolpassword: string | null; rolvaliduntil: string | null;
  has_memberships: boolean; owns_objects: boolean;
};
type RoleSetting = { rolname: RuntimeRole; database_oid: number; database_name: string | null; setconfig: string[] };

function preflight(message: string): never { throw new Error(`Runtime services fixture preflight: ${message}`); }

type FixtureOptions = { baselineRelease?: 51 };
export function baselineRuntimeServicesMigrations(migrations: Migration[], options: FixtureOptions = {}): Migration[] {
  if (migrations.length < 51 || migrations.length > 52 ||
    (options.baselineRelease !== undefined && options.baselineRelease !== 51)) {
    preflight("this bounded fixture requires the reviewed 051 or 052 release and an optional 051 baseline");
  }
  return options.baselineRelease === 51 ? migrations.slice(0, 51) : migrations;
}
export function candidateRunnerSqlState(error: unknown): string | undefined {
  return error instanceof Error ? /^Migration 052-[a-z0-9-]+ não foi confirmada \(([A-Z0-9]{5})\); consulte schema_migrations antes de repetir$/.exec(error.message)?.[1] : undefined;
}
type RoleIdentity = { rolname: string; oid: number; has_memberships?: boolean; owns_objects?: boolean };
export function rememberFixtureRoleOids(initial: readonly RoleIdentity[], current: readonly RoleIdentity[],
  recorded: Map<RuntimeRole, number>): void {
  for (const role of current) {
    if (!roleNames.includes(role.rolname as RuntimeRole)) continue;
    const name = role.rolname as RuntimeRole;
    const original = initial.find(value => value.rolname === name);
    const expected = original?.oid ?? recorded.get(name);
    if (expected !== undefined && expected !== role.oid) throw new Error("fixture role identity changed");
    if (!original) recorded.set(name, role.oid);
  }
}

export async function mutateVerifiedServiceRoles(initial: readonly RoleIdentity[], current: readonly RoleIdentity[],
  recorded: ReadonlyMap<RuntimeRole, number>, mutate: (roles: readonly { rolname: ServiceRole; exists: boolean }[]) => Promise<void>): Promise<void> {
  // Validate both names before entering the callback: even the first ALTER must
  // not run when the other recorded identity has disappeared or been replaced.
  const plan = [runtimeRoles.DATABASE_URL_INGEST, runtimeRoles.DATABASE_URL_ACCESS_SERVICE].map(rolname => {
    const original = initial.find(role => role.rolname === rolname);
    const tracked = recorded.get(rolname);
    const present = current.find(role => role.rolname === rolname);
    if ((original && tracked !== undefined && original.oid !== tracked) || present?.oid !== (original?.oid ?? tracked)) {
      throw new Error("fixture service role identity changed before mutation");
    }
    return { rolname, exists: present !== undefined };
  });
  await mutate(plan);
}

/** This validates launcher assertions; it does not inspect or independently attest Docker. */
export function parseRuntimeServicesEnvironment(environment: Record<string, string | undefined>): Configuration | undefined {
  if (!Object.keys(environment).some(key => key.startsWith("TEST_INGEST_"))) return undefined;
  if (requiredVariables.some(key => !environment[key])) preflight("complete explicit opt-in is required");
  if (environment.TEST_INGEST_DISPOSABLE_DB !== "1") preflight("disposable database flag must equal 1");
  const containerId = environment.TEST_INGEST_CONTAINER_ID!;
  if (!/^[a-f0-9]{64}$/.test(containerId) || containerId !== environment.TEST_INGEST_EXPECTED_CONTAINER_ID) {
    preflight("the root launcher's full container identity must match");
  }
  const systemIdentifier = environment.TEST_INGEST_EXPECTED_SYSTEM_IDENTIFIER!;
  if (!/^[1-9][0-9]{0,19}$/.test(systemIdentifier)) preflight("a trusted PostgreSQL system identifier is required");
  const adminUrl = environment.TEST_INGEST_DATABASE_URL!;
  try {
    const parsed = new URL(adminUrl);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !["localhost", "127.0.0.1", "[::1]", "db"].includes(parsed.hostname) ||
      !parsed.username || !parsed.password || !/^\/[^/]+$/.test(parsed.pathname) || parsed.search || parsed.hash ||
      roleNames.includes(decodeURIComponent(parsed.username) as RuntimeRole)) throw new Error();
    for (const value of [parsed.username, parsed.password, parsed.pathname]) {
      if (decodeURIComponent(value).includes("\0")) throw new Error();
    }
  } catch { preflight("administrative URL must use a local host, explicit credentials and no startup parameters"); }
  return { adminUrl, systemIdentifier, containerId };
}

/** Never inherit NODE_OPTIONS, PG*, dotenv overrides or any unrelated application secret. */
export function provisionChildEnvironment(environment: Record<string, string | undefined>, ownerUrl: string,
  runtimeUrls: RuntimeUrls): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {};
  const osEssentials = new Set(["path", "systemroot", "windir", "temp", "tmp"]);
  for (const [key, value] of Object.entries(environment)) {
    if (osEssentials.has(key.toLowerCase()) && value !== undefined) child[key] = value;
  }
  child.NODE_ENV = "test";
  child.TSX_DISABLE_CACHE = "1";
  child.DATABASE_URL = ownerUrl;
  for (const variable of Object.keys(runtimeRoles) as Array<keyof typeof runtimeRoles>) child[variable] = runtimeUrls[variable];
  return child;
}

export function fixtureDatabaseNameIsSafe(name: string): boolean { return /^ingest_runtime_[a-f0-9]{32}$/.test(name); }
export const codeIs = (code: string) => (error: unknown): boolean => (error as { code?: unknown } | null)?.code === code;

/** Driver/exec errors may contain parameters or DSNs; retain only a bounded SQLSTATE. */
export async function safeDatabaseOperation<T>(label: string, operation: () => PromiseLike<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const sqlstate = typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
    throw Object.assign(new Error(`Runtime services fixture: ${label} failed${sqlstate ? ` (${sqlstate})` : ""}`),
      sqlstate ? { code: sqlstate } : {});
  }
}

async function refuseProjectDotEnv(): Promise<void> {
  try { await lstat(projectEnv); }
  catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return;
    preflight("cannot establish that the administrative child has no project .env fallback");
  }
  preflight("project .env must be absent in the isolated administrative checkout");
}

async function roleSnapshot(connection: postgres.ReservedSql): Promise<RoleSnapshot[]> {
  return connection.unsafe<RoleSnapshot[]>(`select r.oid::int, r.rolname, r.rolsuper, r.rolinherit,
    r.rolcreaterole, r.rolcreatedb, r.rolcanlogin, r.rolreplication, r.rolbypassrls,
    r.rolconnlimit, r.rolpassword, r.rolvaliduntil::text,
    exists(select 1 from pg_catalog.pg_auth_members m where m.member=r.oid or m.roleid=r.oid) as has_memberships,
    exists(select 1 from pg_catalog.pg_shdepend d where d.refclassid='pg_catalog.pg_authid'::regclass
      and d.refobjid=r.oid and d.deptype='o') as owns_objects
    from pg_catalog.pg_authid r where r.rolname in (${roleList}) order by r.rolname`);
}

async function roleSettings(connection: postgres.ReservedSql): Promise<RoleSetting[]> {
  return connection.unsafe<RoleSetting[]>(`select r.rolname, s.setdatabase::int as database_oid,
    d.datname as database_name, s.setconfig from pg_catalog.pg_db_role_setting s
    join pg_catalog.pg_authid r on r.oid=s.setrole left join pg_catalog.pg_database d on d.oid=s.setdatabase
    where r.rolname in (${roleList}) order by r.rolname,s.setdatabase`);
}

function roleIsSane(role: RoleSnapshot): boolean {
  return !role.rolsuper && !role.rolinherit && !role.rolcreaterole && !role.rolcreatedb &&
    !role.rolreplication && !role.rolbypassrls && !role.has_memberships && !role.owns_objects;
}

export type RuntimeServicesFixture = {
  owner: postgres.Sql; observer: postgres.Sql; ingest: postgres.Sql; access: postgres.Sql; databaseName: string;
  urls: { ingest: string; access: string };
  canonicalHistory: Array<{ id: string; checksum: string }>;
  candidate052: { id: string; checksum: string } | undefined;
  applyCandidate052: (options?: { failAtEnd?: true }) => Promise<string[]>;
  ensureServiceRoles: () => Promise<void>;
  provisionRuntime: () => Promise<void>;
  cleanup: () => Promise<void>;
};

/** Root must verify Docker id/label/volume and exclusive use before setting the opt-in. */
export async function createRuntimeServicesFixture(configuration: Configuration, fixtureOptions: FixtureOptions = {}): Promise<RuntimeServicesFixture> {
  // These read-only checks finish before constructing any PostgreSQL client.
  await refuseProjectDotEnv();
  const migrations = await safeDatabaseOperation("load reviewed canonical migration chain", loadInfrastructureMigrations);
  const baselineMigrations = baselineRuntimeServicesMigrations(migrations, fixtureOptions);
  const candidate = migrations[51];
  const databaseName = `ingest_runtime_${randomUUID().replaceAll("-", "")}`;
  if (!fixtureDatabaseNameIsSafe(databaseName)) preflight("invalid generated fixture database name");
  const ownerUrl = new URL(configuration.adminUrl); ownerUrl.pathname = `/${databaseName}`;
  const runtimeUrls = {} as RuntimeUrls;
  for (const [variable, role] of Object.entries(runtimeRoles)) {
    const url = new URL(ownerUrl); url.username = role; url.password = randomBytes(32).toString("hex");
    runtimeUrls[variable as keyof typeof runtimeRoles] = url.toString();
  }
  const options = { onnotice: () => {}, connect_timeout: 5 };
  const admin = postgres(configuration.adminUrl, { ...options, max: 1 });
  const owner = postgres(ownerUrl.toString(), { ...options, max: 3 });
  const observer = postgres(ownerUrl.toString(), { ...options, max: 1 });
  // postgres clients are lazy: no restricted authentication occurs before the feature contract.
  const ingest = postgres(runtimeUrls.DATABASE_URL_INGEST, { ...options, max: 10 });
  const access = postgres(runtimeUrls.DATABASE_URL_ACCESS_SERVICE, { ...options, max: 10 });
  let connection: postgres.ReservedSql | undefined;
  let locked = false;
  let createdDatabase = false;
  let databaseOid: number | undefined;
  let administratorOid: number | undefined;
  let initialRoles: RoleSnapshot[] = [];
  let initialSettings: RoleSetting[] = [];
  const createdRoles = new Map<RuntimeRole, number>();
  let finished = false;
  let provisioned = false;
  let roleMutationStarted = false;

  async function generatedStatement(query: PromiseLike<Array<{ ddl: string }>>): Promise<void> {
    const [statement] = await query;
    if (!statement?.ddl) throw new Error("missing controlled administrative statement");
    await connection!.unsafe(statement.ddl);
  }

  async function restoreRole(role: RoleSnapshot): Promise<void> {
    const current = (await roleSnapshot(connection!)).find(row => row.rolname === role.rolname);
    if (!current || current.oid !== role.oid || current.has_memberships || current.owns_objects) {
      throw new Error("original role identity or clean scope changed");
    }
    const flags = [role.rolsuper ? "SUPERUSER" : "NOSUPERUSER", role.rolinherit ? "INHERIT" : "NOINHERIT",
      role.rolcreaterole ? "CREATEROLE" : "NOCREATEROLE", role.rolcreatedb ? "CREATEDB" : "NOCREATEDB",
      role.rolcanlogin ? "LOGIN" : "NOLOGIN", role.rolreplication ? "REPLICATION" : "NOREPLICATION",
      role.rolbypassrls ? "BYPASSRLS" : "NOBYPASSRLS"].join(" ");
    await generatedStatement(connection!`select format('ALTER ROLE %I WITH %s CONNECTION LIMIT %s PASSWORD %L',
      ${role.rolname}::text, ${flags}::text, ${role.rolconnlimit}::int, ${role.rolpassword}::text) as ddl`);
    // Bootstrap/provision do not alter expiry. NULL has no exact ALTER ROLE representation;
    // unexpected NULL -> non-NULL is a cleanup failure for root, never a pg_authid UPDATE.
    if (current.rolvaliduntil !== role.rolvaliduntil) {
      if (role.rolvaliduntil === null) throw new Error("unexpected expiration change requires root recovery");
      await generatedStatement(connection!`select format('ALTER ROLE %I VALID UNTIL %L',
        ${role.rolname}::text, ${role.rolvaliduntil}::text) as ddl`);
    }
    const before = initialSettings.filter(value => value.rolname === role.rolname);
    const now = (await roleSettings(connection!)).filter(value => value.rolname === role.rolname);
    if (!isDeepStrictEqual(before, now)) {
      const databases = new Map([...now, ...before].map(value => [value.database_oid, value.database_name]));
      for (const [oid, name] of databases) {
        if (oid === 0) await generatedStatement(connection!`select format('ALTER ROLE %I RESET ALL', ${role.rolname}::text) as ddl`);
        else {
          if (!name) throw new Error("original role configuration database is unavailable");
          await generatedStatement(connection!`select format('ALTER ROLE %I IN DATABASE %I RESET ALL', ${role.rolname}::text, ${name}::text) as ddl`);
        }
      }
      for (const setting of before) for (const entry of setting.setconfig) {
        const separator = entry.indexOf("=");
        if (separator < 1) throw new Error("invalid original role configuration");
        const key = entry.slice(0, separator), value = entry.slice(separator + 1);
        if (setting.database_oid === 0) {
          await generatedStatement(connection!`select format('ALTER ROLE %I SET %I TO %L', ${role.rolname}::text, ${key}::text, ${value}::text) as ddl`);
        } else {
          await generatedStatement(connection!`select format('ALTER ROLE %I IN DATABASE %I SET %I TO %L',
            ${role.rolname}::text, ${setting.database_name}::text, ${key}::text, ${value}::text) as ddl`);
        }
      }
    }
  }

  async function cleanup(): Promise<void> {
    if (finished) return;
    finished = true;
    const failures: string[] = [];
    const attempt = async (label: string, operation: () => PromiseLike<unknown>) => {
      try { await operation(); } catch { failures.push(label); }
    };
    await attempt("close ingest client", () => ingest.end({ timeout: 5 }));
    await attempt("close access client", () => access.end({ timeout: 5 }));
    await attempt("close independent owner client", () => observer.end({ timeout: 5 }));
    await attempt("close owner client", () => owner.end({ timeout: 5 }));
    if (connection && createdDatabase) {
      await attempt("drop only the fixture UUID database", async () => {
        if (!fixtureDatabaseNameIsSafe(databaseName)) throw new Error();
        const [current] = await connection!`select oid::int, datdba::int from pg_database where datname=${databaseName}`;
        if (!current || (databaseOid !== undefined && current.oid !== databaseOid) || current.datdba !== administratorOid) throw new Error();
        await connection!.unsafe(`DROP DATABASE "${databaseName}"`);
        createdDatabase = false;
      });
    }
    // Never broaden the scope with DROP OWNED, memberships or grants in another database.
    if (connection && locked) {
      if (roleMutationStarted) for (const role of initialRoles) await attempt(`restore ${role.rolname}`, () => restoreRole(role));
      if (roleMutationStarted && !createdDatabase) for (const [name, oid] of createdRoles) {
        await attempt(`remove fixture-created ${name}`, async () => {
          const current = (await roleSnapshot(connection!)).find(role => role.rolname === name);
          if (!current || current.oid !== oid || !roleIsSane(current) || initialRoles.some(role => role.rolname === name)) throw new Error();
          await generatedStatement(connection!`select format('DROP ROLE %I', ${name}::text) as ddl`);
        });
      }
      if (roleMutationStarted) await attempt("verify exact original roles and configuration", async () => {
        const roles = await roleSnapshot(connection!);
        const settings = await roleSettings(connection!);
        // Deliberately compare in memory: assert diff/log output must never contain hashes or settings.
        if (!isDeepStrictEqual(roles, initialRoles) || !isDeepStrictEqual(settings, initialSettings)) throw new Error();
      });
      await attempt("release cluster fixture lock", () => connection!`select pg_advisory_unlock(hashtextextended('predioon:runtime-services-fixture',0))`);
    }
    if (connection) await attempt("release administrative connection", async () => { connection!.release(); });
    await attempt("close administrative client", () => admin.end({ timeout: 5 }));
    if (failures.length) throw new Error(`Runtime services fixture cleanup failed: ${failures.join("; ")}. Root must inspect the exclusive test cluster; diagnostics omit secrets.`);
  }

  try {
    connection = await admin.reserve();
    const [identity] = await connection`select c.system_identifier::text, r.oid::int as administrator_oid,
      r.rolsuper, current_user=session_user and current_user=r.rolname as real_administrator,
      current_setting('server_version_num')::int as version
      from pg_control_system() c cross join pg_stat_activity a join pg_roles r on r.oid=a.usesysid
      where a.pid=pg_backend_pid()`;
    if (!identity || identity.system_identifier !== configuration.systemIdentifier || !identity.rolsuper ||
      !identity.real_administrator || identity.version < 160000 || identity.version >= 170000) {
      preflight("actual PostgreSQL identity, administrator or major version 16 does not match the root attestation");
    }
    administratorOid = identity.administrator_oid;
    const [lock] = await connection`select pg_try_advisory_lock(hashtextextended('predioon:runtime-services-fixture',0)) as locked`;
    if (!lock?.locked) preflight("another runtime-services fixture is active; run role-changing suites sequentially");
    locked = true;
    initialRoles = await roleSnapshot(connection);
    initialSettings = await roleSettings(connection);
    if (initialRoles.some(role => !roleIsSane(role))) preflight("initial runtime roles must have restricted flags, no ownership and no memberships in either direction");
    await connection.unsafe(`CREATE DATABASE "${databaseName}"`);
    createdDatabase = true;
    const [database] = await connection`select oid::int from pg_database where datname=${databaseName}`;
    databaseOid = database?.oid;
    await owner.begin(async transaction => {
      if (!(await inspectBaseline(transaction)).empty) throw new Error("new fixture database is not empty");
      await transaction.unsafe(baseline);
    });
    roleMutationStarted = true;
    try { await applyInfrastructure(owner, baselineMigrations); }
    finally { rememberFixtureRoleOids(initialRoles, await roleSnapshot(connection), createdRoles); }
    return {
      owner, observer, ingest, access, databaseName,
      urls: { ingest: runtimeUrls.DATABASE_URL_INGEST, access: runtimeUrls.DATABASE_URL_ACCESS_SERVICE },
      canonicalHistory: baselineMigrations.map(migration => ({ id: migration.id, checksum: migrationChecksum(migration.source) })),
      candidate052: candidate ? { id: candidate.id, checksum: migrationChecksum(candidate.source) } : undefined,
      applyCandidate052: async (candidateOptions = {}) => {
        await refuseProjectDotEnv();
        if (!candidate) throw new Error("052 feature contract: canonical migration 052 must be available");
        // Preserve the complete canonical history, including the reviewed 002 adapter.
        // The only fault injection is fixed SQL appended in memory after canonical 052.
        const chain = candidateOptions.failAtEnd ? [...migrations.slice(0, 51), {
          ...candidate, execute: undefined, source: `${candidate.source}\nDO $fixture_052_late$ BEGIN
            RAISE EXCEPTION USING ERRCODE='PZ052', MESSAGE='fixture deliberate late failure';
            END $fixture_052_late$;\n`,
        }] : migrations;
        try {
          return await safeDatabaseOperation("apply canonical 052 candidate", async () => {
            try { return await applyInfrastructure(owner, chain); }
            catch (error) {
              const code = candidateRunnerSqlState(error);
              throw Object.assign(new Error("candidate migration failed"), code ? { code } : {});
            }
          });
        } finally {
          await safeDatabaseOperation("record candidate-created role identities", async () => {
            rememberFixtureRoleOids(initialRoles, await roleSnapshot(connection!), createdRoles);
          });
        }
      },
      ensureServiceRoles: async () => {
        await refuseProjectDotEnv();
        let serviceMutationStarted = false;
        try {
          await safeDatabaseOperation("create only the two known service NOLOGIN roles", async () => {
            await mutateVerifiedServiceRoles(initialRoles, await roleSnapshot(connection!), createdRoles, async roles => {
              serviceMutationStarted = true;
              for (const { rolname: name, exists } of roles) {
                if (!exists) await generatedStatement(connection!`select format(
                  'CREATE ROLE %I NOLOGIN NOSUPERUSER NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION', ${name}::text) as ddl`);
                else await generatedStatement(connection!`select format(
                  'ALTER ROLE %I NOLOGIN NOSUPERUSER NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION', ${name}::text) as ddl`);
              }
            });
          });
        } finally {
          if (serviceMutationStarted) await safeDatabaseOperation("record explicitly created service identities", async () => {
            rememberFixtureRoleOids(initialRoles, await roleSnapshot(connection!), createdRoles);
          });
        }
      },
      provisionRuntime: async () => {
        if (provisioned) return;
        await refuseProjectDotEnv();
        // Assert availability in the test leaf first; absent 052 must not become an auth/setup failure.
        await safeDatabaseOperation("six-role administrative provisioner", () => run(process.execPath,
          ["--import", "tsx", "src/provision-runtime-roles.ts"], {
            cwd: packageDirectory, env: provisionChildEnvironment(process.env, ownerUrl.toString(), runtimeUrls),
            timeout: 30_000, windowsHide: true, maxBuffer: 64 * 1024,
          }));
        provisioned = true;
      },
      cleanup,
    };
  } catch (error) {
    // Preserve neither raw errors nor causes. Cleanup also runs when bootstrap/migration fails.
    const setup = error instanceof Error && error.message.startsWith("Runtime services fixture preflight:")
      ? error.message : "Runtime services fixture setup failed; root must inspect connectivity and canonical migrations without printing credentials.";
    try { await cleanup(); }
    catch (cleanupError) { throw new Error(`${setup} ${cleanupError instanceof Error ? cleanupError.message : "Sanitized cleanup failure."}`); }
    throw new Error(setup);
  }
}

export async function verifyOwnerPositiveControl(fixture: RuntimeServicesFixture): Promise<void> {
  const [identity] = await safeDatabaseOperation("owner isolated database control", () => fixture.owner`
    select current_database() as database_name, to_regclass('public.telemetry') is not null as telemetry,
      to_regclass('public.gate_commands') is not null as gate_commands,
      to_regclass('public.users') is not null as users`);
  assert.equal(identity?.database_name, fixture.databaseName);
  assert.ok(identity?.telemetry && identity.gate_commands && identity.users, "owner sees the real canonical service and private tables");
  const history = await safeDatabaseOperation("owner ledger control", () => fixture.owner<{ id: string; checksum: string }[]>`
    select id,checksum from public.schema_migrations order by id`);
  assert.deepEqual([...history], fixture.canonicalHistory, "every applied canonical migration has its source checksum");
  assert.ok(history.length === 51 || history.length === 52, "bounded fixture loads the actual 051 or 052 chain");
  const syntheticId = randomUUID();
  await safeDatabaseOperation("owner synthetic UUID isolation control", () => fixture.owner.begin(async transaction => {
    await transaction`create table public.runtime_services_fixture_control(id uuid primary key)`;
    await transaction`insert into public.runtime_services_fixture_control(id) values (${syntheticId})`;
    const [row] = await transaction`select count(*)::int as total, bool_and(id=${syntheticId}::uuid) as only_fixture_id
      from public.runtime_services_fixture_control`;
    assert.ok(row?.total === 1 && row.only_fixture_id, "isolated state contains only the synthetic UUID created by this control");
  }));
}

const serviceHelpers: Record<ServiceRole, readonly string[]> = {
  predioon_ingest: [
    "public.ingest_count_rejection(text,text)",
    "public.ingest_lock_monitoring_profiles(text,text)",
    "public.ingest_lock_parking_lot(text,text)",
    "public.ingest_persist_alert(uuid,text,text,text,uuid,public.alert_severity,text,text,jsonb,timestamptz,timestamptz)",
    "public.ingest_alert_outbox_signature(uuid,uuid)",
    "public.ingest_write_parking_observation(uuid,text,text,text,integer,timestamptz,timestamptz,integer)",
  ],
  predioon_access_service: [
    "public.access_service_next_pending()",
    "public.access_service_expire_commands()",
    "public.access_service_fail_pending(uuid,text)",
    "public.access_service_mark_sent(uuid)",
    "public.access_service_fail_publish(uuid,text)",
    "public.access_service_apply_ack(uuid,text,text,text,text,text)",
  ],
};

/** Feature assertions run in a test leaf, never in setup or restricted authentication. */
export async function assertServiceCatalogue(fixture: RuntimeServicesFixture, role: ServiceRole): Promise<void> {
  const [catalogue] = await safeDatabaseOperation("service role catalogue contract", () => fixture.owner`
    select r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls,
      exists(select 1 from pg_auth_members m where m.member=r.oid or m.roleid=r.oid) as has_memberships,
      exists(select 1 from pg_shdepend d where d.refclassid='pg_authid'::regclass and d.refobjid=r.oid and d.deptype='o') as owns_objects,
      has_database_privilege(r.oid,current_database(),'CONNECT') as can_connect,
      has_database_privilege(r.oid,current_database(),'CREATE') as can_create_database_objects,
      has_database_privilege(r.oid,current_database(),'TEMP') as can_create_temp,
      has_schema_privilege(r.oid,'public','USAGE') as can_use_schema,
      has_schema_privilege(r.oid,'public','CREATE') as can_create_schema_objects
      from pg_roles r where r.rolname=${role}`);
  assert.ok(catalogue, `052 feature contract: canonical migrations must create ${role}`);
  assert.ok(!catalogue.rolsuper && !catalogue.rolinherit && !catalogue.rolcreaterole && !catalogue.rolcreatedb &&
    !catalogue.rolreplication && !catalogue.rolbypassrls && !catalogue.has_memberships && !catalogue.owns_objects,
  `${role} has restricted flags, zero ownership and no memberships in either direction`);
  assert.ok(catalogue.can_connect && catalogue.can_use_schema && !catalogue.can_create_database_objects &&
    !catalogue.can_create_temp && !catalogue.can_create_schema_objects, `${role} has only CONNECT/USAGE at database/schema scope`);

  for (const signature of ["public.service_runtime_guard(name)", ...serviceHelpers[role]]) {
    const [helper] = await safeDatabaseOperation("private helper catalogue contract", () => fixture.owner`
      select p.oid::int, p.prosecdef, p.proconfig, p.prokind='f' as ordinary_function,
        p.proowner=(select proowner from pg_proc where oid=to_regprocedure('public.app_has_capability(text,text,text,text)')) as fixed_owner,
        exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
        from pg_proc p where p.oid=to_regprocedure(${signature})`);
    assert.ok(helper, `052 feature contract: missing private helper ${signature}`);
    assert.ok(helper.prosecdef && helper.ordinary_function && helper.fixed_owner && !helper.public_execute,
      `${signature} is a private SECURITY DEFINER function owned by the fixed authorization owner`);
    assert.ok(Array.isArray(helper.proconfig) && helper.proconfig.some((setting: string) =>
      setting.replaceAll(/\s/g, "") === "search_path=pg_catalog,public,pg_temp"), `${signature} pins its search_path`);
    for (const candidate of roleNames) {
      const [permission] = await safeDatabaseOperation("helper execute isolation contract", () => fixture.owner`
        select has_function_privilege(${candidate}, ${helper.oid}::oid, 'EXECUTE') as allowed`);
      const allowed = signature !== "public.service_runtime_guard(name)" && candidate === role;
      assert.equal(permission?.allowed, allowed, `${signature}: EXECUTE isolation for ${candidate}`);
    }
  }
}

/** One forbidden SQL operation per transaction; 25P02 never counts as permission denial. */
export async function assertPermissionDenied(client: postgres.Sql, statement: string, forgedHumanContext = false): Promise<void> {
  await assert.rejects(safeDatabaseOperation("bounded permission denial", () => client.begin(async transaction => {
    if (forgedHumanContext) await transaction`select set_config('app.user_id','fixture-platform-admin',true),
      set_config('app.role','PLATFORM_ADMIN',true)`;
    await transaction.unsafe(statement);
  })), codeIs("42501"));
}
