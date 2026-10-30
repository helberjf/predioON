import { ArrowRight, BellRing, CalendarDays, Car, Check, ChevronDown, ClipboardList, Droplets, Leaf, ShieldCheck, TrendingUp, Wallet, Zap } from "lucide-react";
import { buildingImage } from "../assets.js";
import { Brand } from "./primitives.js";

const RESOURCES = [
  { icon: Droplets, title: "Água sob controle", text: "Acompanhe reservatórios, consumo e sinais de vazamento. Tenha histórico para entender o que mudou.", color: "bg-sky-50 text-sky-700" },
  { icon: Zap, title: "Energia sem surpresas", text: "Veja consumo, custo estimado e parâmetros elétricos. Identifique aumentos fora do padrão para investigar mais cedo.", color: "bg-amber-50 text-amber-800" },
  { icon: ClipboardList, title: "Chamados com acompanhamento", text: "Receba ocorrências, organize prioridades e registre respostas e soluções. Cada morador acompanha seu próprio protocolo.", color: "bg-violet-50 text-violet-700" },
  { icon: CalendarDays, title: "Avisos e reservas", text: "Organize reuniões, limpeza e coleta de lixo. Publique comunicados e acompanhe as reservas das áreas comuns.", color: "bg-teal-50 text-teal-700" },
  { icon: Wallet, title: "Gestão transparente", text: "Compartilhe decisões e serviços. Publique receitas, despesas, saldo e links de comprovantes nas contas do mês.", color: "bg-emerald-50 text-emerald-700" },
  { icon: Car, title: "Acessos e vagas", text: "Consulte vagas de carros e motos separadamente. Solicite abertura de acessos quando a instalação e as permissões permitirem.", color: "bg-rose-50 text-rose-700" },
];

const STEPS = [
  { number: "01", title: "Acompanhe", text: "Reúna as informações do imóvel e a última comunicação dos equipamentos no mesmo painel." },
  { number: "02", title: "Priorize", text: "Veja alertas e chamados, organize o atendimento e registre o que está sendo feito." },
  { number: "03", title: "Dê visibilidade", text: "Mostre aos moradores os avisos, o andamento dos serviços e as contas publicadas." },
];

const PEOPLE = [
  { title: "Síndico e equipe", text: "Informação para organizar prioridades, serviços e decisões." },
  { title: "Moradores", text: "Avisos, reservas e acompanhamento dos próprios chamados." },
];

const ADMINISTRATION = { title: "Administração", text: "Visão dos imóveis, equipamentos e recursos de cada instalação." };

