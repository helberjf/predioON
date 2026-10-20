import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ArrowLeft, Bell, CalendarDays, Car, ChartNoAxesCombined, Ellipsis, Home, KeyRound, Megaphone, ScrollText, User, Wrench, X } from "lucide-react";
import { useConsumptionAvailable } from "../consumption.js";
import { useAccessAvailable } from "../access.js";
import { Brand, BuildingSelector, buildingImage, cls, useFeatures, useAuth, useBuildingScope, useResource } from "@predioon/ui";

type Destination = { to: string; label: string; title?: string; icon: ComponentType<{ size?: number; strokeWidth?: number }>; ownHeading?: boolean };
/**
 * Every place a resident can go, most used first. The first four that the
 * condominium has enabled become tabs; the others stay one tap away under "Mais".
 * `ownHeading` marks screens that already bring their own page title.
 */
const DESTINATIONS: Destination[] = [
  { to: "/", label: "Início", icon: Home },
  { to: "/reservas", label: "Reservas", icon: CalendarDays },
  { to: "/acessos", label: "Acessos", title: "Portões e acessos", icon: KeyRound, ownHeading: true },
  { to: "/chamados", label: "Ocorrências", icon: Wrench, ownHeading: true },
  { to: "/avisos", label: "Avisos", icon: Megaphone },
  { to: "/vagas", label: "Vagas", title: "Vagas de carros e motos", icon: Car },
  { to: "/consumo", label: "Consumo", title: "Consumo e análise", icon: ChartNoAxesCombined, ownHeading: true },
  { to: "/transparencia", label: "Transparência", title: "Transparência e contas", icon: ScrollText, ownHeading: true },
];
const PROFILE: Destination = { to: "/perfil", label: "Perfil", icon: User };
const TAB = "flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] transition";

