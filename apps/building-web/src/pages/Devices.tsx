import { useState } from "react";
import { AlertTriangle, Clock3, Cpu, Info, Network, Power, RefreshCw, Search, SlidersHorizontal, Wifi, X } from "lucide-react";
import { Button, cls, deviceTypeLabel, ErrorBanner, formatDateTime, formatRelative, LoadingState, useResource } from "@predioon/ui";
import type { Device, Paged } from "@predioon/ui";
import { DEVICE_STATES, deviceIcon, deviceState, normalizeDeviceSearch } from "../components/device-presentation.js";

function DeviceStatus({ device }: { device: Device }) {
  const status = DEVICE_STATES[deviceState(device)];
  return <span className={cls("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium", status.classes)}>
    <span aria-hidden="true" className={cls("h-1.5 w-1.5 rounded-full", status.dot)} />{status.label}
  </span>;
}

function DeviceIdentity({ device }: { device: Device }) {
  const { icon: Icon, classes } = deviceIcon(device.type);
  return <div className="flex min-w-0 items-center gap-3">
    <span aria-hidden="true" className={cls("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", classes)}><Icon size={19} strokeWidth={1.8} /></span>
    <div className="min-w-0"><p className="break-words font-semibold leading-5 text-[#17334b]">{device.name}</p><p className="mt-1 break-all font-mono text-[11px] text-slate-500">{device.id}</p></div>
  </div>;
}

function LastReading({ device }: { device: Device }) {
  return <span title={formatDateTime(device.lastSeenAt)} className="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-600">
    <Clock3 size={14} aria-hidden="true" className="text-slate-400" />{device.lastSeenAt ? formatRelative(device.lastSeenAt) : "Sem leituras"}
  </span>;
}

const CONTROL = "h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";

