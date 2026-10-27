import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, Building2, LifeBuoy, ChartNoAxesCombined, Cpu, FlaskConical, House, Monitor, RadioTower, ScrollText, ShieldCheck, Users } from "lucide-react";
import { DashboardFrame, useFeatures, useAuth } from "@predioon/ui";
import { organizationRouteAllowed, useOrganizationAccess } from "../organization-access.js";
import { useDemoAvailable } from "../pages/Demo.js";
// Order and grouping are what the menu shows; each group gets one heading.
const LINKS = [
  { group: "Visão geral", to: "/", label: "Dashboard", icon: House },
  { group: "Visão geral", to: "/alertas", label: "Alertas", icon: AlertTriangle },
  { group: "Carteira", to: "/predios", label: "Condomínios", icon: Building2 },
  { group: "Carteira", to: "/clientes", label: "Clientes", icon: ShieldCheck },
  { group: "Carteira", to: "/operacao", label: "Operação dos imóveis", icon: ChartNoAxesCombined },
  { group: "Infraestrutura", to: "/gateways", label: "Comunicação", icon: RadioTower },
  { group: "Infraestrutura", to: "/dispositivos", label: "Equipamentos", icon: Cpu },
  { group: "Infraestrutura", to: "/suporte-remoto", label: "Suporte remoto", icon: Monitor },
  { group: "Administração", to: "/usuarios", label: "Usuários", icon: Users },
  { group: "Administração", to: "/unidades-equipes", label: "Unidades e equipes", icon: Building2 },
  { group: "Administração", to: "/acesso-suporte", label: "Acesso de suporte", icon: LifeBuoy },
  { group: "Administração", to: "/funcionalidades", label: "Funcionalidades", icon: ShieldCheck },
  { group: "Administração", to: "/auditoria", label: "Histórico de atividades", icon: ScrollText },
  { group: "Administração", to: "/sessoes", label: "Minhas sessões", icon: Monitor },
  { group: "Administração", to: "/demonstracao", label: "Demonstração", icon: FlaskConical },
];
export function Shell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const flags = useFeatures();
  const access = useOrganizationAccess();
  const legacy = user?.role === "PLATFORM_ADMIN";
  const demo = useDemoAvailable();
  const allowed = (path: string) => (path !== "/demonstracao" || (legacy && demo)) && organizationRouteAllowed(path, legacy, access.canRead) && flags.routeAllowed(path);
  // Do not move a usable link between pointerdown and pointerup as Clients arrives.
  // Periodic checks retain a confirmed projection and therefore keep navigation stable.
  const navigationPending = access.capabilities === null && access.checking;
  const navigationFeedback = navigationPending ? <p role="status" className="min-h-64 px-3 py-4 text-sm text-slate-300">Carregando menu…</p> : undefined;
  return <DashboardFrame title="Central de gestão Prédio ON" subtitle={legacy ? "Todos os seus condomínios em um só lugar" : "Clientes e segurança da sua conta"} userName={user?.name ?? ""} role={legacy ? "Administrador" : access.canManage ? "Gestão de clientes" : "Consulta de clientes"} links={navigationPending ? [] : LINKS.filter(link => allowed(link.to))} navigationBusy={navigationPending} navigationFeedback={navigationFeedback} pathname={location.pathname} signOut={() => void signOut()} renderLink={(to, content, className) => allowed(to) ? <Link to={to} className={className}>{content}</Link> : null}>{children}</DashboardFrame>;
}
