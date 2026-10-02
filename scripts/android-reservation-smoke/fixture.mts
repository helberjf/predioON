import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { sqlClient } from "../../packages/db/src/index.ts";
import { hashPassword } from "../../apps/api/src/auth/passwords.ts";

type Account = {
  id: string;
  name: string;
  email: string;
  buildingId: string;
  buildingName: string;
  productTitle: string;
};
export type Fixture = {
  organizationId: string;
  accounts: Record<string, Account>;
  neighbor: string;
  foreignBuilding: string;
  roles: string[];
  ids: Record<string, string>;
  labels: Record<string, string>;
  forbidden: string[];
  date: string;
  nextDate: string;
  startsAt: string;
  endsAt: string;
};

function guard() {
  const url = new URL(process.env.DATABASE_URL ?? "https://missing.invalid");
  if (
    process.env.ANDROID_RESERVATION_DISPOSABLE_DB !== "1" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error(
      "Native reservations require an explicitly disposable loopback database",
    );
}

function validate(f: Fixture) {
  if (
    !/^android-reservation-org-[0-9a-f-]{36}$/.test(f.organizationId) ||
    Object.keys(f.accounts).join() !== "resident-mobile"
  )
    throw new Error("Invalid reservation fixture identity");
  const suffix = f.organizationId.slice("android-reservation-org-".length),
    account = f.accounts["resident-mobile"]!;
  if (
    account.id !== `android-reservation-user-${suffix}` ||
    account.buildingId !== `android-reservation-building-${suffix}` ||
    f.neighbor !== `android-reservation-neighbor-${suffix}` ||
    f.foreignBuilding !== `android-reservation-foreign-${suffix}` ||
    f.roles.join() !==
      [
        `ANDROID_RESERVATION_BASE_${suffix}`,
        `ANDROID_RESERVATION_CALENDAR_${suffix}`,
      ].join()
  )
    throw new Error("Reservation fixture contains foreign identities");
}

export async function createFixture(password: string): Promise<Fixture> {
  guard();
  if (!/^[A-Za-z0-9]{16,}$/.test(password))
    throw new Error("Expected ephemeral alphanumeric password");
  const suffix = randomUUID();
  const date = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const f: Fixture = {
    organizationId: `android-reservation-org-${suffix}`,
    accounts: {
      "resident-mobile": {
        id: `android-reservation-user-${suffix}`,
        name: "Morador de Reservas CI",
        email: `reservations-${suffix}@android.example.invalid`,
        buildingId: `android-reservation-building-${suffix}`,
        buildingName: "Condominio Reservas CI",
        productTitle: "Prédio ON Morador",
      },
    },
    neighbor: `android-reservation-neighbor-${suffix}`,
    foreignBuilding: `android-reservation-foreign-${suffix}`,
    roles: [
      `ANDROID_RESERVATION_BASE_${suffix}`,
      `ANDROID_RESERVATION_CALENDAR_${suffix}`,
    ],
    ids: Object.fromEntries(
      [
        "autoArea",
        "pendingArea",
        "foreignArea",
        "neighborBooking",
        "foreignBooking",
        "autoCalendarGrant",
        "pendingCalendarGrant",
      ].map((key) => [key, randomUUID()]),
    ),
    labels: {
      autoArea: "Sala automatica CI",
      pendingArea: "Sala com aprovacao CI",
    },
    forbidden: [
      "PRIVATE NEIGHBOR",
      "PRIVATE UNIT",
      "PRIVATE NOTES",
      "PRIVATE FOREIGN",
    ],
    date,
    nextDate: new Date(Date.parse(date + "T00:00:00Z") + 86_400_000)
      .toISOString()
      .slice(0, 10),
    startsAt: date + "T19:00:00.000Z",
    endsAt: date + "T20:00:00.000Z",
  };
  const account = f.accounts["resident-mobile"]!;
  const hash = await hashPassword(password);
  try {
    await sqlClient.begin(async (tx) => {
      await tx`insert into organizations(id,name,slug) values(${f.organizationId},'Native reservations isolated',${f.organizationId})`;
      await tx`insert into buildings(id,organization_id,name,code,timezone) values(${account.buildingId},${f.organizationId},${account.buildingName},'OWN','UTC'),(${f.foreignBuilding},${f.organizationId},'PRIVATE FOREIGN','OTHER','UTC')`;
      await tx`insert into users(id,name,email,password_hash) values(${account.id},${account.name},${account.email},${hash}),(${f.neighbor},'PRIVATE NEIGHBOR',${f.neighbor + "@android.example.invalid"},${hash})`;
      for (const role of f.roles)
        await tx`insert into roles(key,scope,label) values(${role},'BUILDING',${role})`;
      for (const permission of [
        "buildings:read",
        "common-areas:read",
        "reservations:read-own",
        "reservations:create-own",
        "reservations:cancel-own",
      ])
        await tx`insert into role_permissions(role_key,permission_key) values(${f.roles[0]!},${permission})`;
      await tx`insert into role_permissions(role_key,permission_key) values(${f.roles[1]!},'reservations:read-calendar')`;
      await tx`insert into role_bindings(user_id,building_id,role_key) values(${account.id},${account.buildingId},${f.roles[0]!})`;
      for (const kind of ["auto", "pending"])
        await tx`insert into common_areas(id,building_id,name,requires_approval,opens_at,closes_at) values(${f.ids[kind + "Area"]!},${account.buildingId},${f.labels[kind + "Area"]!},${kind === "pending"},'00:00','23:59')`;
      await tx`insert into common_areas(id,building_id,name,requires_approval) values(${f.ids.foreignArea!},${f.foreignBuilding},'PRIVATE FOREIGN',false)`;
      for (const kind of ["auto", "pending"])
        await tx`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values(${f.ids[kind + "CalendarGrant"]!},${account.id},${account.buildingId},${f.roles[1]!},'common_area',${f.ids[kind + "Area"]!})`;
      await tx`insert into reservations(id,building_id,area_id,user_id,starts_at,ends_at,status,unit,notes) values
        (${f.ids.neighborBooking!},${account.buildingId},${f.ids.autoArea!},${f.neighbor},${f.startsAt},${f.endsAt},'CONFIRMED','PRIVATE UNIT','PRIVATE NOTES'),
        (${f.ids.foreignBooking!},${f.foreignBuilding},${f.ids.foreignArea!},${f.neighbor},${f.startsAt},${f.endsAt},'CONFIRMED','PRIVATE UNIT','PRIVATE NOTES')`;
    });
    return f;
  } catch (error) {
    await cleanup(f);
    throw error;
  }
}

export async function cleanup(f: Fixture) {
  guard();
  validate(f);
  const users = [f.accounts["resident-mobile"]!.id, f.neighbor];
  await sqlClient.begin(async (tx) => {
    await tx`delete from audit_logs where user_id in ${tx(users)}`;
    await tx`delete from buildings where organization_id=${f.organizationId}`;
    await tx`delete from organizations where id=${f.organizationId}`;
    await tx`delete from users where id in ${tx(users)}`;
    await tx`delete from roles where key in ${tx(f.roles)}`;
  });
}

export async function cancelNeighbor(f: Fixture) {
  guard();
  validate(f);
  const rows =
    await sqlClient`update reservations set status='CANCELLED' where id=${f.ids.neighborBooking!} and building_id=${f.accounts["resident-mobile"]!.buildingId} and user_id=${f.neighbor} and status='CONFIRMED' returning id`;
  if (rows.length !== 1)
    throw new Error("Expected one neighbor fixture reservation");
}

export async function revokeCalendar(f: Fixture) {
  guard();
  validate(f);
  const rows =
    await sqlClient`update role_bindings set active=false where id in ${sqlClient([f.ids.autoCalendarGrant!, f.ids.pendingCalendarGrant!])} and user_id=${f.accounts["resident-mobile"]!.id} and building_id=${f.accounts["resident-mobile"]!.buildingId} and role_key=${f.roles[1]!} returning id`;
  if (rows.length !== 2) throw new Error("Expected two exact calendar grants");
}

export async function snapshot(f: Fixture) {
  guard();
  validate(f);
  const account = f.accounts["resident-mobile"]!;
  const [row] = await sqlClient`select
    (select count(*)::int from reservations where building_id=${account.buildingId} and user_id=${account.id}) as "ownTotal",
    (select count(*)::int from reservations where building_id=${account.buildingId} and user_id=${account.id} and status='CONFIRMED') as "ownConfirmed",
    (select count(*)::int from reservations where building_id=${account.buildingId} and user_id=${account.id} and status='PENDING') as "ownPending",
    (select count(*)::int from reservations where building_id=${account.buildingId} and user_id=${account.id} and status='CANCELLED') as "ownCancelled",
    (select count(*)::int from audit_logs where user_id=${account.id} and action='RESERVATION_CREATED') as "createdAudits",
    (select count(*)::int from audit_logs where user_id=${account.id} and action='RESERVATION_CANCELLED') as "cancelledAudits",
    (select status from reservations where id=${f.ids.neighborBooking!}) as "neighborStatus",
    (select count(*)::int from role_bindings where user_id=${account.id} and role_key=${f.roles[1]!} and active) as "calendarGrantsActive",
    (select status from reservations where id=${f.ids.foreignBooking!}) as "foreignStatus"`;
  return row;
}

async function main() {
  const [action, filename] = process.argv.slice(2);
  if (!filename) throw new Error("Fixture filename required");
  if (action === "create") {
    try {
      await readFile(filename);
      throw new Error("Fixture already exists");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const f = await createFixture(process.env.ANDROID_AUTH_PASSWORD ?? "");
    try {
      await writeFile(filename, JSON.stringify(f, null, 2), { mode: 0o600 });
    } catch (error) {
      await cleanup(f);
      throw error;
    }
    console.log("Created only isolated reservation data");
  } else {
    const f = JSON.parse(await readFile(filename, "utf8")) as Fixture;
    if (action === "snapshot") console.log(JSON.stringify(await snapshot(f)));
    else if (action === "cleanup") await cleanup(f);
    else if (action === "cancel-neighbor") await cancelNeighbor(f);
    else if (action === "revoke-calendar") await revokeCalendar(f);
    else throw new Error("Unknown isolated reservation fixture action");
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    await main();
  } finally {
    await sqlClient.end();
  }
}
