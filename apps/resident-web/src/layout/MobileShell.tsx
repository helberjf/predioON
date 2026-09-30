import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ArrowLeft, Bell, CalendarDays, Home, Megaphone, User, Wrench } from "lucide-react";
import { Brand, buildingImage, cls, useFeatures, useAuth, useResource } from "@predioon/ui";
const TABS = [
  {to:"/",label:"Início",icon:Home}, {to:"/reservas",label:"Reservas",icon:CalendarDays},
  {to:"/avisos",label:"Avisos",icon:Megaphone}, {to:"/chamados",label:"Ocorrências",icon:Wrench}, {to:"/perfil",label:"Perfil",icon:User},
];
export function MobileShell({ children }: { children: ReactNode }) {
  const { user, buildingId } = useAuth();
  const location = useLocation();
  const flags = useFeatures();
  const home = location.pathname === "/";
  const building = useResource<{name:string}>(buildingId ? `/buildings/${encodeURIComponent(buildingId)}` : null);
  const current = [...TABS, { to: "/acessos", label: "Portões e acessos" }, { to: "/vagas", label: "Vagas de carros e motos" }, { to: "/consumo", label: "Consumo e análise" }, { to: "/transparencia", label: "Transparência e contas" }].find(tab => tab.to === location.pathname);
  return <div className="mx-auto min-h-screen max-w-md bg-[#f1f6f9] pb-24 shadow-xl shadow-slate-200/40">
    {home ? <header className="relative isolate h-[365px] overflow-hidden bg-[#153b60] px-5 pt-7 text-white">
      <img src={buildingImage} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover object-[center_56%]"/>
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#092c4b]/95 via-[#0b3458]/65 to-transparent"/>
      <div className="flex items-center justify-between gap-2"><Brand dark/><div className="flex items-center gap-2">{flags.enabled("NOTICES") && <Link to="/avisos" aria-label="Ver avisos" className="rounded-full p-2 hover:bg-white/10"><Bell size={23}/></Link>}<Link to="/perfil" aria-label="Meu perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-xs font-semibold">{user?.name.split(" ").map(part=>part[0]).slice(0,2).join("")}</Link></div></div>
      <div className="mt-12 max-w-[245px]"><h1 className="text-[29px] font-bold tracking-tight">Olá, {user?.name.split(" ")[0]}!</h1><p className="mt-2 text-[15px] leading-6 text-white/95">Bem-vindo ao<br/><strong className="font-medium">{building.data?.name ?? "seu condomínio"}</strong></p></div>
      <div className="mt-6 inline-flex items-center gap-3 rounded-xl border border-white/10 bg-[#123752]/60 px-4 py-3 backdrop-blur-sm"><CalendarDays size={27} className="text-emerald-300"/><div><p className="text-xs font-medium capitalize">{new Date().toLocaleDateString("pt-BR",{weekday:"long"})}</p><p className="mt-1 text-[11px] text-slate-200">{new Date().toLocaleDateString("pt-BR",{day:"numeric",month:"long",year:"numeric"})}</p></div></div>
    </header> : <header className="flex items-center gap-4 border-b border-slate-100 bg-white px-5 pb-5 pt-7"><Link to="/" aria-label="Voltar ao início" className="rounded-lg p-1 text-[#152d4b]"><ArrowLeft size={24}/></Link><div><h1 className="text-xl font-bold tracking-tight text-[#152d4b]">{current?.label ?? "Prédio ON"}</h1><p className="mt-1 text-sm text-slate-500">{location.pathname === "/reservas" ? "Áreas comuns" : building.data?.name ?? "Seu condomínio conectado"}</p></div></header>}
    <main className={cls("relative space-y-4 px-4 pb-4",home ? "-mt-5 rounded-t-[24px] bg-[#f1f6f9] pt-4" : "pt-4")}>{children}</main>
    <nav aria-label="Navegação do morador" className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md justify-around rounded-t-2xl border-t border-slate-100 bg-white px-2 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-3px_18px_rgba(20,45,70,0.035)]">{TABS.filter(tab => flags.routeAllowed(tab.to)).map(({to,label,icon:Icon})=><NavLink key={to} to={to} end={to==="/"} className={({isActive})=>cls("flex flex-1 flex-col items-center gap-1.5 rounded-lg py-1 text-[10px]",isActive ? "font-semibold text-emerald-600" : "text-slate-500")}><Icon size={23}/>{label}</NavLink>)}</nav>
  </div>;
}
