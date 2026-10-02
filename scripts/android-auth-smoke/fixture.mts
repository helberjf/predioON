import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { sqlClient } from "../../packages/db/src/index.ts";
import { hashPassword } from "../../apps/api/src/auth/passwords.ts";

type Account = { id: string; name: string; email: string; buildingId: string; buildingName: string; productTitle: string };
type Fixture = { organizationId: string; accounts: Record<string, Account> };
const [action, filename] = process.argv.slice(2);
const url = new URL(process.env.DATABASE_URL ?? "https://missing.invalid");
if (process.env.ANDROID_AUTH_DISPOSABLE_DB !== "1" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !filename) {
  throw new Error("Android auth fixture requires an explicit disposable loopback database and a fixture file");
}
async function load(): Promise<Fixture> {
  const fixture = JSON.parse(await readFile(filename!, "utf8")) as Fixture;
  if (!/^android-auth-org-[0-9a-f-]{36}$/.test(fixture.organizationId)
    || Object.keys(fixture.accounts).sort().join() !== "operations-mobile,resident-mobile"
    || Object.values(fixture.accounts).some(account => !/^android-auth-(resident|operations)-[0-9a-f-]{36}$/.test(account.id))) {
    throw new Error("Invalid isolated Android fixture identity");
  }
  return fixture;
}
async function cleanup(fixture: Fixture) {
  await sqlClient.begin(async tx => {
    await tx`delete from buildings where organization_id=${fixture.organizationId}`;
    await tx`delete from organizations where id=${fixture.organizationId}`;
    await tx`delete from users where id in ${tx(Object.values(fixture.accounts).map(account => account.id))}`;
  });
}
try {
  if (action === "create") {
    const password = process.env.ANDROID_AUTH_PASSWORD;
    if (!password || password.length < 16) throw new Error("An ephemeral password of at least 16 characters is required");
    try { await readFile(filename!, "utf8"); throw new Error("Fixture file already exists"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const suffix = randomUUID();
    const fixture: Fixture = { organizationId: `android-auth-org-${suffix}`, accounts: {} };
    for (const product of ["resident", "operations"] as const) {
      fixture.accounts[`${product}-mobile`] = {
        id: `android-auth-${product}-${suffix}`, name: product === "resident" ? "Morador de Teste" : "Operador de Teste",
        email: `${product}-${suffix}@android.example.invalid`, buildingId: `android-auth-building-${product}-${suffix}`,
        buildingName: product === "resident" ? "Condominio Morador CI" : "Condominio Operacao CI",
        productTitle: product === "resident" ? "Prédio ON Morador" : "Prédio ON Operação",
      };
    }
    const passwordHash = await hashPassword(password);
    try {
      await sqlClient.begin(async tx => {
        await tx`insert into organizations(id,name,slug) values(${fixture.organizationId},'Android auth isolated',${fixture.organizationId})`;
        for (const [app, account] of Object.entries(fixture.accounts)) {
          await tx`insert into buildings(id,organization_id,name,code) values(${account.buildingId},${fixture.organizationId},${account.buildingName},${app})`;
          await tx`insert into users(id,name,email,password_hash) values(${account.id},${account.name},${account.email},${passwordHash})`;
          await tx`insert into role_bindings(user_id,building_id,role_key) values(${account.id},${account.buildingId},${app === "resident-mobile" ? "RESIDENT" : "MAINTENANCE"})`;
        }
      });
      await writeFile(filename!, JSON.stringify(fixture, null, 2), { mode: 0o600 });
    } catch (error) { await cleanup(fixture); throw error; }
    console.log("Created two isolated Android accounts and buildings; no credentials printed");
  } else if (action === "snapshot") {
    const fixture = await load();
    const result: Record<string, unknown> = {};
    for (const [app, account] of Object.entries(fixture.accounts)) {
      const [counts] = await sqlClient`select
        (select count(*)::int from sessions where user_id=${account.id}) as sessions,
        (select count(*)::int from sessions where user_id=${account.id} and revoked_at is null and expires_at>now()) as active_sessions,
        (select count(*)::int from sessions where user_id=${account.id} and revoked_reason='LOGOUT') as logouts,
        (select count(*)::int from refresh_tokens where user_id=${account.id}) as refresh_tokens,
        (select count(*)::int from refresh_tokens where user_id=${account.id} and replaced_by_hash is not null) as rotations,
        (select count(*)::int from refresh_tokens rt join sessions s on s.id=rt.session_id where rt.user_id=${account.id} and rt.revoked_at is null and s.revoked_at is null and s.expires_at>now()) as live_refresh_tokens`;
      result[app] = counts;
    }
    console.log(JSON.stringify(result));
  } else if (action === "cleanup") {
    await cleanup(await load());
    console.log("Removed only the isolated Android fixture accounts and buildings");
  } else throw new Error("Expected create, snapshot or cleanup");
} finally {
  await sqlClient.end();
}
