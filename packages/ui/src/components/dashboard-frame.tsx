import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Bell, ChevronRight, LogOut, Menu, Search, MapPin, X } from "lucide-react";
import { Brand } from "./primitives.js";
import { buildingImage } from "../assets.js";
import { cls } from "../format.js";

export type NavigationItem = { to: string; label: string; icon: ComponentType<{ size?: number; className?: string }> };
type Props = {
  children: ReactNode; title: string; subtitle: string; userName: string; role: string;
  links: NavigationItem[]; pathname: string; signOut: () => void;
  renderLink: (to: string, children: ReactNode, className: string) => ReactNode;
};

export function DashboardFrame({ children, title, subtitle, userName, role, links, pathname, signOut, renderLink }: Props) {
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = userName.split(" ").filter(Boolean).slice(0, 2).map(part => part[0]).join("");
  const matches = links.filter(link => link.label.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")));

  // Fecha o menu ao trocar de página: o clique no link já navegou.
  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [menuOpen]);

  const nav = () => links.map(({ to, label, icon: Icon }) => <div key={to}>{renderLink(to, <><Icon size={20}/><span>{label}</span><ChevronRight size={14} className="ml-auto opacity-40"/></>, cls("flex h-11 items-center gap-3 rounded-md px-3 text-[13px] transition", pathname === to ? "bg-[#0b5155] font-semibold text-[#33d6a4]" : "text-slate-200 hover:bg-white/5 hover:text-white"))}</div>);

  // Mesma coluna escura serve à barra fixa do desktop e ao painel deslizante do celular.
  const sidebar = (onClose?: () => void) => <>
    <div className="flex items-start justify-between px-5 pb-6 pt-5">
      <Brand dark/>
      {onClose && <button aria-label="Fechar menu" onClick={onClose} className="-mr-1 rounded-md p-2 text-slate-300 hover:bg-white/10"><X size={20}/></button>}
    </div>
    <nav aria-label="Menu principal" className="space-y-1 px-3">{nav()}</nav>
    <div className="relative mt-5 min-h-32 flex-1 overflow-hidden" aria-hidden="true">
      <img src={buildingImage} alt="" className="absolute inset-0 h-full w-full object-cover object-center opacity-65"/>
      <div className="absolute inset-0 bg-gradient-to-b from-[#0c202e] via-transparent to-[#0c202e]"/>
      <p className="absolute bottom-5 left-6 text-xs leading-5 text-slate-300">Mais segurança<br/>Mais eficiência<br/>Mais tranquilidade</p>
    </div>
    <div className="flex items-center justify-between border-t border-white/5 bg-white/[0.025] px-6 py-4">
      <div><p className="text-xs font-semibold text-white">Prédio ON</p><p className="mt-1 text-[10px] text-slate-400">Seu prédio conectado</p></div>
      <button aria-label="Sair da conta" title="Sair da conta" onClick={signOut} className="rounded-md p-2 text-slate-300 hover:bg-white/10"><LogOut size={17}/></button>
    </div>
  </>;

  return <div className="min-h-screen bg-[#eef5f9]">
    <a href="#conteudo" className="sr-only z-50 bg-white p-3 text-emerald-700 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Pular para o conteúdo</a>

    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col overflow-y-auto bg-[#0c202e] lg:flex">{sidebar()}</aside>

    {menuOpen && <div className="fixed inset-0 z-40 lg:hidden">
      <div className="absolute inset-0 bg-slate-900/60" onClick={() => setMenuOpen(false)} aria-hidden="true"/>
      <div role="dialog" aria-modal="true" aria-label="Menu principal" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-[#0c202e] shadow-2xl">
        {sidebar(() => setMenuOpen(false))}
      </div>
    </div>}

    <div className="lg:pl-60">
      <header className="relative z-20 border-b border-slate-200/70 bg-[#fafdff]">
        <div className="flex min-h-[72px] items-center justify-between gap-4 px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button aria-label="Abrir menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)} className="-ml-1 rounded-lg p-2 text-[#183a58] hover:bg-slate-100 lg:hidden"><Menu size={22}/></button>
            <div className="min-w-0">
              <div className="lg:hidden"><Brand compact/></div>
              <p className="hidden truncate text-[17px] font-bold tracking-tight text-[#142f50] lg:block">{title}</p>
              <p className="mt-1 hidden items-center gap-1.5 text-xs text-slate-500 lg:flex"><MapPin size={14}/>{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 md:gap-5">
            <div role="search" className="relative hidden w-48 xl:block">
              <Search size={15} className="pointer-events-none absolute left-3 top-3 text-slate-400"/>
              <input aria-label="Buscar no sistema" placeholder="Buscar no sistema..." value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setSearch(""); }} className="w-full rounded-md border border-slate-200 bg-transparent py-2.5 pl-9 pr-3 text-xs outline-none focus:border-emerald-500"/>
              {search.trim() && <div className="absolute right-0 top-11 w-60 rounded-lg border border-slate-200 bg-white p-2 shadow-lg" onClick={() => setSearch("")}>{matches.length ? matches.map(item => <div key={item.to}>{renderLink(item.to, item.label, "block rounded-md p-2 text-sm text-slate-700 hover:bg-emerald-50")}</div>) : <p className="p-2 text-xs text-slate-500">Nenhuma página encontrada.</p>}</div>}
            </div>
            {renderLink("/alertas", <><Bell size={22}/><span className="sr-only">Ver alertas</span></>, "rounded-lg p-2 text-[#183a58] hover:bg-slate-100")}
            <div className="flex items-center gap-2.5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1b3f60] text-sm font-semibold text-white">{initials}</span><div className="hidden sm:block"><p className="max-w-36 truncate text-xs font-semibold text-[#18304e]">{userName}</p><p className="mt-1 text-[11px] text-slate-500">{role}</p></div></div>
          </div>
        </div>
        <p className="border-t border-slate-200/70 px-4 py-2.5 text-[13px] font-semibold text-[#142f50] lg:hidden">{title}</p>
      </header>
      <main id="conteudo" className="mx-auto max-w-[1680px] space-y-4 p-4 md:p-5">{children}</main>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 bg-white px-6 py-5 text-[11px] text-slate-500"><div><strong className="text-[#18304e]">Prédio ON</strong><p className="mt-1">Tecnologia a serviço do seu condomínio.</p></div><span>{role} · Seu prédio, sempre conectado.</span></footer>
    </div>
  </div>;
}

export function ProgressRing({ value, label, color = "#13ac70" }: { value: number | null; label: string; color?: string }) {
  const percentage = value === null ? 0 : Math.min(100, Math.max(0, value));
  return <div role="img" aria-label={`${label}: ${value === null ? "sem dados" : `${Math.round(percentage)}%`}`} className="relative h-28 w-28 shrink-0">
    <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90"><circle cx="60" cy="60" r="48" fill="none" stroke="#e8eef1" strokeWidth="11"/><circle cx="60" cy="60" r="48" fill="none" stroke={color} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${percentage * 3.016} 301.6`}/></svg>
    <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-[#162f4e]">{value === null ? "—" : `${Math.round(percentage)}%`}</span>
  </div>;
}
