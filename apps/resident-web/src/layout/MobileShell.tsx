import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { CalendarDays, Home, Megaphone, User, Wrench } from "lucide-react";
import { Brand, cls, useAuth } from "@predioon/ui";

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
      <header className="bg-[#111c2e] px-5 pb-8 pt-7 text-white">
        <Brand dark />
        <h1 className="mt-7 text-2xl font-bold">Olá, {user?.name.split(" ")[0]}!</h1>
        <p className="mt-2 text-sm text-slate-300">Seu condomínio mais fácil, todos os dias.</p>
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
