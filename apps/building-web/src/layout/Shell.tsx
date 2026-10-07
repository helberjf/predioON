import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, Boxes, CalendarDays, Car, ClipboardList, ChartNoAxesCombined, Cpu, DoorOpen, Droplets, House, Megaphone, Monitor, ScrollText, ShieldCheck, SlidersHorizontal, Workflow, Wrench, Zap } from "lucide-react";
import { BuildingSelector, DashboardFrame, useFeatures, useAuth, useBuildingScope, useResource } from "@predioon/ui";
// Order and grouping are what the menu shows; each group gets one heading.
const LINKS = [
  { group: "Visão geral", to: "/", label: "Início", icon: House },
  { group: "Visão geral", to: "/alertas", label: "Alertas", icon: AlertTriangle },
  { group: "Monitoramento", to: "/agua", label: "Água e reservatórios", icon: Droplets },
  { group: "Monitoramento", to: "/energia", label: "Energia e fases", icon: Zap },
  { group: "Monitoramento", to: "/consumo", label: "Consumo e análise", icon: ChartNoAxesCombined },
  { group: "Monitoramento", to: "/sensores", label: "Gás, fumaça e vazamentos", icon: ShieldCheck },
  { group: "Monitoramento", to: "/dispositivos", label: "Equipamentos", icon: Cpu },
  { group: "Acessos e vagas", to: "/acessos", label: "Portões e acessos", icon: DoorOpen },
  { group: "Acessos e vagas", to: "/vagas", label: "Vagas de carros e motos", icon: Car },
  { group: "Atendimento", to: "/chamados", label: "Ocorrências", icon: Wrench },
  { group: "Atendimento", to: "/ordens-servico", label: "Ordens de serviço", icon: ClipboardList },
  { group: "Atendimento", to: "/ativos", label: "Ativos", icon: Boxes },
  { group: "Comunidade", to: "/avisos", label: "Avisos", icon: Megaphone },
  { group: "Comunidade", to: "/areas", label: "Áreas comuns", icon: CalendarDays },
  { group: "Comunidade", to: "/transparencia", label: "Transparência e contas", icon: ChartNoAxesCombined },
  { group: "Administração", to: "/unidades-equipes", label: "Unidades e equipes", icon: House },
  { group: "Administração", to: "/regras", label: "Regras de alerta", icon: SlidersHorizontal },
  { group: "Administração", to: "/automacoes", label: "Automações", icon: Workflow },
  { group: "Administração", to: "/auditoria", label: "Histórico de atividades", icon: ScrollText },
  { group: "Administração", to: "/sessoes", label: "Minhas sessões", icon: Monitor },
];
export function Shell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const { buildingId } = useBuildingScope();
  const location = useLocation();
  const flags = useFeatures();
  const building = useResource<{ name: string; address: Record<string, unknown> }>(buildingId ? `/buildings/${encodeURIComponent(buildingId)}` : null);
  const address = building.data?.address;
  const addressText = address ? [address.street, address.number, address.city, address.state].filter(value => typeof value === "string" || typeof value === "number").join(" · ") : "";
  // Do not expose a partial menu that shifts while the first feature response
  // arrives during a pointer click. Background polling retains valid items.
  const navigationUnavailable = flags.loading || Boolean(flags.error);
  const navigationFeedback = flags.loading
    ? <p role="status" className="min-h-64 px-3 py-4 text-sm text-slate-300">Carregando menu…</p>
    : flags.error ? <div className="min-h-64 space-y-3 px-3 py-4 text-sm text-slate-300"><p role="alert">Não foi possível carregar o menu.</p><button onClick={flags.refresh} className="rounded-md border border-slate-500 px-3 py-2 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400">Atualizar menu</button></div> : undefined;
  return <DashboardFrame title={building.data?.name ?? "Painel do condomínio"} subtitle={addressText || "Gestão inteligente do seu condomínio"} userName={user?.name ?? ""} role="Operação" links={navigationUnavailable ? [] : LINKS.filter(link => flags.routeAllowed(link.to))} navigationFeedback={navigationFeedback} navigationBusy={flags.loading} pathname={location.pathname} signOut={() => void signOut()} renderLink={(to, content, className) => <Link to={to} className={className}>{content}</Link>}><BuildingSelector />{children}</DashboardFrame>;
}
