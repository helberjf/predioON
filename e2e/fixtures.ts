import { randomUUID } from "node:crypto";
import { test as base } from "@playwright/test";
import { withFixtureDatabase } from "./database";

export * from "@playwright/test";

const seeds = ["admin@predioon.local", "sindico@predioon.local", "morador@predioon.local"] as const;
let accounts: Map<string, string> | undefined;

/** Keep the seed's visible names and tenant scopes, but never share its login
 * budget or session families between scenarios/engines. Nothing changes in API
 * admission: these accounts submit real passwords to the normal login route. */
export function demoAccountEmail(email: string): string {
  if (!(seeds as readonly string[]).includes(email)) return email;
  const isolated = accounts?.get(email);
  if (!isolated) throw new Error("Seed login requires the isolated e2e/fixtures test fixture");
  return isolated;
}

export const test = base.extend<{ _demoAccounts: void }>({
  _demoAccounts: [async ({}, use) => {
    const ids: string[] = [];
    const current = new Map<string, string>();
    await withFixtureDatabase(sql => sql.begin(async tx => {
      for (const email of seeds) {
        const id = `e2e-login-${randomUUID()}`;
        const alias = `${email.split("@")[0]}-${id}@predioon.local`;
        const inserted = await tx`
          insert into users(id,email,name,password_hash,active,is_platform_admin)
          select ${id},${alias},name,password_hash,active,is_platform_admin from users where email=${email}
          returning id`;
        if (inserted.length !== 1) throw new Error(`Missing unique demo seed: ${email}`);
        await tx`
          insert into memberships(user_id,building_id,role,unit,active,starts_at,ends_at)
          select ${id},m.building_id,m.role,m.unit,m.active,m.starts_at,m.ends_at
          from memberships m join users u on u.id=m.user_id where u.email=${email}`;
        await tx`
          insert into role_bindings(user_id,building_id,role_key,resource_type,resource_id,active,starts_at,ends_at)
          select ${id},r.building_id,r.role_key,r.resource_type,r.resource_id,r.active,r.starts_at,r.ends_at
          from role_bindings r join users u on u.id=r.user_id where u.email=${email}`;
        ids.push(id);
        current.set(email, alias);
      }
    }));
    accounts = current;
    try { await use(); }
    finally {
      accounts = undefined;
      await withFixtureDatabase(sql => sql`delete from users where id in ${sql(ids)}`);
    }
  }, { auto: true }],
});
