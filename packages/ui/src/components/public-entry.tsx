import { ArrowRight, Check, Droplets, ShieldCheck } from "lucide-react";
import { buildingImage } from "../assets.js";
import { LoginScreen } from "./login.js";
import { Brand } from "./primitives.js";

/** Desktop keeps the familiar form; mobile gets a clear choice before signing in. */
export function PublicEntry({ subtitle, invitationHref }: { subtitle: string; invitationHref?: string }) {
  if (window.location.pathname !== "/") return <LoginScreen subtitle={subtitle} invitationHref={invitationHref} />;
  return <>
    <div className="lg:hidden"><WelcomeScreen subtitle={subtitle} /></div>
    <div className="hidden lg:block"><LoginScreen subtitle={subtitle} invitationHref={invitationHref} /></div>
  </>;
}

function WelcomeScreen({ subtitle }: { subtitle: string }) {
  return <main className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-[#0c202e] px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-7 text-white">
    <img src={buildingImage} alt="" className="pointer-events-none absolute inset-x-0 top-0 -z-20 h-[62%] w-full object-cover object-[center_45%] opacity-45" />
    <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-[#0c202e]/50 via-[#0c202e]/85 to-[#0c202e]" />
    <header className="flex items-center justify-between gap-3"><Brand dark compact /><span className="rounded-full border border-white/15 bg-white/5 p-2 text-emerald-300" aria-hidden="true"><ShieldCheck size={21} /></span></header>
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-9">
      <p className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Seu prédio, sempre conectado</p>
      <h1 className="max-w-[340px] text-[35px] font-semibold leading-[1.15] tracking-tight">Seu imóvel acompanhado. <span className="text-emerald-300">Sua rotina organizada.</span></h1>
      <p className="mt-5 max-w-sm text-sm leading-6 text-slate-200">Mais clareza para cuidar do condomínio. Mais praticidade para quem mora.</p>
      <div className="mt-7 grid grid-cols-2 gap-3" aria-label="O que a plataforma reúne">
        <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4"><Droplets size={22} className="text-sky-300" aria-hidden="true" /><p className="mt-3 text-xs font-semibold">Água e energia</p><p className="mt-1 text-[11px] leading-5 text-slate-300">Monitoramento e alertas</p></div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4"><Check size={22} className="text-emerald-300" aria-hidden="true" /><p className="mt-3 text-xs font-semibold">Rotina organizada</p><p className="mt-1 text-[11px] leading-5 text-slate-300">Avisos, reservas e chamados</p></div>
      </div>
      <nav aria-label="Acesso à plataforma" className="mt-8 space-y-3">
        <a href="/login" className="flex min-h-14 items-center justify-between rounded-xl bg-emerald-300 px-5 text-sm font-bold text-[#0c202e] transition hover:bg-emerald-200">Login<ArrowRight size={19} aria-hidden="true" /></a>
        <a href="/conheca" className="flex min-h-14 items-center justify-center rounded-xl border border-white/25 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10">Conheça a plataforma</a>
      </nav>
    </div>
    <footer className="text-center"><p className="text-xs font-medium text-slate-200">{subtitle}</p><p className="mt-2 text-[10px] text-slate-400">Tecnologia a serviço do seu condomínio.</p></footer>
  </main>;
}
