import "./env.js";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

/**
 * Capacity measurement for raw telemetry, for a DISPOSABLE database only.
 * Writes a scratch building with synthetic readings, measures disk use per
 * reading (table + every index) and the two hot API queries under the real
 * runtime role and RLS, then removes the scratch rows.
 *
 *   TELEMETRY_CAPACITY_DISPOSABLE=1 pnpm --filter @predioon/db db:telemetry-capacity [devices] [days]
 *
 * Defaults: 50 devices, one reading per device per minute, 14 days.
 */
const DISPOSABLE_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "db"]);

const url = process.env.DATABASE_URL;
if (process.env.TELEMETRY_CAPACITY_DISPOSABLE !== "1" || !url || !DISPOSABLE_HOSTS.has(new URL(url).hostname)) {
  console.error("Medição recusada: exige TELEMETRY_CAPACITY_DISPOSABLE=1 e um banco descartável local (localhost ou o serviço db).");
  process.exit(1);
}
const devices = Number(process.argv[2] ?? 50), days = Number(process.argv[3] ?? 14);
if (!Number.isInteger(devices) || devices < 1 || devices > 500 || !Number.isInteger(days) || days < 1 || days > 60) {
  console.error("Use até 500 dispositivos e até 60 dias.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const suffix = randomUUID().slice(0, 8), org = `cap-${suffix}`, building = `cap-${suffix}-b`, manager = `cap-${suffix}-manager`;
const milliseconds = async (run: () => Promise<unknown>) => { const start = performance.now(); await run(); return Math.round(performance.now() - start); };
type Size = { table_bytes: string; index_bytes: string; toast_bytes: string; total_bytes: string };

try {
  const indexSizes = async () => new Map((await sql<{ name: string; bytes: string }[]>`
    select indexname as name, hypertable_index_size(format('public.%I', indexname)::regclass) as bytes
    from pg_indexes where schemaname='public' and tablename='telemetry'`).map(row => [row.name, Number(row.bytes)]));
  const [before] = await sql<Size[]>`select * from hypertable_detailed_size('public.telemetry')`;
  const indexesBefore = await indexSizes();
  await sql`insert into organizations(id,name,slug) values(${org},'Capacidade',${org})`;
  await sql`insert into buildings(id,organization_id,name,code) values(${building},${org},'Capacidade','CAP')`;
  await sql`insert into users(id,email,name) values(${manager},${`${manager}@capacity.invalid`},'Medição')`;
  await sql`insert into role_bindings(user_id,building_id,role_key) values(${manager},${building},'BUILDING_ADMIN')`;
  await sql`insert into devices(id,building_id,name,type,status)
    select ${building} || '-d' || n, ${building}, 'Medidor ' || n, 'WATER_LEVEL_SENSOR', 'ONLINE' from generate_series(1, ${devices}) n`;

  // Shape of a real reading: event id, JSON value, numeric copy and unit.
  const insertMs = await milliseconds(() => sql`
    insert into telemetry(event_id,building_id,device_id,metric,value,numeric_value,unit,time,received_at)
    select 'cap-' || n || '-' || m, ${building}, ${building} || '-d' || n, 'water_level_percent',
      jsonb_build_object('value', round((50 + 40 * sin(m / 90.0 + n))::numeric, 1)), round((50 + 40 * sin(m / 90.0 + n))::numeric, 1), '%',
      date_trunc('minute', now()) - make_interval(mins => m), date_trunc('minute', now()) - make_interval(mins => m) + interval '2 seconds'
    from generate_series(1, ${devices}) n, generate_series(0, ${days * 1440 - 1}) m`);
  await sql`analyze telemetry`;
  const [after] = await sql<Size[]>`select * from hypertable_detailed_size('public.telemetry')`;
  const indexesAfter = await indexSizes();
  const rows = devices * days * 1440;
  const delta = (key: keyof Size) => Number(after![key]) - Number(before![key]);

  // The hot queries as the API runs them: runtime role, user context, RLS.
  const asManager = <T>(run: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin(async tx => {
    await tx`set local role predioon_app`;
    await tx`select set_config('app.user_id', ${manager}, true), set_config('app.role', 'RESIDENT', true)`;
    return run(tx);
  });
  // The API query since 056: one backward index probe per catalogued series.
  const latest = (tx: postgres.TransactionSql) => tx`
    select t.device_id, t.metric, t.numeric_value, t.time
    from app_telemetry_authorized_devices(${building}) d
    join telemetry_series s on s.building_id=d.building_id and s.device_id=d.device_id
    cross join lateral (select t.device_id, t.metric, t.numeric_value, t.time from telemetry t
      where t.building_id=s.building_id and t.device_id=s.device_id and t.metric=s.metric and t.time > now() - interval '7 days'
      order by t.time desc, t.id desc limit 1) t
    where d.building_id=${building}`;
  // The query before 056, kept to show the difference on the same data.
  const latestSorted = (tx: postgres.TransactionSql) => tx`
    select distinct on (t.device_id, t.metric) t.device_id, t.metric, t.numeric_value, t.time
    from telemetry t join app_telemetry_authorized_devices(${building}) d on d.device_id=t.device_id and d.building_id=t.building_id
    where t.building_id=${building} and t.time > now() - interval '7 days'
    order by t.device_id, t.metric, t.time desc, t.id desc`;
  const series = (tx: postgres.TransactionSql, window: string, bucket: string) => tx`
    select time_bucket(${bucket}::interval, time) as bucket, avg(numeric_value), min(numeric_value), max(numeric_value), count(*)
    from telemetry where device_id=${building + "-d1"} and building_id=${building} and metric='water_level_percent'
      and time >= now() - ${window}::interval and time <= now() group by 1 order by 1`;
  const visible = await asManager(tx => latest(tx));
  if (visible.length !== devices) throw new Error(`RLS devolveu ${visible.length} de ${devices} dispositivos`);
  const timings: Record<string, number[]> = { latest: [], "latest before 056 (DISTINCT ON)": [], "series 24h/5min": [], [`series ${days}d/1h`]: [] };
  for (let round = 0; round < 5; round++) {
    timings.latest!.push(await milliseconds(() => asManager(tx => latest(tx))));
    timings["latest before 056 (DISTINCT ON)"]!.push(await milliseconds(() => asManager(tx => latestSorted(tx))));
    timings["series 24h/5min"]!.push(await milliseconds(() => asManager(tx => series(tx, "24 hours", "5 minutes"))));
    timings[`series ${days}d/1h`]!.push(await milliseconds(() => asManager(tx => series(tx, `${days} days`, "1 hour"))));
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  const perRow = delta("total_bytes") / rows;
  console.log(JSON.stringify({
    devices, days, readingsPerDevicePerMinute: 1, rows, insertMs, insertRowsPerSecond: Math.round(rows / (insertMs / 1000)),
    bytesPerReading: { total: Math.round(perRow), table: Math.round(delta("table_bytes") / rows), indexes: Math.round(delta("index_bytes") / rows), toast: Math.round(delta("toast_bytes") / rows) },
    indexBytesPerReading: Object.fromEntries([...indexesAfter].sort((a, b) => b[1] - a[1])
      .map(([name, bytes]) => [name, Math.round((bytes - (indexesBefore.get(name) ?? 0)) / rows)])),
    medianQueryMs: Object.fromEntries(Object.entries(timings).map(([name, values]) => [name, median(values)])),
    projectionGiBPerYear: { perDeviceAt1PerMinute: +(perRow * 525_600 / 2 ** 30).toFixed(3) },
  }, null, 2));
} finally {
  await sql`delete from telemetry where building_id=${building}`;
  await sql`delete from role_bindings where user_id=${manager}`;
  await sql`delete from users where id=${manager}`;
  await sql`delete from buildings where id=${building}`;
  await sql`delete from organizations where id=${org}`;
  await sql.end();
}