export function MobileShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { buildingId } = useBuildingScope();
  const location = useLocation();
  const flags = useFeatures();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();
  const moreRef = useRef<HTMLDivElement>(null);
  const home = location.pathname === "/";
  const building = useResource<{ name: string }>(buildingId ? `/buildings/${encodeURIComponent(buildingId)}` : null);
  const consumption = useConsumptionAvailable(buildingId);
  const access = useAccessAvailable(buildingId);
  const allowed = DESTINATIONS.filter(item => flags.routeAllowed(item.to) && (item.to !== "/consumo" || consumption) && (item.to !== "/acessos" || access));
  const tabs = allowed.slice(0, 4), more = [...allowed.slice(4), PROFILE];
  const current = [...DESTINATIONS, PROFILE].find(item => item.to === location.pathname);
  const inMore = more.some(item => item.to === location.pathname);
  const initials = user?.name.split(" ").filter(Boolean).map(part => part[0]).slice(0, 2).join("");
  const firstName = user?.name.split(" ")[0];
  const avatar = (className: string) => <Link to="/perfil" aria-label="Perfil" title="Meu perfil" className={cls("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold", className)}>{initials}</Link>;

  useEffect(() => setMoreOpen(false), [location.pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    moreRef.current?.querySelector<HTMLElement>("a")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMoreOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  return <div className="mx-auto min-h-screen max-w-md bg-[#f1f6f9] pb-24 shadow-xl shadow-slate-300/40">
    {home ? <header className="relative isolate h-[330px] overflow-hidden bg-[#153b60] px-5 pt-6 text-white">
      <img src={buildingImage} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover object-[center_56%]" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#092c4b]/95 via-[#0b3458]/70 to-[#0b3458]/10" />
      <div className="flex items-center justify-between gap-2">
        <Brand dark />
        <div className="flex items-center gap-1.5">
          {flags.enabled("NOTICES") && <Link to="/avisos" aria-label="Ver avisos" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10"><Bell size={22} /></Link>}
          {avatar("bg-white/20 ring-1 ring-white/30 hover:bg-white/30")}
        </div>
      </div>
      <div className="mt-10 max-w-[260px]">
        <h1 className="text-[30px] font-bold leading-tight tracking-tight">Olá, {firstName}!</h1>
        <p className="mt-2 text-[15px] leading-6 text-white/95">Bem-vindo ao<br /><strong className="font-semibold">{building.data?.name ?? "seu condomínio"}</strong></p>
      </div>
      <div className="mt-5 inline-flex items-center gap-3 rounded-2xl border border-white/15 bg-[#123752]/60 px-4 py-3 backdrop-blur-sm">
        <CalendarDays size={26} className="text-emerald-300" />
        <div>
          <p className="text-[13px] font-semibold capitalize">{new Date().toLocaleDateString("pt-BR", { weekday: "long" })}</p>
          <p className="mt-0.5 text-[11px] text-slate-200">{new Date().toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
      </div>
    </header> : <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200/70 bg-white/95 px-3 py-3 backdrop-blur">
      <Link to="/" aria-label="Voltar ao início" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#152d4b] hover:bg-slate-100"><ArrowLeft size={22} /></Link>
      <div className="min-w-0 flex-1">
        {/* Screens with their own page title keep the only h1; the bar just says where you are. */}
        {current?.ownHeading
          ? <p className="truncate text-[15px] font-semibold text-[#152d4b]">{building.data?.name ?? "Prédio ON"}</p>
          : <><h1 className="truncate text-lg font-bold tracking-tight text-[#152d4b]">{current?.title ?? current?.label ?? "Prédio ON"}</h1>
            <p className="truncate text-xs text-slate-500">{location.pathname === "/reservas" ? "Áreas comuns" : building.data?.name ?? "Seu condomínio conectado"}</p></>}
      </div>
      {location.pathname !== "/perfil" && avatar("bg-[#1b3f60] text-white hover:bg-[#234d74]")}
    </header>}

    <main className={cls("relative space-y-4 px-4 pb-4", home ? "-mt-6 rounded-t-[28px] bg-[#f1f6f9] pt-5" : "pt-4")}><BuildingSelector />{children}</main>

    {moreOpen && <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => setMoreOpen(false)} className="fixed inset-0 z-20 cursor-default bg-slate-900/40" />}
    <nav aria-label="Navegação do morador" className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md">
      {moreOpen && <div ref={moreRef} id={moreId} role="group" aria-label="Mais opções" className="absolute inset-x-0 bottom-full rounded-t-[28px] border-t border-slate-100 bg-white px-4 pb-3 pt-4 shadow-[0_-12px_32px_rgba(15,40,70,0.14)]">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-bold text-[#152d4b]">Mais opções</p>
          <button type="button" aria-label="Fechar mais opções" onClick={() => setMoreOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-3 gap-2">{more.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={() => setMoreOpen(false)} className={({ isActive }) => cls("flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-3 text-center text-xs font-semibold", isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-100 bg-slate-50/70 text-[#152d4b] hover:border-emerald-200")}>
          <Icon size={22} />{label}
        </NavLink>)}</div>
      </div>}
      <div className="flex justify-around rounded-t-3xl border-t border-slate-100 bg-white px-2 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-4px_20px_rgba(20,45,70,0.06)]">
        {tabs.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => cls(TAB, isActive && !moreOpen ? "font-semibold text-emerald-600" : "text-slate-500 hover:text-slate-700")}>
          {({ isActive }) => <><Icon size={23} strokeWidth={isActive && !moreOpen ? 2.4 : 2} />{label}</>}
        </NavLink>)}
        <button type="button" aria-expanded={moreOpen} aria-controls={moreOpen ? moreId : undefined} onClick={() => setMoreOpen(open => !open)} className={cls(TAB, moreOpen || inMore ? "font-semibold text-emerald-600" : "text-slate-500 hover:text-slate-700")}>
          <Ellipsis size={23} strokeWidth={moreOpen || inMore ? 2.4 : 2} />Mais
        </button>
      </div>
    </nav>
  </div>;
}
