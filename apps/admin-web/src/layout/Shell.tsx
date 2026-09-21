import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { AlertTriangle, Building2, Cpu, LayoutDashboard, LogOut, RadioTower, ScrollText, ShieldCheck, Users } from "lucide-react";
import { Brand, cls, useAuth } from "@predioon/ui";

const LINKS = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard },
  { to: "/clientes", label: "Clientes", icon: ShieldCheck },
  { to: "/predios", label: "Prédios", icon: Building2 },
  { to: "/gateways", label: "Gateways", icon: RadioTower },
  { to: "/dispositivos", label: "Dispositivos", icon: Cpu },
  { to: "/alertas", label: "Alertas", icon: AlertTriangle },
  { to: "/usuarios", label: "Usuários", icon: Users },
  { to: "/auditoria", label: "Auditoria", icon: ScrollText },
];

export function Shell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const current = LINKS.find((link) => link.to === location.pathname)?.label ?? "Administração";
  const nav = (mobile = false) => LINKS.map(({ to, label, icon: Icon }) => (
    <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => cls(
      mobile ? "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-xs" : "flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm transition",
      isActive ? "bg-emerald-500/15 font-semibold text-emerald-400" : "text-slate-400 hover:bg-white/5 hover:text-white",
    )}><Icon size={mobile ? 15 : 18} />{label}</NavLink>
  ));

  return (
    <div className="min-h-screen bg-[#f5f7fa]">
      <a href="#conteudo" className="sr-only z-50 rounded-lg bg-white p-3 text-emerald-700 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Pular para o conteúdo</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-[#111c2e] p-5 lg:flex">
        <div className="px-1 py-3"><Brand dark /></div>
        <p className="mb-3 mt-10 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Gestão da plataforma</p>
        <nav aria-label="Menu principal" className="flex-1 space-y-1 overflow-y-auto">{nav()}</nav>
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="mb-3 flex items-center gap-3 px-2"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold text-white">{user?.name.slice(0, 1)}</span><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-200">{user?.name}</p><p className="mt-0.5 text-[11px] text-slate-500">Administração</p></div></div>
          <button onClick={() => void signOut()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white"><LogOut size={17} />Sair da conta</button>
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex min-h-[76px] items-center justify-between gap-3 px-4 md:px-8">
            <div className="min-w-0"><div className="lg:hidden"><Brand compact /></div><p className="hidden text-sm font-semibold text-slate-800 lg:block">Administração</p><p className="mt-1 hidden text-xs text-slate-400 lg:block">Prédio ON <span className="px-1.5">/</span> {current}</p></div>
            <div className="flex shrink-0 items-center gap-3"><span className="hidden rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 sm:block">Administração</span><span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-sm font-semibold text-emerald-700">{user?.name.slice(0, 1)}</span><button aria-label="Sair da conta" onClick={() => void signOut()} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"><LogOut size={18} /></button></div>
          </div>
          <nav aria-label="Menu principal no celular" className="flex gap-1 overflow-x-auto bg-[#111c2e] px-3 py-2 lg:hidden">{nav(true)}</nav>
        </header>
        <main id="conteudo" className="mx-auto max-w-[1600px] space-y-6 p-4 md:p-8">{children}</main>
        <footer className="mx-auto flex max-w-[1600px] flex-wrap justify-between gap-2 px-4 pb-6 text-[11px] text-slate-400 md:px-8"><span>Prédio ON · Seu condomínio conectado</span><span>Gestão da plataforma</span></footer>
      </div>
    </div>
  );
}
