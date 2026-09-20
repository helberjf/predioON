import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Cpu,
  Gauge,
  LayoutDashboard,
  RadioTower,
  RefreshCw,
  ScrollText,
  ServerCog,
  ShieldCheck,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { getJson, postJson } from "./lib/api";
import "./index.css";

type Organization = { id: string; name: string; slug: string; active: boolean };
type Building = { id: string; organizationId: string; name: string; code: string; timezone: string; active: boolean };
type Gateway = { id: string; buildingId: string; name: string; serialNumber: string; model: string | null; status: string; lastSeenAt: string | null };
type Device = { id: string; buildingId: string; gatewayId: string | null; name: string; type: string; status: string; enabled: boolean; lastSeenAt: string | null };
type AlertRow = { id: string; buildingId: string; deviceId: string; severity: string; type: string; status: string; message: string; createdAt: string };
type UserRow = { id: string; email: string; name: string; isPlatformAdmin: boolean; active: boolean };
type AuditRow = { id: string; buildingId: string | null; userId: string | null; actorType: string; action: string; resourceType: string; resourceId: string | null; createdAt: string };
type TelemetryRow = { id: string; buildingId: string; deviceId: string; metric: string; value: number | boolean | string; unit: string | null; quality: string; time: string };
type Snapshot = {
  organizations: Organization[];
  buildings: Building[];
  gateways: Gateway[];
  devices: Device[];
  alerts: AlertRow[];
  users: UserRow[];
  auditLogs: AuditRow[];
  telemetry: TelemetryRow[];
  generatedAt: string;
};

type Section = "dashboard" | "clients" | "buildings" | "gateways" | "devices" | "alerts" | "users" | "audit";

