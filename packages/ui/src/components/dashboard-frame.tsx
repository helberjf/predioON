import { useEffect, useId, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from "react";
import { Bell, LogOut, Menu, Search, MapPin, X } from "lucide-react";
import { Brand } from "./primitives.js";
import { VerificationDialog } from "./verification-dialog.js";
import { cls } from "../format.js";

/** `group` names the section a destination is listed under; consecutive items of a group share one heading. */
export type NavigationItem = { to: string; label: string; icon: ComponentType<{ size?: number; className?: string }>; group?: string };
type Props = {
  children: ReactNode; title: string; subtitle: string; userName: string; role: string;
  links: NavigationItem[]; pathname: string; signOut: () => void;
  navigationFeedback?: ReactNode; navigationBusy?: boolean;
  renderLink: (to: string, children: ReactNode, className: string) => ReactNode;
};

export function DashboardFrame({ children, title, subtitle, userName, role, links, pathname, signOut, renderLink, navigationFeedback, navigationBusy = false }: Props) {
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const initials = userName.split(" ").filter(Boolean).slice(0, 2).map(part => part[0]).join("");
  const matches = links.filter(link => link.label.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")));

  // Also close on navigation that did not originate from a menu link.
  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menuOpen || !menu) return;
    // Both portal themes use Tailwind's default lg breakpoint.
    const desktop = window.matchMedia("(min-width: 1024px)");
    if (desktop.matches) {
      setMenuOpen(false);
      return;
    }
    const opener = openerRef.current;
    const previous = document.body.style.overflow;
    const onDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMenuOpen(false);
    };
    // Native modality makes all other page content inert, including the skip link.
    menu.showModal();
    closeRef.current?.focus();
    document.body.style.overflow = "hidden";
    desktop.addEventListener("change", onDesktop);
    return () => {
      desktop.removeEventListener("change", onDesktop);
      if (menu.open) menu.close();
      document.body.style.overflow = previous;
      // The mobile opener is hidden on desktop; leave focus in visible content.
      const target = opener?.isConnected && opener.getClientRects().length ? opener : mainRef.current;
      target?.focus({ preventScroll: true });
    };
  }, [menuOpen]);

  const confineMenuFocus = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]',
    )).filter(item => item.tabIndex >= 0 && !item.matches(":disabled") && item.getClientRects().length);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const nav = () => links.map(({ to, label, icon: Icon, group }, index) => <div key={to}>
    {group && group !== links[index - 1]?.group && <p className={cls("px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400/80", index ? "pt-5" : "pt-1")}>{group}</p>}
    {renderLink(to, <><span className={cls("absolute inset-y-2 left-0 w-[3px] rounded-full", pathname === to ? "bg-emerald-400" : "bg-transparent")}/><Icon size={18} className="shrink-0"/><span className="min-w-0 whitespace-normal leading-5">{label}</span></>, cls("relative flex min-h-10 items-center gap-3 rounded-lg py-2 pl-4 pr-3 text-[13px] transition", pathname === to ? "bg-white/[0.08] font-semibold text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"))}
  </div>);

  // Mesma coluna escura serve à barra fixa do desktop e ao painel deslizante do celular.
  const sidebar = (onClose?: () => void) => <>
    <div className="flex shrink-0 items-start justify-between px-5 pb-5 pt-5">
      <Brand dark/>
      {onClose && <button ref={closeRef} aria-label="Fechar menu" onClick={onClose} className="-mr-1 rounded-md p-2 text-slate-300 hover:bg-white/10"><X size={20}/></button>}
    </div>
    <nav aria-label="Menu principal" aria-busy={navigationBusy} tabIndex={-1} className="min-h-0 flex-1 outline-none space-y-0.5 overflow-y-auto px-3 pb-4 [scrollbar-width:thin]" onClick={event => {
      if (event.target instanceof Element && event.target.closest("a[href]")) onClose?.();
    }}>{navigationFeedback ?? nav()}</nav>
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/10 bg-white/[0.03] px-5 py-3.5">
      {/* The signed-in person is named once, in the top bar. */}
      <div className="min-w-0"><p className="text-xs font-semibold text-white">Prédio ON</p><p className="mt-0.5 text-[11px] text-slate-400">Seu prédio conectado</p></div>
      <button aria-label="Sair da conta" title="Sair da conta" onClick={signOut} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white"><LogOut size={15}/>Sair</button>
    </div>
  </>;

  return <div className="min-h-screen bg-[#eef5f9]">
    <a href="#conteudo" className="sr-only z-50 bg-white p-3 text-emerald-700 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Pular para o conteúdo</a>

    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-[#0c202e] lg:flex">{sidebar()}</aside>

    {menuOpen && <dialog
      ref={menuRef}
      id={menuId}
      aria-modal="true"
      aria-label="Menu principal"
      onCancel={event => { event.preventDefault(); setMenuOpen(false); }}
      onKeyDown={confineMenuFocus}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-transparent"
    >
      <div className="absolute inset-0 bg-slate-900/60" onClick={() => setMenuOpen(false)} aria-hidden="true"/>
      <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-[#0c202e] shadow-2xl">
        {sidebar(() => setMenuOpen(false))}
      </div>
    </dialog>}

    <div className="lg:pl-60">
      <header className="relative z-20 border-b border-slate-200/70 bg-white">
        <div className="flex min-h-[72px] items-center justify-between gap-4 px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button ref={openerRef} aria-label="Abrir menu" aria-haspopup="dialog" aria-controls={menuOpen ? menuId : undefined} aria-expanded={menuOpen} onClick={() => setMenuOpen(true)} className="-ml-1 rounded-lg p-2 text-[#183a58] hover:bg-slate-100 lg:hidden"><Menu size={22}/></button>
            <div className="min-w-0">
              <div className="lg:hidden"><Brand compact/></div>
              <p className="hidden truncate text-[17px] font-bold tracking-tight text-[#142f50] lg:block">{title}</p>
              <p className="mt-1 hidden items-center gap-1.5 text-xs text-slate-500 lg:flex"><MapPin size={14}/>{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 md:gap-5">
            <div role="search" className="relative hidden w-48 xl:block">
              <Search size={15} className="pointer-events-none absolute left-3 top-3 text-slate-400"/>
              <input aria-label="Buscar no sistema" placeholder="Buscar no sistema..." value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setSearch(""); }} className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2.5 pl-9 pr-3 text-xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100"/>
              {search.trim() && <div className="absolute right-0 top-11 w-60 rounded-lg border border-slate-200 bg-white p-2 shadow-lg" onClick={() => setSearch("")}>{matches.length ? matches.map(item => <div key={item.to}>{renderLink(item.to, item.label, "block rounded-md p-2 text-sm text-slate-700 hover:bg-emerald-50")}</div>) : <p className="p-2 text-xs text-slate-500">Nenhuma página encontrada.</p>}</div>}
            </div>
            {renderLink("/alertas", <><Bell size={22}/><span className="sr-only">Ver alertas</span></>, "rounded-lg p-2 text-[#183a58] hover:bg-slate-100")}
            <div className="flex items-center gap-2.5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1b3f60] text-sm font-semibold text-white">{initials}</span><div className="hidden sm:block"><p className="max-w-36 truncate text-xs font-semibold text-[#18304e]">{userName}</p><p className="mt-1 text-[11px] text-slate-500">{role}</p></div></div>
          </div>
        </div>
        <p className="border-t border-slate-200/70 px-4 py-2.5 text-[13px] font-semibold text-[#142f50] lg:hidden">{title}</p>
      </header>
      <main ref={mainRef} id="conteudo" tabIndex={-1} className="mx-auto max-w-[1680px] space-y-4 p-4 outline-none md:space-y-5 md:p-6">{children}</main>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 bg-white px-6 py-5 text-[11px] text-slate-500"><div><strong className="text-[#18304e]">Prédio ON</strong><p className="mt-1">Tecnologia a serviço do seu condomínio.</p></div><span>{role} · Seu prédio, sempre conectado.</span></footer>
    </div>
    <VerificationDialog />
  </div>;
}

export function ProgressRing({ value, label, color = "#13ac70" }: { value: number | null; label: string; color?: string }) {
  const percentage = value === null ? 0 : Math.min(100, Math.max(0, value));
  return <div role="img" aria-label={`${label}: ${value === null ? "sem dados" : `${Math.round(percentage)}%`}`} className="relative h-28 w-28 shrink-0">
    <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90"><circle cx="60" cy="60" r="48" fill="none" stroke="#e8eef1" strokeWidth="11"/><circle cx="60" cy="60" r="48" fill="none" stroke={color} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${percentage * 3.016} 301.6`}/></svg>
    <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-[#162f4e]">{value === null ? "—" : `${Math.round(percentage)}%`}</span>
  </div>;
}
