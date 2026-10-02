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
  roles: string[];
  ids: Record<string, string>;
  labels: Record<string, string>;
  forbidden: string[];
};

function guard() {
  const url = new URL(process.env.DATABASE_URL ?? "https://missing.invalid");
  if (
    process.env.ANDROID_DOMAIN_DISPOSABLE_DB !== "1" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error(
      "Android domains require an explicitly disposable loopback database",
    );
}
export async function createFixture(password: string): Promise<Fixture> {
  guard();
  if (!/^[a-zA-Z0-9]{16,}$/.test(password))
    throw new Error("Expected an ephemeral alphanumeric password");
  const suffix = randomUUID();
  const f: Fixture = {
    organizationId: `android-domain-org-${suffix}`,
    accounts: {},
    neighbor: `android-domain-neighbor-${suffix}`,
    roles: ["resident", "finance", "device", "ticket"].map(
      (kind) => `ANDROID_DOMAIN_${kind}_${suffix}`,
    ),
    ids: Object.fromEntries(
      [
        "residentTicket",
        "neighborTicket",
        "operatorTicket",
        "operatorNeighborTicket",
        "alert",
        "neighborAlert",
        "deviceGrant",
        "ticketGrant",
        "financeGrant",
      ].map((key) => [key, randomUUID()]),
    ),
    labels: {
      notice: "Aviso publicado CI",
      futureNotice: "PRIVATE FUTURE NOTICE",
      report: "Contas publicadas CI",
      draft: "PRIVATE FINANCE DRAFT",
      foreign: "PRIVATE FOREIGN TENANT",
      ownTicket: "Solicitacao propria CI",
      neighborTicket: "PRIVATE NEIGHBOR TICKET",
      created: "Solicitacao criada pelo Android",
      description: "Descricao enviada pela interface Android",
      comment: "Mensagem enviada pelo Morador",
      operatorTicket: "Chamado concedido CI",
      operatorComment: "Equipe iniciou o atendimento",
      alert: "Alerta permitido CI",
      neighborAlert: "PRIVATE NEIGHBOR ALERT",
      device: "Sensor permitido CI",
      neighborDevice: "PRIVATE NEIGHBOR SENSOR",
      entry: "Manutencao publicada CI",
    },
    forbidden: [
      "PRIVATE FUTURE NOTICE",
      "PRIVATE FINANCE DRAFT",
      "PRIVATE FOREIGN TENANT",
      "PRIVATE NEIGHBOR TICKET",
      "PRIVATE NEIGHBOR ALERT",
      "PRIVATE NEIGHBOR SENSOR",
    ],
  };
  for (const product of ["resident", "operations"] as const)
    f.accounts[`${product}-mobile`] = {
      id: `android-domain-${product}-${suffix}`,
      email: `${product}-${suffix}@android.example.invalid`,
      name: product === "resident" ? "Morador de Teste" : "Operador de Teste",
      buildingId: `android-domain-building-${product}-${suffix}`,
      buildingName:
        product === "resident"
          ? "Condominio Morador CI"
          : "Condominio Operacao CI",
      productTitle:
        product === "resident" ? "Prédio ON Morador" : "Prédio ON Operação",
    };
  f.ids.device = `android-domain-device-${suffix}`;
  f.ids.neighborDevice = `android-domain-device-other-${suffix}`;
  const resident = f.accounts["resident-mobile"]!,
    operator = f.accounts["operations-mobile"]!;
  const hash = await hashPassword(password);
  try {
    await sqlClient.begin(async (tx) => {
      await tx`insert into organizations(id,name,slug) values(${f.organizationId},'Android domains isolated',${f.organizationId})`;
      for (const account of Object.values(f.accounts)) {
        await tx`insert into buildings(id,organization_id,name,code) values(${account.buildingId},${f.organizationId},${account.buildingName},${account.id})`;
        await tx`insert into users(id,name,email,password_hash) values(${account.id},${account.name},${account.email},${hash})`;
      }
      await tx`insert into users(id,name,email,password_hash) values(${f.neighbor},'Private neighbor',${f.neighbor + "@android.example.invalid"},${hash})`;
      for (const role of f.roles)
        await tx`insert into roles(key,scope,label) values(${role},'BUILDING',${role})`;
      for (const permission of [
        "buildings:read",
        "notices:read",
        "occurrences:read-own",
        "occurrences:create-own",
      ])
        await tx`insert into role_permissions(role_key,permission_key) values(${f.roles[0]!},${permission})`;
      await tx`insert into role_permissions(role_key,permission_key) values(${f.roles[1]!},'finance:read-published'),(${f.roles[3]!},'occurrences:manage'),(${f.roles[3]!},'buildings:read')`;
      for (const permission of [
        "buildings:read",
        "devices:read",
        "telemetry:read",
        "alerts:read",
        "alerts:acknowledge",
      ])
        await tx`insert into role_permissions(role_key,permission_key) values(${f.roles[2]!},${permission})`;
      await tx`insert into role_bindings(user_id,building_id,role_key) values(${resident.id},${resident.buildingId},${f.roles[0]!})`;
      await tx`insert into role_bindings(id,user_id,building_id,role_key) values(${f.ids.financeGrant!},${resident.id},${resident.buildingId},${f.roles[1]!})`;
      for (const [id, title] of [
        [f.ids.device!, f.labels.device!],
        [f.ids.neighborDevice!, f.labels.neighborDevice!],
      ])
        await tx`insert into devices(id,building_id,name,type) values(${id!},${operator.buildingId},${title!},'WATER_LEVEL_SENSOR')`;
      for (const [id, author, building, title] of [
        [
          f.ids.residentTicket!,
          resident.id,
          resident.buildingId,
          f.labels.ownTicket!,
        ],
        [
          f.ids.neighborTicket!,
          f.neighbor,
          resident.buildingId,
          f.labels.neighborTicket!,
        ],
        [
          f.ids.operatorTicket!,
          f.neighbor,
          operator.buildingId,
          f.labels.operatorTicket!,
        ],
        [
          f.ids.operatorNeighborTicket!,
          f.neighbor,
          operator.buildingId,
          f.labels.neighborTicket!,
        ],
      ])
        await tx`insert into occurrences(id,building_id,protocol,title,description,category,opened_by) values(${id!},${building!},${"CI-" + id},${title!},'Descricao isolada','GENERAL',${author!})`;
      await tx`insert into role_bindings(id,user_id,building_id,role_key,resource_type,resource_id) values
        (${f.ids.deviceGrant!},${operator.id},${operator.buildingId},${f.roles[2]!},'device',${f.ids.device!}),
        (${f.ids.ticketGrant!},${operator.id},${operator.buildingId},${f.roles[3]!},'occurrence',${f.ids.operatorTicket!})`;
      for (const [id, device, message] of [
        [f.ids.alert!, f.ids.device!, f.labels.alert!],
        [f.ids.neighborAlert!, f.ids.neighborDevice!, f.labels.neighborAlert!],
      ])
        await tx`insert into alerts(id,building_id,device_id,type,severity,message) values(${id!},${operator.buildingId},${device!},'WATER_LOW','HIGH',${message!})`;
      for (const [device, value] of [
        [f.ids.device!, 42],
        [f.ids.neighborDevice!, 99],
      ] as const)
        await tx`insert into telemetry(time,event_id,building_id,device_id,metric,value,numeric_value,unit,quality) values(now(),${randomUUID()},${operator.buildingId},${device},'water_level_percent',${String(value)},${value},'%','GOOD')`;
      await tx`insert into notices(building_id,title,body,published_at,category,created_by) values
        (${resident.buildingId},${f.labels.notice!},'Comunicado disponivel aos moradores',now()-interval '1 hour','COMMUNICATION',${resident.id}),
        (${resident.buildingId},${f.labels.futureNotice!},'Conteudo futuro privado',now()+interval '1 day','COMMUNICATION',${resident.id}),
        (${operator.buildingId},${f.labels.foreign!},'Outro condominio',now()-interval '1 hour','COMMUNICATION',${operator.id})`;
      const entries = [
        {
          type: "EXPENSE",
          category: "Manutencao",
          description: f.labels.entry!,
          amountCents: 1000,
          date: "2026-09-01",
          receiptUrl: null,
        },
      ];
      for (const [building, title, published] of [
        [resident.buildingId, f.labels.report!, true],
        [resident.buildingId, f.labels.draft!, false],
        [operator.buildingId, f.labels.foreign!, true],
      ] as const)
        await tx`insert into financial_reports(building_id,month,title,summary,opening_balance_cents,entries,revision,created_by,published_at,published_by) values
          (${building},${published ? "2026-09" : "2026-08"},${title},'Resumo financeiro isolado',10000,${JSON.stringify(entries)}::jsonb,1,${resident.id},${published ? new Date(Date.now() - 3_600_000).toISOString() : null}::timestamptz,${published ? resident.id : null})`;
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
  const users = [...Object.values(f.accounts).map((a) => a.id), f.neighbor];
  await sqlClient.begin(async (tx) => {
    await tx`delete from audit_logs where user_id in ${tx(users)}`;
    await tx`delete from buildings where organization_id=${f.organizationId}`;
    await tx`delete from organizations where id=${f.organizationId}`;
    await tx`delete from users where id in ${tx(users)}`;
    await tx`delete from roles where key in ${tx(f.roles)}`;
  });
}
function validate(f: Fixture) {
  if (
    !/^android-domain-org-[0-9a-f-]{36}$/.test(f.organizationId) ||
    Object.keys(f.accounts).sort().join() !==
      "operations-mobile,resident-mobile"
  )
    throw new Error("Invalid domain fixture identity");
  const suffix = f.organizationId.slice("android-domain-org-".length);
  if (
    Object.values(f.accounts).some(
      (a) =>
        !a.id.startsWith("android-domain-") ||
        !a.id.endsWith(suffix) ||
        !a.buildingId.startsWith("android-domain-building-") ||
        !a.buildingId.endsWith(suffix),
    ) ||
    f.neighbor !== `android-domain-neighbor-${suffix}` ||
    f.roles.length !== 4 ||
    f.roles.some((r) => !r.startsWith("ANDROID_DOMAIN_") || !r.endsWith(suffix))
  )
    throw new Error("Domain fixture contains foreign identities");
}
export async function snapshot(f: Fixture) {
  guard();
  validate(f);
  const resident = f.accounts["resident-mobile"]!,
    operator = f.accounts["operations-mobile"]!;
  const [row] = await sqlClient`select
    (select count(*)::int from occurrences where building_id=${resident.buildingId} and opened_by=${resident.id} and title=${f.labels.created!}) as "residentCreated",
    (select count(*)::int from occurrence_events e join occurrences o on o.id=e.occurrence_id where o.building_id=${resident.buildingId} and o.title=${f.labels.created!} and e.author_id=${resident.id} and e.kind='COMMENT' and e.message=${f.labels.comment!}) as "residentComments",
    (select status from occurrences where id=${f.ids.operatorTicket!}) as "operatorStatus",
    (select count(*)::int from occurrence_events where occurrence_id=${f.ids.operatorTicket!} and kind='COMMENT' and author_id=${operator.id} and message=${f.labels.operatorComment!}) as "operatorComments",
    (select status from alerts where id=${f.ids.alert!}) as "alertStatus",
    (select status from occurrences where id=${f.ids.operatorNeighborTicket!}) as "neighborStatus",
    (select status from alerts where id=${f.ids.neighborAlert!}) as "neighborAlertStatus",
    (select count(*)::int from occurrence_events where occurrence_id in (${f.ids.neighborTicket!}::uuid,${f.ids.operatorNeighborTicket!}::uuid)) as "neighborEvents",
    (select active from role_bindings where id=${f.ids.deviceGrant!}) as "deviceGrantActive",
    (select active from role_bindings where id=${f.ids.ticketGrant!}) as "ticketGrantActive",
    (select active from role_bindings where id=${f.ids.financeGrant!}) as "financeGrantActive"`;
  return row;
}
export async function revoke(f: Fixture, kind: string) {
  guard();
  validate(f);
  if (!["device", "ticket", "finance"].includes(kind))
    throw new Error("Unknown fixture grant");
  const account =
    f.accounts[kind === "finance" ? "resident-mobile" : "operations-mobile"]!;
  const rows =
    await sqlClient`update role_bindings set active=false where id=${f.ids[kind + "Grant"]!} and user_id=${account.id} and building_id=${account.buildingId} returning id`;
  if (rows.length !== 1)
    throw new Error("Isolated grant did not match fixture");
}

async function main() {
  const [action, filename, kind] = process.argv.slice(2);
  if (!filename) throw new Error("Fixture file required");
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
    console.log(
      "Created isolated native domain fixture without printing credentials",
    );
  } else {
    const f = JSON.parse(await readFile(filename, "utf8")) as Fixture;
    if (action === "snapshot") console.log(JSON.stringify(await snapshot(f)));
    else if (action === "cleanup") {
      await cleanup(f);
      console.log("Removed only the isolated domain fixture");
    } else if (action === "revoke") {
      await revoke(f, kind ?? "");
      console.log("Revoked only the selected isolated grant");
    } else throw new Error("Expected create, snapshot, revoke or cleanup");
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