const menu: Array<{ id: Section; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = [
  { id: "dashboard", label: "Visão geral", icon: LayoutDashboard },
  { id: "clients", label: "Clientes", icon: ShieldCheck },
  { id: "buildings", label: "Prédios", icon: Building2 },
  { id: "gateways", label: "Gateways", icon: RadioTower },
  { id: "devices", label: "Dispositivos", icon: Cpu },
  { id: "alerts", label: "Alertas", icon: AlertTriangle },
  { id: "users", label: "Usuários", icon: Users },
  { id: "audit", label: "Auditoria", icon: ScrollText },
];

function cls(...parts: Array<string | false | null | undefined>) { return parts.filter(Boolean).join(" "); }
function when(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}
function statusClass(value: string) {
  if (["ONLINE", "EXECUTED", "ACKNOWLEDGED", "RESOLVED"].includes(value)) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (["OPEN", "HIGH", "CRITICAL", "FAILED", "ERROR"].includes(value)) return "border-rose-500/30 bg-rose-500/10 text-rose-300";
  if (["PENDING", "PUBLISHED", "MEDIUM", "PROVISIONING"].includes(value)) return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-slate-700 bg-slate-800/70 text-slate-300";
}
function Pill({ children }: { children: React.ReactNode }) {
  return <span className={cls("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", statusClass(String(children)))}>{children}</span>;
}
function Panel({ title, subtitle, children, right }: { title: string; subtitle?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 shadow-2xl shadow-black/10">
    <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
      <div><h2 className="font-semibold text-slate-100">{title}</h2>{subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}</div>{right}
    </div>
    <div className="p-5">{children}</div>
  </section>;
}
function MetricCard({ label, value, detail, icon: Icon }: { label: string; value: string | number; detail: string; icon: React.ComponentType<{ size?: number; className?: string }> }) {
  return <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-5">
    <div className="flex items-center justify-between"><p className="text-sm text-slate-400">{label}</p><Icon size={20} className="text-cyan-400" /></div>
    <p className="mt-4 text-3xl font-bold tracking-tight">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p>
  </div>;
}
function Empty({ text }: { text: string }) { return <p className="py-8 text-center text-sm text-slate-500">{text}</p>; }

function App() {
  const [section, setSection] = useState<Section>("dashboard");
  const [data, setData] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState("Conectando...");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    try {
      const snapshot = await getJson<Snapshot>("/admin/snapshot");
      setData(snapshot);
      setStatus("API online");
    } catch (error) {
      setStatus("API indisponível");
      setMessage(error instanceof Error ? error.message : "Falha ao carregar o painel");
    } finally { setBusy(false); }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, []);

  const counts = useMemo(() => ({
    onlineGateways: data?.gateways.filter((g) => g.status === "ONLINE").length ?? 0,
    onlineDevices: data?.devices.filter((d) => d.status === "ONLINE").length ?? 0,
    openAlerts: data?.alerts.filter((a) => a.status !== "RESOLVED").length ?? 0,
  }), [data]);

  async function updateAlert(id: string, action: "acknowledge" | "resolve") {
    try {
      await postJson(`/alerts/${id}/${action}`, {});
      setMessage(action === "acknowledge" ? "Alerta reconhecido." : "Alerta resolvido.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao atualizar alerta"); }
  }

  const currentTitle = menu.find((item) => item.id === section)?.label ?? "Prédio ON";

  return <div className="min-h-screen bg-slate-950 text-slate-100">
    <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-800 bg-slate-950/95 p-4 lg:block">
      <div className="mb-8 px-3 py-3"><p className="text-xs font-bold uppercase tracking-[0.28em] text-cyan-400">Prédio ON</p><p className="mt-2 text-lg font-bold">Admin Platform</p><p className="mt-1 text-xs text-slate-500">IoT · Monitoramento · Alertas</p></div>
      <nav className="space-y-1">{menu.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setSection(id)} className={cls("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition", section === id ? "bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-500/20" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100")}><Icon size={18}/><span className="flex-1">{label}</span>{section === id && <ChevronRight size={15}/>}</button>)}</nav>
      <div className="absolute bottom-5 left-4 right-4 rounded-xl border border-slate-800 bg-slate-900/70 p-3"><div className="flex items-center gap-2 text-xs"><span className={cls("h-2 w-2 rounded-full", status === "API online" ? "bg-emerald-400" : "bg-rose-400")}/>{status}</div><p className="mt-2 text-[11px] text-slate-500">Atualização automática a cada 10 s.</p></div>
    </aside>

    <div className="lg:pl-64">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/90 px-4 py-4 backdrop-blur md:px-7">
        <div className="flex items-center justify-between gap-4"><div><p className="text-xs text-slate-500">Administração da plataforma</p><h1 className="text-xl font-bold">{currentTitle}</h1></div><div className="flex items-center gap-3"><button onClick={() => void load()} disabled={busy} className="rounded-xl border border-slate-700 bg-slate-900 p-2.5 text-slate-300 hover:border-slate-600 hover:text-white"><RefreshCw size={17} className={busy ? "animate-spin" : ""}/></button><div className="hidden items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 sm:flex"><CircleUserRound size={17} className="text-cyan-400"/><div><p className="text-xs font-semibold">Administrador</p><p className="text-[10px] text-slate-500">PLATFORM_ADMIN</p></div></div></div></div>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">{menu.map(({ id, label }) => <button key={id} onClick={() => setSection(id)} className={cls("whitespace-nowrap rounded-lg px-3 py-1.5 text-xs", section === id ? "bg-cyan-500 text-slate-950" : "bg-slate-900 text-slate-400")}>{label}</button>)}</div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-6 p-4 md:p-7">
        {message && <div className="flex items-start justify-between gap-4 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100"><span>{message}</span><button onClick={() => setMessage(null)} className="text-cyan-400">×</button></div>}
        {!data ? <Panel title="Carregando plataforma"><div className="flex items-center gap-3 text-sm text-slate-400"><RefreshCw className="animate-spin" size={18}/>Aguardando API e banco de dados...</div></Panel> : <>
          {section === "dashboard" && <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <MetricCard label="Clientes" value={data.organizations.length} detail="organizações cadastradas" icon={ShieldCheck}/>
              <MetricCard label="Prédios" value={data.buildings.length} detail="condomínios ativos" icon={Building2}/>
              <MetricCard label="Gateways online" value={`${counts.onlineGateways}/${data.gateways.length}`} detail="conectividade de campo" icon={RadioTower}/>
              <MetricCard label="Dispositivos online" value={`${counts.onlineDevices}/${data.devices.length}`} detail="sensores e atuadores" icon={Cpu}/>
              <MetricCard label="Alertas ativos" value={counts.openAlerts} detail="exigem acompanhamento" icon={AlertTriangle}/>
            </div>
            <div className="grid gap-6 xl:grid-cols-2">
              <Panel title="Saúde dos gateways" subtitle="Última conectividade conhecida dos gateways de cada prédio">
                <div className="space-y-3">{data.gateways.length === 0 ? <Empty text="Nenhum gateway cadastrado."/> : data.gateways.slice(0, 8).map((g) => <div key={g.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 p-3"><div className="flex items-center gap-3">{g.status === "ONLINE" ? <Wifi size={18} className="text-emerald-400"/> : <WifiOff size={18} className="text-rose-400"/>}<div><p className="text-sm font-medium">{g.name}</p><p className="text-xs text-slate-500">{g.id} · {g.model ?? "modelo não informado"}</p></div></div><div className="text-right"><Pill>{g.status}</Pill><p className="mt-1 text-[10px] text-slate-500">{when(g.lastSeenAt)}</p></div></div>)}</div>
              </Panel>
              <Panel title="Alertas recentes" subtitle="Eventos gerados pelas regras de monitoramento">
                <div className="space-y-3">{data.alerts.length === 0 ? <Empty text="Nenhum alerta registrado."/> : data.alerts.slice(0, 8).map((a) => <div key={a.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">{a.message}</p><Pill>{a.severity}</Pill></div><div className="mt-2 flex items-center justify-between text-xs text-slate-500"><span>{a.deviceId}</span><span>{when(a.createdAt)}</span></div></div>)}</div>
              </Panel>
            </div>
            <Panel title="Telemetria mais recente" subtitle="Amostras recebidas pelo serviço de ingestão MQTT">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{data.telemetry.length === 0 ? <div className="md:col-span-2 xl:col-span-4"><Empty text="Ainda não há telemetria. Execute o simulador de hardware descrito no README."/></div> : data.telemetry.slice(0, 8).map((t) => <div key={`${t.id}-${t.time}`} className="rounded-xl border border-slate-800 bg-slate-950 p-4"><div className="flex items-center justify-between"><Gauge size={18} className="text-cyan-400"/><Pill>{t.quality}</Pill></div><p className="mt-4 text-xs text-slate-500">{t.deviceId} · {t.metric}</p><p className="mt-1 text-2xl font-bold">{String(t.value)} <span className="text-sm font-normal text-slate-500">{t.unit ?? ""}</span></p><p className="mt-2 text-[10px] text-slate-600">{when(t.time)}</p></div>)}</div>
            </Panel>
          </>}

          {section === "clients" && <Panel title="Clientes / organizações" subtitle="Tenants comerciais atendidos pelo Prédio ON"><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="pb-3">Cliente</th><th>Slug</th><th>Prédios</th><th>Status</th></tr></thead><tbody className="divide-y divide-slate-800">{data.organizations.map((o) => <tr key={o.id}><td className="py-4"><p className="font-medium">{o.name}</p><p className="text-xs text-slate-500">{o.id}</p></td><td>{o.slug}</td><td>{data.buildings.filter((b) => b.organizationId === o.id).length}</td><td><Pill>{o.active ? "ATIVO" : "INATIVO"}</Pill></td></tr>)}</tbody></table></div></Panel>}

          {section === "buildings" && <Panel title="Prédios" subtitle="Condomínios vinculados aos clientes"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.buildings.map((b) => <div key={b.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5"><div className="flex items-start justify-between"><Building2 className="text-indigo-400"/><Pill>{b.active ? "ATIVO" : "INATIVO"}</Pill></div><h3 className="mt-4 font-semibold">{b.name}</h3><p className="mt-1 text-xs text-slate-500">{b.id} · {b.code}</p><div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-slate-900 p-2"><span className="text-slate-500">Gateways</span><p className="mt-1 font-bold">{data.gateways.filter((g) => g.buildingId === b.id).length}</p></div><div className="rounded-lg bg-slate-900 p-2"><span className="text-slate-500">Dispositivos</span><p className="mt-1 font-bold">{data.devices.filter((d) => d.buildingId === b.id).length}</p></div></div></div>)}</div></Panel>}

          {section === "gateways" && <Panel title="Gateways" subtitle="Ponte entre RS485/Modbus e MQTT"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="pb-3">Gateway</th><th>Prédio</th><th>Modelo</th><th>Serial</th><th>Status</th><th>Último contato</th></tr></thead><tbody className="divide-y divide-slate-800">{data.gateways.map((g) => <tr key={g.id}><td className="py-4"><p className="font-medium">{g.name}</p><p className="text-xs text-slate-500">{g.id}</p></td><td>{g.buildingId}</td><td>{g.model ?? "—"}</td><td>{g.serialNumber}</td><td><Pill>{g.status}</Pill></td><td className="text-xs text-slate-400">{when(g.lastSeenAt)}</td></tr>)}</tbody></table></div></Panel>}

          {section === "devices" && <Panel title="Dispositivos" subtitle="Sensores e atuadores cadastrados na plataforma"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.devices.map((d) => <div key={d.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5"><div className="flex items-start justify-between"><Cpu className="text-cyan-400"/><Pill>{d.status}</Pill></div><h3 className="mt-4 font-semibold">{d.name}</h3><p className="mt-1 text-xs text-slate-500">{d.type}</p><div className="mt-4 space-y-1 text-xs text-slate-400"><p>ID: <span className="text-slate-300">{d.id}</span></p><p>Gateway: <span className="text-slate-300">{d.gatewayId ?? "—"}</span></p><p>Última atividade: <span className="text-slate-300">{when(d.lastSeenAt)}</span></p></div></div>)}</div></Panel>}

          {section === "alerts" && <Panel title="Alertas" subtitle="Reconheça ou resolva eventos operacionais"><div className="space-y-3">{data.alerts.length === 0 ? <Empty text="Nenhum alerta registrado."/> : data.alerts.map((a) => <div key={a.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-center"><div><div className="flex flex-wrap items-center gap-2"><Pill>{a.severity}</Pill><Pill>{a.status}</Pill><span className="text-xs text-slate-500">{a.type}</span></div><p className="mt-2 text-sm font-medium">{a.message}</p><p className="mt-1 text-xs text-slate-500">{a.buildingId} · {a.deviceId} · {when(a.createdAt)}</p></div><div className="flex gap-2">{a.status === "OPEN" && <button onClick={() => void updateAlert(a.id, "acknowledge")} className="rounded-lg border border-slate-700 px-3 py-2 text-xs hover:bg-slate-900">Reconhecer</button>}{a.status !== "RESOLVED" && <button onClick={() => void updateAlert(a.id, "resolve")} className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950"><CheckCircle2 size={14}/>Resolver</button>}</div></div></div>)}</div></Panel>}

          {section === "users" && <Panel title="Usuários" subtitle="Contas conhecidas pela plataforma"><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="pb-3">Nome</th><th>E-mail</th><th>ID</th><th>Perfil</th><th>Status</th></tr></thead><tbody className="divide-y divide-slate-800">{data.users.map((u) => <tr key={u.id}><td className="py-4 font-medium">{u.name}</td><td>{u.email}</td><td className="text-xs text-slate-500">{u.id}</td><td>{u.isPlatformAdmin ? "Administrador global" : "Usuário"}</td><td><Pill>{u.active ? "ATIVO" : "INATIVO"}</Pill></td></tr>)}</tbody></table></div></Panel>}

          {section === "audit" && <Panel title="Auditoria" subtitle="Registro de ações relevantes da plataforma"><div className="space-y-2">{data.auditLogs.length === 0 ? <Empty text="Nenhum registro de auditoria."/> : data.auditLogs.map((log) => <div key={log.id} className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3 md:flex-row md:items-center md:justify-between"><div className="flex items-center gap-3"><ServerCog size={17} className="text-slate-500"/><div><p className="text-sm font-medium">{log.action}</p><p className="text-xs text-slate-500">{log.actorType} · {log.userId ?? "SYSTEM"} · {log.resourceType}:{log.resourceId ?? "—"}</p></div></div><p className="text-xs text-slate-500">{when(log.createdAt)}</p></div>)}</div></Panel>}
        </>}
      </main>
    </div>
  </div>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
