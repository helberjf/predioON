import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  Cpu,
  Droplets,
  LayoutDashboard,
  LogOut,
  Megaphone,
  SlidersHorizontal,
  Wrench,
  Zap,
} from "lucide-react";
import { cls, useAuth } from "@predioon/ui";

const LINKS = [
  { to: "/", label: "Painel", icon: LayoutDashboard },
  { to: "/agua", label: "Água", icon: Droplets },
  { to: "/energia", label: "Energia", icon: Zap },
  { to: "/dispositivos", label: "Dispositivos", icon: Cpu },
  { to: "/alertas", label: "Alertas", icon: AlertTriangle },
  { to: "/regras", label: "Regras", icon: SlidersHorizontal },
  { to: "/chamados", label: "Chamados", icon: Wrench },
  { to: "/avisos", label: "Avisos", icon: Megaphone },
  { to: "/areas", label: "Áreas comuns", icon: CalendarDays },
];

export function Shell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-slate-100">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-slate-200 bg-white p-4 lg:flex">
        <div className="flex items-center gap-2 px-2 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <Building2 size={18} />
          </span>
          <div>
            <p className="text-sm font-bold text-slate-900">Prédio ON</p>
            <p className="text-[11px] text-slate-500">Operação</p>
          </div>
        </div>

        <nav className="mt-6 flex-1 space-y-1">
          {LINKS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cls(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                  isActive ? "bg-emerald-50 font-semibold text-emerald-700" : "text-slate-600 hover:bg-slate-50",
                )
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={() => void signOut()}
          className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-slate-500 hover:bg-slate-50"
        >
          <LogOut size={17} />
          Sair
        </button>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">{user?.name}</p>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">Administração do prédio</span>
          </div>
          <nav className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {LINKS.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cls(
                    "whitespace-nowrap rounded-lg px-3 py-1.5 text-xs",
                    isActive ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600",
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="mx-auto max-w-[1400px] space-y-5 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
