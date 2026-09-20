import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { CalendarDays, Home, Megaphone, User, Wrench } from "lucide-react";
import { cls, useAuth } from "@predioon/ui";

const TABS = [
  { to: "/", label: "Início", icon: Home },
  { to: "/avisos", label: "Avisos", icon: Megaphone },
  { to: "/chamados", label: "Chamados", icon: Wrench },
  { to: "/reservas", label: "Reservas", icon: CalendarDays },
  { to: "/perfil", label: "Perfil", icon: User },
];

export function MobileShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  return (
    <div className="mx-auto min-h-screen max-w-md bg-slate-50 pb-20">
      <header className="sticky top-0 z-10 bg-gradient-to-br from-emerald-600 to-emerald-700 px-5 pb-6 pt-7 text-white">
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-100">Prédio ON</p>
        <h1 className="mt-1 text-xl font-bold">Olá, {user?.name.split(" ")[0]}</h1>
        <p className="mt-0.5 text-sm text-emerald-100">Seu condomínio mais fácil</p>
      </header>

      <main className="space-y-4 p-4">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 mx-auto flex max-w-md justify-around border-t border-slate-200 bg-white py-2">
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cls("flex flex-1 flex-col items-center gap-1 py-1 text-[11px]", isActive ? "text-emerald-600" : "text-slate-400")
            }
          >
            <Icon size={20} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
