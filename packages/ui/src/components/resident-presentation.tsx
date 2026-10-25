import { ArrowRight, Bell, CalendarDays, Check, ChevronDown, ClipboardList, DoorOpen, Droplets, House, LockKeyhole, MessageCircle, Wallet } from "lucide-react";
import { Brand } from "./primitives.js";

const RESIDENT_RESOURCES = [
  { icon: Bell, title: "Avisos que fazem parte do seu dia", text: "Fique por dentro dos comunicados, reuniões, serviços e eventos publicados pelo condomínio.", color: "bg-amber-50 text-amber-800" },
  { icon: CalendarDays, title: "Seu próximo encontro começa na reserva", text: "Consulte as áreas comuns, solicite uma reserva e acompanhe a situação do seu pedido.", color: "bg-sky-50 text-sky-800" },
  { icon: MessageCircle, title: "Seus chamados, com acompanhamento", text: "Conte o que aconteceu, receba respostas da gestão e acompanhe o histórico do seu próprio chamado.", color: "bg-violet-50 text-violet-800" },
  { icon: Wallet, title: "Contas do condomínio com clareza", text: "Consulte as prestações de contas publicadas, com receitas, despesas, saldo e comprovantes disponíveis.", color: "bg-emerald-50 text-emerald-800" },
  { icon: DoorOpen, title: "Acessos quando você tem permissão", text: "Quando liberado pelo condomínio, solicite a abertura de acessos e acompanhe a confirmação do equipamento.", color: "bg-rose-50 text-rose-800" },
  { icon: Droplets, title: "Consumo compartilhado com você", text: "Quando a gestão disponibilizar, consulte as informações de consumo publicadas para os moradores.", color: "bg-cyan-50 text-cyan-800" },
];

