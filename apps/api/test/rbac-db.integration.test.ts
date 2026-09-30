import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { sqlClient, units, unitMemberships, teamMembers, roleBindings, supportGrants, type AppTransaction } from "@predioon/db";
import { closeAppDb, withUserContext } from "@predioon/db/runtime";
import { CAPABILITIES, ROLE_CAPABILITIES } from "@predioon/shared";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

const enabled = process.env.RUN_RBAC_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL_APP);
type Fixture = Awaited<ReturnType<typeof createFixture>>;
async function createFixture() {
  const suffix = randomUUID();
  const org = `rbac-org-${suffix}`, a = `rbac-a-${suffix}`, b = `rbac-b-${suffix}`;
  const manager = `manager-${suffix}`, resident = `resident-${suffix}`, worker = `worker-${suffix}`;
  const support = `support-${suffix}`, platform = `platform-${suffix}`, outsider = `outsider-${suffix}`;
  const users = [manager, resident, worker, support, platform, outsider];
  await sqlClient`insert into organizations (id, name, slug) values (${org}, 'RBAC isolated test', ${org})`;
  await sqlClient`insert into buildings (id, organization_id, name, code) values
    (${a}, ${org}, 'A', 'A'), (${b}, ${org}, 'B', 'B')`;
  for (const id of users) await sqlClient`insert into users (id, email, name) values (${id}, ${id + '@rbac.invalid'}, ${id})`;
  await sqlClient`insert into memberships (user_id, building_id, role) values
    (${manager}, ${a}, 'BUILDING_ADMIN'), (${resident}, ${a}, 'RESIDENT')`;
  const team = randomUUID(), binding = randomUUID(), unit = randomUUID(), otherUnit = randomUUID(), block = randomUUID();
  await sqlClient`insert into teams (id, building_id, name) values (${team}, ${a}, 'Maintenance')`;
  await sqlClient`insert into team_members (team_id, building_id, user_id) values (${team}, ${a}, ${worker})`;
  await sqlClient`insert into role_bindings (id, team_id, building_id, role_key) values (${binding}, ${team}, ${a}, 'MAINTENANCE')`;
  await sqlClient`insert into role_bindings (user_id, role_key) values (${support}, 'PLATFORM_SUPPORT'), (${platform}, 'PLATFORM_ADMIN')`;
  await sqlClient`insert into blocks (id, building_id, code, name) values (${block}, ${a}, 'A', 'Block A')`;
  await sqlClient`insert into units (id, building_id, block_id, code) values (${unit}, ${a}, ${block}, '101'), (${otherUnit}, ${a}, ${block}, '102')`;
  await sqlClient`insert into unit_memberships (unit_id, building_id, user_id) values (${unit}, ${a}, ${resident})`;
  return { org, a, b, manager, resident, worker, support, platform, outsider, users, team, binding, unit, otherUnit, block };
}
async function fixture(run: (f: Fixture) => Promise<void>) {
  const f = await createFixture();
  try { await run(f); }
  finally {
    await sqlClient`delete from buildings where organization_id = ${f.org}`;
    await sqlClient`delete from organizations where id = ${f.org}`;
    await sqlClient`delete from users where id in ${sqlClient(f.users)}`;
  }
}
function asUser<T>(userId: string, run: (tx: AppTransaction) => Promise<T>) {
  // A forged platform label must not influence any new policy/helper.
  return withUserContext({ userId, role: "PLATFORM_ADMIN" }, run);
}
async function allowed(user: string, building: string, capability: string, resourceType: string | null = null, resourceId: string | null = null) {
  const rows = await asUser(user, tx => tx.execute(sql`select app_has_capability(${building}, ${capability}, ${resourceType}, ${resourceId}) as allowed`));
  return (rows[0] as { allowed: boolean }).allowed;
}
describe("RBAC explícito no PostgreSQL com fixtures isoladas", { skip: !enabled }, () => {
  after(async () => { await closeAppDb(); await sqlClient.end(); });
  it("mantém catálogo SQL igual ao catálogo compartilhado", async () => {
    const permissions = await sqlClient`select key from permissions order by key`;
    assert.deepEqual(permissions.map(p => p.key), [...CAPABILITIES].sort());
    for (const [role, capabilities] of Object.entries(ROLE_CAPABILITIES)) {
      const rows = await sqlClient`select permission_key from role_permissions where role_key=${role} order by permission_key`;
      assert.deepEqual(rows.map(row => row.permission_key), [...capabilities].sort(), role);
    }
  });
  it("schema Drizzle usa as mesmas chaves compostas de tenant do SQL", () => {
    for (const [table, column, onDelete] of [
      [units, "block_id", "restrict"],
      [unitMemberships, "unit_id", "cascade"],
      [teamMembers, "team_id", "cascade"],
      [roleBindings, "team_id", "cascade"],
    ] as const) {
      const fk = getTableConfig(table).foreignKeys.find(key => key.reference().columns[0].name === column);
      assert.ok(fk, column);
      assert.deepEqual(fk.reference().columns.map(c => c.name), [column, "building_id"]);
      assert.deepEqual(fk.reference().foreignColumns.map(c => c.name), ["id", "building_id"]);
      assert.equal(fk.onDelete, onDelete);
    }
  });
  it("checks do schema funcionam antes dos helpers de infraestrutura no bootstrap", async () => {
    const dialect = new PgDialect();
    await sqlClient.begin(async tx => {
      await tx`set local search_path to pg_catalog`;
      for (const table of [roleBindings, supportGrants]) {
        const config = getTableConfig(table);
        const checkName = table === roleBindings ? "role_bindings_scope_ck" : "support_grants_valid_ck";
        const check = config.checks.find(c => c.name === checkName)!;
        const expression = dialect.sqlToQuery(check.value).sql.replaceAll('"' + config.name + '".', "");
        await tx.unsafe(`create temporary table "${config.name}_bootstrap" (
          resource_type text, resource_id text, role_key text, building_id text, team_id uuid,
          reason text, expires_at timestamptz, created_at timestamptz, support_user_id text, granted_by text, capability text,
          check (${expression})
        ) on commit drop`);
      }
    });
  });
  it("isola tenant e ignora app.role forjado", () => fixture(async f => {
    assert.equal(await allowed(f.worker, f.a, "telemetry:read"), true);
    assert.equal(await allowed(f.worker, f.b, "telemetry:read"), false);
    assert.equal(await allowed(f.worker, f.a, "finance:read"), false);
    assert.equal(await allowed(f.outsider, f.a, "memberships:manage"), false);
    assert.equal((await asUser(f.outsider, tx => tx.execute(sql`select * from units`))).length, 0);
  }));
  it("separa capacidades globais de conteúdo privado e operação física", () => fixture(async f => {
    for (const user of [f.platform, f.support]) {
      assert.equal(await allowed(user, f.a, "telemetry:read"), false);
      assert.equal(await allowed(user, f.a, "commands:request"), false);
    }
    const rows = await asUser(f.platform, tx => tx.execute(sql`select app_has_global_capability('plans:manage') as plans, app_has_global_capability('telemetry:read') as telemetry`));
    assert.equal(rows[0].plans, true);
    assert.equal(rows[0].telemetry, false);
  }));
  it("nega conta, organização e condomínio inativos", () => fixture(async f => {
    for (const [off, on] of [
      [() => sqlClient`update users set active=false where id=${f.worker}`, () => sqlClient`update users set active=true where id=${f.worker}`],
      [() => sqlClient`update buildings set active=false where id=${f.a}`, () => sqlClient`update buildings set active=true where id=${f.a}`],
      [() => sqlClient`update organizations set active=false where id=${f.org}`, () => sqlClient`update organizations set active=true where id=${f.org}`],
    ]) {
      await off(); assert.equal(await allowed(f.worker, f.a, "telemetry:read"), false); await on();
    }
  }));
  it("reavalia equipe, vínculo de membro e concessão a cada operação", () => fixture(async f => {
    for (const [off, on] of [
      [() => sqlClient`update teams set active=false where id=${f.team}`, () => sqlClient`update teams set active=true where id=${f.team}`],
      [() => sqlClient`update team_members set active=false where team_id=${f.team}`, () => sqlClient`update team_members set active=true where team_id=${f.team}`],
      [() => sqlClient`update team_members set starts_at=now()+interval '1 hour' where team_id=${f.team}`, () => sqlClient`update team_members set starts_at=null where team_id=${f.team}`],
      [() => sqlClient`update team_members set ends_at=now()-interval '1 second' where team_id=${f.team}`, () => sqlClient`update team_members set ends_at=null where team_id=${f.team}`],
      [() => sqlClient`update role_bindings set active=false where id=${f.binding}`, () => sqlClient`update role_bindings set active=true where id=${f.binding}`],
      [() => sqlClient`update role_bindings set starts_at=now()+interval '1 hour' where id=${f.binding}`, () => sqlClient`update role_bindings set starts_at=null where id=${f.binding}`],
      [() => sqlClient`update role_bindings set ends_at=now()-interval '1 second' where id=${f.binding}`, () => sqlClient`update role_bindings set ends_at=null where id=${f.binding}`],
    ]) {
      await off(); assert.equal(await allowed(f.worker, f.a, "telemetry:read"), false); await on();
    }
  }));
  it("revogação legada não deixa concessão órfã", () => fixture(async f => {
    assert.equal(await allowed(f.manager, f.a, "memberships:manage"), true);
    await sqlClient`update memberships set active=false where user_id=${f.manager}`;
    assert.equal(await allowed(f.manager, f.a, "memberships:manage"), false);
    const leftovers = await sqlClient`select id from role_bindings where reason in ('Backfill da associação de compatibilidade', 'Backfill do administrador global legado')`;
    assert.equal(leftovers.length, 0);
  }));
  it("restringe concessões ao recurso e rejeita escopo parcial/desconhecido", () => fixture(async f => {
    await sqlClient`update role_bindings set resource_type='device', resource_id='device-1' where id=${f.binding}`;
    assert.equal(await allowed(f.worker, f.a, "devices:read", "device", "device-1"), true);
    assert.equal(await allowed(f.worker, f.a, "devices:read", "device", "device-2"), false);
    assert.equal(await allowed(f.worker, f.a, "devices:read"), false);
    assert.equal(await allowed(f.manager, f.a, "devices:read", "unknown", "device-1"), false);
    assert.equal(await allowed(f.manager, f.a, "devices:read", "device", null), false);
  }));
  it("mantém catálogo imutável para runtime inclusive admin global", () => fixture(async f => {
    for (const statement of [
      sql`update roles set active=false where key='RESIDENT'`,
      sql`insert into role_permissions (role_key,permission_key) values ('RESIDENT','plans:manage')`,
      sql`update permissions set label='forged' where key='units:read'`,
    ]) await assert.rejects(asUser(f.platform, async tx => {
      await tx.execute(statement);
      throw new Error('Runtime catalog write unexpectedly permitted; rolling back test');
    }), error => /permission denied/.test(String(error) + String((error as { cause?: unknown }).cause)));
  }));
  it("síndico delega somente papéis do seu escopo sem promover plataforma", () => fixture(async f => {
    await asUser(f.manager, tx => tx.execute(sql`insert into role_bindings (building_id,user_id,role_key) values (${f.a},${f.outsider},'MAINTENANCE')`));
    assert.equal(await allowed(f.outsider, f.a, "telemetry:read"), true);
    await assert.rejects(asUser(f.manager, tx => tx.execute(sql`insert into role_bindings (building_id,user_id,role_key) values (${f.a},${f.outsider},'PLATFORM_ADMIN')`)));
    await assert.rejects(asUser(f.manager, tx => tx.execute(sql`insert into role_bindings (user_id,role_key) values (${f.outsider},'PLATFORM_ADMIN')`)));
    await assert.rejects(asUser(f.manager, tx => tx.execute(sql`insert into role_bindings (building_id,user_id,role_key) values (${f.b},${f.outsider},'RESIDENT')`)));
    await assert.rejects(asUser(f.worker, tx => tx.execute(sql`insert into role_bindings (building_id,user_id,role_key) values (${f.a},${f.worker},'BUILDING_ADMIN')`)));
  }));
  it("impede delegar capacidades que o gestor não possui", () => fixture(async f => {
    const role = 'TEST_DELEGATOR_' + randomUUID();
    await sqlClient`insert into roles (key,scope,label) values (${role},'BUILDING','Restricted test manager')`;
    await sqlClient`insert into role_permissions (role_key,permission_key) values (${role},'memberships:manage')`;
    await sqlClient`insert into role_bindings (building_id,user_id,role_key) values (${f.a},${f.outsider},${role})`;
    try {
      await assert.rejects(asUser(f.outsider, tx => tx.execute(sql`insert into role_bindings (building_id,user_id,role_key) values (${f.a},${f.resident},'MAINTENANCE')`)));
    } finally {
      await sqlClient`delete from role_bindings where role_key=${role}`;
      await sqlClient`delete from roles where key=${role}`;
    }
  }));
  it("suporte exige motivo, prazo, destinatário autorizado e concessão independente", () => fixture(async f => {
    const grant = (actor: string, target: string, capability = "telemetry:read", reason = "Diagnóstico solicitado", duration = "1 hour") =>
      asUser(actor, tx => tx.execute(sql`insert into support_grants (building_id,support_user_id,capability,reason,expires_at,granted_by) values (${f.a},${target},${capability},${reason},now()+${duration}::interval,${actor}) returning id`));
    await assert.rejects(grant(f.support, f.support));
    await assert.rejects(grant(f.platform, f.platform));
    await assert.rejects(grant(f.platform, f.outsider));
    await assert.rejects(grant(f.platform, f.support, "memberships:manage"));
    await assert.rejects(grant(f.platform, f.support, "telemetry:read", "  "));
    await assert.rejects(grant(f.platform, f.support, "telemetry:read", "Reason", "-1 hour"));
    await grant(f.platform, f.support);
    assert.equal(await allowed(f.support, f.a, "telemetry:read"), true);
    assert.equal(await allowed(f.support, f.a, "devices:configure"), false);
    await sqlClient`update support_grants set revoked_at=now() where support_user_id=${f.support}`;
    assert.equal(await allowed(f.support, f.a, "telemetry:read"), false);
  }));
  it("support grant expira, respeita recurso e deixa de valer sem papel de suporte", () => fixture(async f => {
    await sqlClient`insert into support_grants (building_id,support_user_id,capability,resource_type,resource_id,reason,expires_at,granted_by) values
      (${f.a},${f.support},'devices:read','device','device-1','Diagnostic',now()+interval '1 hour',${f.platform})`;
    assert.equal(await allowed(f.support, f.a, "devices:read", "device", "device-1"), true);
    assert.equal(await allowed(f.support, f.a, "devices:read", "device", "device-2"), false);
    await sqlClient`update role_bindings set active=false where user_id=${f.support}`;
    assert.equal(await allowed(f.support, f.a, "devices:read", "device", "device-1"), false);
    await sqlClient`update role_bindings set active=true where user_id=${f.support}`;
    await sqlClient`update support_grants set created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour' where support_user_id=${f.support}`;
    assert.equal(await allowed(f.support, f.a, "devices:read", "device", "device-1"), false);
  }));
  it("morador lê somente unidade e vínculos próprios vigentes; manutenção não lê moradores", () => fixture(async f => {
    const units = await asUser(f.resident, tx => tx.execute(sql`select id from units`));
    assert.deepEqual(units.map(row => row.id), [f.unit]);
    assert.equal((await asUser(f.worker, tx => tx.execute(sql`select id from units`))).length, 0);
    await sqlClient`update unit_memberships set ends_at=now()-interval '1 second' where user_id=${f.resident}`;
    assert.equal((await asUser(f.resident, tx => tx.execute(sql`select id from units`))).length, 0);
    assert.equal((await asUser(f.resident, tx => tx.execute(sql`select id from unit_memberships`))).length, 0);
  }));
  it("oculta metadados próprios quando tenant fica inativo", () => fixture(async f => {
    await sqlClient`insert into role_bindings (user_id,building_id,role_key) values (${f.resident},${f.a},'RESIDENT')`;
    await sqlClient`update organizations set active=false where id=${f.org}`;
    for (const table of ["units", "blocks", "unit_memberships", "role_bindings"]) {
      const rows = await asUser(f.resident, tx => tx.execute(sql`select id from ${sql.identifier(table)}`));
      assert.equal(rows.length, 0, table);
    }
    assert.equal((await asUser(f.worker, tx => tx.execute(sql`select id from team_members`))).length, 0);
  }));
  it("aceita unidade sem bloco e impede relacionamentos entre tenants", () => fixture(async f => {
    await asUser(f.manager, tx => tx.execute(sql`insert into units (building_id,code) values (${f.a},'valid-no-block')`));
    await assert.rejects(sqlClient`insert into units (building_id,block_id,code) values (${f.b},${f.block},'cross-block')`, /foreign key/);
    await assert.rejects(sqlClient`insert into unit_memberships (building_id,unit_id,user_id) values (${f.b},${f.unit},${f.resident})`, /foreign key/);
    await assert.rejects(sqlClient`insert into team_members (building_id,team_id,user_id) values (${f.b},${f.team},${f.resident})`, /foreign key/);
    await assert.rejects(sqlClient`insert into role_bindings (building_id,team_id,role_key) values (${f.b},${f.team},'RESIDENT')`, /foreign key/);
    await assert.rejects(sqlClient`delete from blocks where id=${f.block}`, /foreign key/);
  }));
});
