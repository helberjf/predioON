import type { FormEvent, ReactNode } from "react";
import { Building2, CalendarCheck, ShieldCheck, Waves } from "lucide-react";
import { buildingImage } from "../assets.js";
import { Brand } from "./primitives.js";

const HIGHLIGHTS = [
  { icon: Waves, text: "Água, energia e equipamentos acompanhados em tempo real" },
  { icon: CalendarCheck, text: "Reservas, avisos e ocorrências em um só lugar" },
  { icon: ShieldCheck, text: "Acesso protegido, com verificação em duas etapas" },
];

/**
 * Frame of every screen shown before a session exists: sign-in, password
 * recovery and invitation. Wide screens get the brand panel beside the form.
 */
export function AuthLayout({ title, subtitle, label, onSubmit, children }: {
  title: string; subtitle: string; label?: string; onSubmit: (event: FormEvent) => void; children: ReactNode;
}) {
  return (
    <main className="grid min-h-screen bg-[#f1f6f9] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <div className="relative isolate hidden overflow-hidden bg-[#0c202e] p-12 text-white lg:flex lg:flex-col lg:justify-between" aria-hidden="true">
        <img src={buildingImage} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[#0a2740]/95 via-[#0c2f4d]/80 to-[#0c202e]/60" />
        <Brand dark />
        <div className="max-w-md">
          <p className="text-[34px] font-bold leading-tight tracking-tight">Seu condomínio<br />mais fácil.</p>
          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => <li key={text} className="flex items-center gap-3 text-[15px] text-slate-100">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-emerald-300"><Icon size={20} /></span>{text}
            </li>)}
          </ul>
        </div>
        <p className="text-xs text-slate-300">Prédio ON · Seu prédio, sempre conectado</p>
      </div>

      <div className="flex items-center justify-center px-4 py-10">
        <form onSubmit={onSubmit} aria-label={label} className="w-full max-w-sm space-y-5 rounded-3xl border border-slate-200/70 bg-white p-7 shadow-[0_12px_40px_rgba(15,40,70,0.08)] sm:p-8">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/25">
              <Building2 size={28} />
            </div>
            <h1 className="mt-4 text-[22px] font-bold tracking-tight text-[#142f50]">{title}</h1>
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          </div>
          {children}
        </form>
      </div>
    </main>
  );
}

/** Secondary destinations under an authentication form. */
export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} className="block rounded-lg py-1 text-center text-sm font-medium text-emerald-700 hover:underline">{children}</a>;
}