/** Public copy based on docs/marketing/APRESENTACAO_COMERCIAL.md; no live tenant data. */
export function PlatformPresentation({ includeAdministration = false }: { includeAdministration?: boolean }) {
  const people = includeAdministration ? [...PEOPLE, ADMINISTRATION] : PEOPLE;
  return <div className="min-h-screen bg-[#f7faf9] text-[#142f45]">
    <a href="#apresentacao" className="sr-only z-50 rounded-lg bg-white p-3 text-emerald-800 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Pular para o conteúdo</a>
    <header className="bg-[#0c202e] text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <a href="/" aria-label="Prédio ON — início"><Brand dark compact /></a>
        <a href="/login" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/25 px-5 text-sm font-semibold transition hover:bg-white/10">Login<ArrowRight size={16} aria-hidden="true" /></a>
      </div>
    </header>

    <main id="apresentacao">
      <section className="overflow-hidden bg-[#eaf3f0]">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-14 pt-12 sm:px-8 sm:py-16 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:py-20">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-800">Prédio ON · Gestão conectada</p>
            <h1 className="mt-5 max-w-xl text-[37px] font-semibold leading-[1.12] tracking-tight sm:text-5xl lg:text-[52px]">Mais clareza na gestão. <span className="text-emerald-800">Mais tranquilidade para morar.</span></h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-slate-600">Seu imóvel acompanhado. Sua rotina organizada. Monitoramento, alertas e serviços reunidos para você cuidar melhor de cada detalhe do condomínio.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="/login" className="inline-flex min-h-12 items-center gap-3 rounded-xl bg-emerald-800 px-5 text-sm font-semibold text-white shadow-lg shadow-emerald-900/10 transition hover:bg-emerald-900">Acessar minha conta<ArrowRight size={17} aria-hidden="true" /></a>
              <a href="#recursos" className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-emerald-900/20 px-5 text-sm font-semibold text-emerald-900 transition hover:bg-white/60">Explorar recursos<ChevronDown size={17} aria-hidden="true" /></a>
            </div>
            <p className="mt-6 flex items-center gap-2 text-xs leading-5 text-slate-600"><ShieldCheck size={16} className="shrink-0 text-emerald-800" aria-hidden="true" />Cada pessoa vê o que suas permissões permitem.</p>
          </div>

          <div className="relative rounded-[28px] bg-[#102c3c] p-4 shadow-xl shadow-[#102c3c]/15 sm:p-5">
            <div className="flex items-center justify-between gap-2 px-1 pb-4 text-white"><span className="text-xs font-semibold">Um olhar para o condomínio</span><span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] text-emerald-200">Visão ilustrativa</span></div>
            <div className="relative h-56 overflow-hidden rounded-2xl sm:h-64">
              <img src={buildingImage} alt="" className="h-full w-full object-cover object-[center_55%]" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#09202f] via-transparent to-transparent" />
              <div className="absolute bottom-4 left-4 right-4 text-white"><p className="text-[10px] uppercase tracking-[0.16em] text-emerald-200">Mais informação, melhores decisões</p><p className="mt-2 text-xl font-semibold">Seu prédio, sempre conectado.</p></div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white p-4"><Droplets size={21} className="text-sky-700" aria-hidden="true" /><p className="mt-3 text-xs font-semibold">Água e energia</p><p className="mt-1 text-[11px] leading-5 text-slate-600">Leituras e histórico</p></div>
              <div className="rounded-2xl bg-white p-4"><BellRing size={21} className="text-emerald-800" aria-hidden="true" /><p className="mt-3 text-xs font-semibold">Alertas e chamados</p><p className="mt-1 text-[11px] leading-5 text-slate-600">Ações e acompanhamento</p></div>
            </div>
          </div>
        </div>
      </section>

      <section id="recursos" className="mx-auto max-w-6xl scroll-mt-6 px-5 py-14 sm:px-8 sm:py-20">
        <div className="max-w-2xl"><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-800">Tudo conversa. Tudo se organiza.</p><h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Do reservatório à prestação de contas.</h2><p className="mt-4 text-sm leading-7 text-slate-600">Menos informações espalhadas. Mais contexto para cuidar do imóvel e da rotina de quem vive nele.</p></div>
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RESOURCES.map(({ icon: Icon, title, text, color }) => <article key={title} className="rounded-2xl border border-[#e2ebe6] bg-white p-6"><span className={`inline-flex rounded-xl p-3 ${color}`}><Icon size={24} aria-hidden="true" /></span><h3 className="mt-5 text-lg font-semibold">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{text}</p></article>)}
        </div>
        <p className="mt-5 text-xs leading-6 text-slate-600">Os recursos disponíveis dependem dos sensores, das integrações e da configuração de cada instalação.</p>
      </section>

      <section className="bg-[#102c3c] text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 sm:py-16 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div><span className="inline-flex rounded-full border border-emerald-200/25 px-3 py-1.5 text-[11px] font-medium text-emerald-200">Para quem cuida de tudo</span><h2 className="mt-5 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">O que muda na rotina do síndico</h2><p className="mt-5 text-sm leading-7 text-slate-200">Uma gestão bem informada ganha tempo para agir e mantém os moradores por dentro.</p><Leaf size={55} strokeWidth={1.3} className="mt-7 text-emerald-300" aria-hidden="true" /></div>
          <ol className="space-y-6">{STEPS.map(step => <li key={step.number} className="flex gap-5 border-b border-white/10 pb-6 last:border-0 last:pb-0"><span className="text-sm font-medium text-emerald-300">{step.number}</span><div><h3 className="text-xl font-semibold">{step.title}</h3><p className="mt-2 text-sm leading-6 text-slate-200">{step.text}</p></div></li>)}</ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl items-center gap-9 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-2 lg:gap-16">
        <div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-800">Perceber a mudança faz diferença</p><h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight">E se o consumo sair do habitual?</h2><p className="mt-5 text-sm leading-7 text-slate-600">Se o custo estimado de energia passa de R$ 10 para R$ 50 no dia, o painel pode sinalizar um aumento de 400%. Um alerta ajuda a equipe a investigar a mudança.</p><p className="mt-4 text-xs leading-6 text-slate-600">A estimativa depende de medição e tarifa configuradas. O alerta indica um desvio e não determina sozinho a causa do problema.</p></div>
        <div className="rounded-2xl border border-[#dce9df] bg-white p-6 sm:p-8"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-slate-600">Exemplo ilustrativo</p><h3 className="mt-2 text-lg font-semibold">Custo estimado de energia</h3></div><TrendingUp size={23} className="shrink-0 text-amber-800" aria-hidden="true" /></div><dl className="mt-7 space-y-5"><div className="relative"><dt className="pr-20 text-sm">Referência diária</dt><dd><span className="absolute right-0 top-0 text-sm font-semibold">R$ 10</span><div aria-hidden="true" className="mt-2 h-3 rounded-full bg-slate-100"><div className="h-full w-1/5 rounded-full bg-emerald-700" /></div></dd></div><div className="relative"><dt className="pr-20 text-sm">Valor observado</dt><dd><span className="absolute right-0 top-0 text-sm font-semibold">R$ 50</span><div aria-hidden="true" className="mt-2 h-3 rounded-full bg-amber-500" /></dd></div></dl><div className="mt-6 flex items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900"><span>Acima da referência</span><strong>+400%</strong></div></div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-14 sm:px-8 sm:pb-20">
        <div className="rounded-[28px] bg-[#e7f1eb] px-6 py-9 sm:p-10"><h2 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">Uma plataforma. Cada pessoa no seu lugar.</h2><div className={`mt-7 grid gap-6 ${includeAdministration ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>{people.map(item =><div key={item.title}><h3 className="flex items-center gap-2 text-sm font-semibold"><Check size={17} className="shrink-0 text-emerald-800" aria-hidden="true" />{item.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p></div>)}</div><a href="/login" className="mt-8 inline-flex min-h-12 items-center gap-3 rounded-xl bg-[#102c3c] px-5 text-sm font-semibold text-white transition hover:bg-[#194253]">Entrar na plataforma<ArrowRight size={17} aria-hidden="true" /></a></div>
      </section>
    </main>

    <footer className="border-t border-[#e2ebe6] bg-white"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-7 text-xs text-slate-600 sm:px-8"><p><strong className="text-[#142f45]">Prédio ON</strong><span className="mt-1 block">Seu imóvel acompanhado. Sua rotina organizada.</span></p><a href="/" className="min-h-11 py-3 font-semibold text-emerald-800 hover:underline">Voltar ao início</a></div></footer>
  </div>;
}