export function Devices({ buildingId }: { buildingId: string }) {
  const devices = useResource<Paged<Device>>(`/devices?buildingId=${encodeURIComponent(buildingId)}`);
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [type, setType] = useState("");
  const items = devices.data?.items ?? [];
  const query = normalizeDeviceSearch(search);
  const filtered = items.filter(device => (!state || deviceState(device) === state) && (!type || device.type === type)
    && (!query || normalizeDeviceSearch([device.name, device.id, deviceTypeLabel(device.type), device.gatewayId ?? ""].join(" ")).includes(query)));
  const types = [...new Set(items.map(device => device.type))].sort((a, b) => deviceTypeLabel(a).localeCompare(deviceTypeLabel(b), "pt-BR"));
  const online = items.filter(device => deviceState(device) === "ONLINE").length;
  const disabled = items.filter(device => deviceState(device) === "DISABLED").length;
  const hasFilters = Boolean(search || state || type);
  const clearFilters = () => { setSearch(""); setState(""); setType(""); };
  const summary = [
    { label: "Total de equipamentos", value: items.length, detail: "Cadastrados no condomínio", icon: Cpu, iconClass: "bg-slate-100 text-[#17334b]", valueClass: "text-[#17334b]" },
    { label: "Online", value: online, detail: "Com estado online", icon: Wifi, iconClass: "bg-emerald-50 text-emerald-700", valueClass: "text-emerald-700" },
    { label: "Requerem atenção", value: items.length - online - disabled, detail: "Verifique o estado e a última leitura", icon: AlertTriangle, iconClass: "bg-amber-50 text-amber-700", valueClass: "text-amber-700" },
    { label: "Desativados", value: disabled, detail: "Fora do monitoramento", icon: Power, iconClass: "bg-slate-100 text-slate-500", valueClass: "text-slate-500" },
  ];

  return <div className="space-y-6 pb-2">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Monitoramento · Equipamentos</p>
        <h1 className="text-[28px] font-bold tracking-tight text-[#122f46] sm:text-[32px]">Dispositivos</h1>
        <p className="mt-1.5 text-sm leading-6 text-slate-600">Acompanhe os sensores e equipamentos conectados ao seu prédio.</p>
      </div>
      <button type="button" onClick={devices.reload} disabled={devices.loading} aria-label="Atualizar equipamentos" className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-[#17334b] shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60">
        <RefreshCw size={16} aria-hidden="true" className={devices.loading ? "animate-spin" : ""} />Atualizar
      </button>
    </div>

    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
      {summary.map(({ label, value, detail, icon: Icon, iconClass, valueClass }) => <section key={label} aria-label={label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_2px_6px_rgba(15,23,42,0.02)] sm:p-5">
        <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium leading-5 text-slate-600 sm:text-sm">{label}</p><span aria-hidden="true" className={cls("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", iconClass)}><Icon size={18} strokeWidth={1.8} /></span></div>
        <p className={cls("mt-2 text-[32px] font-bold leading-tight tracking-tight tabular-nums", valueClass)}>{devices.data ? value : "—"}</p>
        <p className="mt-2 text-[11px] leading-5 text-slate-500 sm:text-xs">{detail}</p>
      </section>)}
    </div>

    <section aria-labelledby="equipment-title" className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_6px_rgba(15,23,42,0.02)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-5 pt-6 sm:px-6">
        <div className="flex items-center gap-3"><span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Cpu size={20} /></span><div><h2 id="equipment-title" className="text-base font-bold text-[#17334b]">Equipamentos do prédio</h2><p className="mt-1 text-xs text-slate-500">Sensores, medidores e controladores em um só lugar.</p></div></div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{devices.data ? `${items.length} cadastrados` : "Inventário"}</span>
      </div>

      <div className="border-y border-slate-100 bg-slate-50/60 px-5 py-4 sm:px-6">
        <div className="grid gap-3 lg:grid-cols-[minmax(180px,1fr)_200px_220px]">
          <div className="relative"><Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-3.5 text-slate-400" /><label htmlFor="equipment-search" className="sr-only">Buscar equipamentos</label><input id="equipment-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nome, código ou gateway…" className={cls(CONTROL, "pl-10")} /></div>
          <label><span className="sr-only">Estado</span><select value={state} onChange={event => setState(event.target.value)} className={CONTROL}><option value="">Todos os estados</option>{Object.entries(DEVICE_STATES).map(([value, status]) => <option key={value} value={value}>{status.label}</option>)}</select></label>
          <label><span className="sr-only">Tipo de equipamento</span><select value={type} onChange={event => setType(event.target.value)} className={CONTROL}><option value="">Todos os tipos</option>{types.map(value => <option key={value} value={value}>{deviceTypeLabel(value)}</option>)}</select></label>
        </div>
        {hasFilters && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600"><span className="inline-flex items-center gap-1.5"><SlidersHorizontal size={13} aria-hidden="true" />Filtros aplicados</span><button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 rounded px-2 py-1 font-semibold text-emerald-700 hover:bg-emerald-50"><X size={13} aria-hidden="true" />Limpar filtros</button></div>}
      </div>

      {devices.error ? <div className="space-y-4 p-6"><ErrorBanner message={devices.error} /><Button variant="secondary" onClick={devices.reload}>Tentar novamente</Button></div>
        : devices.loading ? <LoadingState text="Carregando equipamentos…" />
        : !items.length ? <div className="flex flex-col items-center px-6 py-16 text-center"><Cpu size={30} aria-hidden="true" className="mb-4 text-slate-400" /><h3 className="font-semibold text-slate-700">Nenhum equipamento cadastrado</h3><p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">Os equipamentos aparecerão aqui quando forem cadastrados no condomínio.</p></div>
        : !filtered.length ? <div className="flex flex-col items-center px-6 py-16 text-center"><Search size={30} aria-hidden="true" className="mb-4 text-slate-400" /><h3 className="font-semibold text-slate-700">Nenhum equipamento encontrado</h3><p className="mb-5 mt-2 text-sm text-slate-500">Tente outro termo ou ajuste os filtros.</p><Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button></div>
        : <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[780px] text-left text-sm">
              <caption className="sr-only">Equipamentos do condomínio, tipos, gateways, última leitura e estado.</caption>
              <thead className="border-b border-slate-100 bg-slate-50/60 text-[11px] font-semibold uppercase tracking-wider text-slate-500"><tr>
                {['Equipamento', 'Tipo', 'Gateway', 'Última leitura', 'Estado'].map(label => <th key={label} scope="col" className="px-5 py-3.5 first:pl-6 last:pr-6">{label}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">{filtered.map(device => <tr key={device.id} className="transition-colors hover:bg-slate-50/80">
                <td className="max-w-[360px] py-4 pl-6 pr-5"><DeviceIdentity device={device} /></td>
                <td className="max-w-[240px] px-5 py-4 text-[13px] leading-5 text-slate-600">{deviceTypeLabel(device.type)}</td>
                <td className="px-5 py-4"><span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-500"><Network size={14} aria-hidden="true" />{device.gatewayId ?? "Não vinculado"}</span></td>
                <td className="px-5 py-4 text-xs"><LastReading device={device} /></td>
                <td className="py-4 pl-5 pr-6"><DeviceStatus device={device} /></td>
              </tr>)}</tbody>
            </table>
          </div>
          <ul aria-label="Lista de equipamentos" className="divide-y divide-slate-100 md:hidden">{filtered.map(device => <li key={device.id} className="space-y-4 p-5">
            <DeviceIdentity device={device} />
            <p className="text-xs leading-5 text-slate-600">{deviceTypeLabel(device.type)}</p>
            <dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className="mb-1.5 text-slate-500">Gateway</dt><dd className="break-all font-mono text-slate-600">{device.gatewayId ?? "Não vinculado"}</dd></div><div><dt className="mb-1.5 text-slate-500">Última leitura</dt><dd><LastReading device={device} /></dd></div></dl>
            <DeviceStatus device={device} />
          </li>)}</ul>
        </>}

      {devices.data && !devices.error && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-4 text-xs text-slate-500 sm:px-6"><p role="status" aria-live="polite">Exibindo <strong className="font-semibold text-slate-700">{filtered.length}</strong> de {items.length} equipamentos</p><span>Inventário do condomínio</span></div>}
    </section>
    <p className="flex items-start gap-2 px-1 text-xs leading-5 text-slate-600"><Info size={15} aria-hidden="true" className="mt-0.5 shrink-0" />Consulte a última leitura para acompanhar a atualização de cada equipamento.</p>
  </div>;
}