/** An illustration of existing resident features, never live condominium data. */
function ResidentExperience() {
  return <figure className="mx-auto w-full max-w-[350px]">
    <div className="rounded-[38px] border-[9px] border-[#183b49] bg-[#f4f8f6] p-4 shadow-2xl shadow-[#183b49]/15 sm:p-5">
      <div aria-hidden="true" className="mx-auto mb-6 h-1.5 w-16 rounded-full bg-[#183b49]/20" />
      <div className="flex items-center justify-between gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-800 text-white" aria-hidden="true"><House size={23} /></span><span className="rounded-full bg-white px-3 py-1.5 text-[10px] font-semibold text-emerald-900">Portal do morador</span></div>
      <p className="mt-5 text-xs text-slate-600">Bom dia, morador</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-[#173849]">Sua rotina por aqui.</p>
      <div className="mt-5 space-y-3">
        <div className="rounded-2xl border border-[#e3ebe4] bg-white p-4"><p className="flex items-center gap-2 text-[11px] font-semibold text-amber-800"><Bell size={15} aria-hidden="true" />Avisos do condomínio</p><p className="mt-3 text-sm font-semibold text-[#173849]">Reunião de moradores</p><p className="mt-1 text-[11px] leading-5 text-slate-600">Confira o comunicado e participe.</p></div>
        <div className="rounded-2xl border border-[#e3ebe4] bg-white p-4"><div className="flex items-center gap-2 text-[11px] font-semibold text-sky-800"><CalendarDays size={15} aria-hidden="true" />Minhas reservas</div><p className="mt-3 text-sm font-semibold text-[#173849]">Salão de festas</p><p className="mt-2 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-900">Solicitação em análise</p></div>
        <div className="flex items-center gap-3 rounded-2xl bg-emerald-800 p-4 text-white"><ClipboardList size={22} className="shrink-0" aria-hidden="true" /><div><p className="text-xs font-semibold">Seus chamados</p><p className="mt-1 text-[11px] leading-5 text-emerald-50">Cada resposta no mesmo histórico.</p></div></div>
      </div>
      <div aria-hidden="true" className="mx-auto mt-5 h-1 w-20 rounded-full bg-[#183b49]/20" />
    </div>
    <figcaption className="mt-4 text-center text-xs text-slate-600">Exemplo ilustrativo</figcaption>
  </figure>;
}

/** Public resident presentation; management content belongs to PlatformPresentation. */
export function ResidentPresentation() {
  return <div className="min-h-screen bg-[#fbfaf7] text-[#173849]">
    <a href="#apresentacao" className="sr-only z-50 rounded-lg bg-white p-3 text-emerald-800 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Pular para o conteúdo</a>
    <header className="bg-[#102d3a] text-white"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-5 sm:px-8"><a href="/" aria-label="Prédio ON — início"><Brand dark compact /></a><a href="/login" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/25 px-4 text-sm font-semibold transition hover:bg-white/10">Login<ArrowRight size={16} aria-hidden="true" /></a></div></header>

    <main id="apresentacao">
      <section className="overflow-hidden bg-[#edf5ef]">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-12 pt-10 sm:px-8 sm:py-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20 lg:py-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-emerald-800/15 bg-white/70 px-3 py-2 text-[11px] font-semibold text-emerald-900"><House size={15} aria-hidden="true" />Prédio ON para moradores</p>
            <h1 className="mt-6 max-w-xl text-[40px] font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[60px]">Seu condomínio <span className="text-emerald-800">mais perto de você.</span></h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-slate-600">Um aviso importante, a reserva do fim de semana, aquele pedido para a gestão. Tenha a rotina do condomínio reunida em um lugar feito para quem mora.</p>
            <div className="mt-8 flex flex-wrap gap-3"><a href="/login" className="inline-flex min-h-12 items-center gap-3 rounded-xl bg-emerald-800 px-5 text-sm font-semibold text-white transition hover:bg-emerald-900">Entrar no portal<ArrowRight size={17} aria-hidden="true" /></a><a href="#recursos" className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-emerald-900/20 bg-white/50 px-5 text-sm font-semibold text-emerald-900 transition hover:bg-white">Explorar recursos<ChevronDown size={17} aria-hidden="true" /></a></div>
            <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-slate-600"><LockKeyhole size={16} className="mt-0.5 shrink-0 text-emerald-800" aria-hidden="true" />Seu acesso, seus pedidos e as informações que o condomínio disponibiliza para você.</p>
          </div>
          <ResidentExperience />
        </div>
      </section>

      <section id="recursos" className="mx-auto max-w-6xl scroll-mt-6 px-5 py-14 sm:px-8 sm:py-20">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-800">Feito para quem mora</p><h2 className="mt-3 max-w-xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Mais praticidade para viver o condomínio.</h2><p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">Encontre as informações do seu dia e acompanhe o que precisa de atenção, sem perder o histórico.</p>
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{RESIDENT_RESOURCES.map(({ icon: Icon, title, text, color }) => <article key={title} className="rounded-2xl border border-[#e3e9e1] bg-white p-6"><span className={`inline-flex rounded-xl p-3 ${color}`}><Icon size={24} aria-hidden="true" /></span><h3 className="mt-5 text-lg font-semibold leading-6">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{text}</p></article>)}</div>
        <p className="mt-5 text-xs leading-6 text-slate-600">Cada condomínio define os recursos disponíveis. Consultas, reservas e acessos seguem a configuração e as suas permissões.</p>
      </section>

      <section className="border-y border-[#e3e9e1] bg-white"><div className="mx-auto grid max-w-6xl gap-9 px-5 py-14 sm:px-8 sm:py-16 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16"><div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-800">Simples de começar</p><h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight">Do primeiro acesso ao acompanhamento.</h2><p className="mt-4 text-sm leading-7 text-slate-600">Entre com sua conta ou aceite o convite enviado pela administração do condomínio.</p></div><ol className="grid gap-6 sm:grid-cols-3">{[
        { title: "Entre", text: "Use sua conta. Se recebeu um convite, tenha o código em mãos para ativar o acesso." },
        { title: "Escolha", text: "Leia um aviso, solicite uma reserva ou abra seu chamado com os detalhes do que aconteceu." },
        { title: "Acompanhe", text: "Consulte as respostas, a situação da reserva e o histórico dos seus próprios pedidos." },
      ].map((step, index) => <li key={step.title}><span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#edf5ef] text-sm font-bold text-emerald-900" aria-hidden="true">{index + 1}</span><h3 className="mt-4 text-lg font-semibold">{step.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{step.text}</p></li>)}</ol></div></section>

      <section className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20"><div className="grid gap-8 rounded-[28px] bg-[#173d49] p-6 text-white sm:p-10 lg:grid-cols-[1.2fr_0.8fr]"><div><span className="inline-flex items-center gap-2 text-xs font-medium text-emerald-200"><Check size={16} aria-hidden="true" />Seu espaço no condomínio</span><h2 className="mt-4 text-3xl font-semibold leading-tight tracking-tight">Menos desencontros.<br />Mais tempo para o seu dia.</h2><p className="mt-5 max-w-lg text-sm leading-7 text-slate-200">Seus chamados são acompanhados por você e pela gestão responsável. Avisos e contas aparecem conforme o que foi publicado para os moradores.</p></div><div className="flex flex-col justify-center gap-3"><a href="/login" className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-emerald-200 px-5 text-sm font-bold text-[#173d49] transition hover:bg-emerald-100">Já tenho acesso<ArrowRight size={17} aria-hidden="true" /></a><a href="/convite" className="flex min-h-12 items-center justify-center rounded-xl border border-white/30 px-5 text-sm font-semibold transition hover:bg-white/10">Recebi um convite</a><p className="mt-1 text-xs leading-6 text-slate-200">Ainda não recebeu acesso? Procure a administração do seu condomínio.</p></div></div></section>
    </main>

    <footer className="border-t border-[#e3e9e1] bg-white"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-7 text-xs text-slate-600 sm:px-8"><p><strong className="text-[#173849]">Prédio ON · Moradores</strong><span className="mt-1 block">Seu condomínio. Sua rotina, mais simples.</span></p><a href="/" className="min-h-11 py-3 font-semibold text-emerald-800 hover:underline">Voltar ao início</a></div></footer>
  </div>;
}
