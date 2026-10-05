import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, Building2, ChartNoAxesCombined, Cpu, House, Monitor, RadioTower, ScrollText, ShieldCheck, Users } from "lucide-react";
import { DashboardFrame, useFeatures, useAuth } from "@predioon/ui";
import { organizationRouteAllowed, useOrganizationAccess } from "../organization-access.js";
const LINKS = [
  { to: "/", label: "Dashboard", icon: House },
  { to: "/predios", label: "Condomínios", icon: Building2 },
  { to: "/clientes", label: "Clientes", icon: ShieldCheck },
  { to: "/gateways", label: "Comunicação", icon: RadioTower },
  { to: "/dispositivos", label: "Equipamentos", icon: Cpu },
  { to: "/operacao", label: "Operação dos imóveis", icon: ChartNoAxesCombined },
  { to: "/suporte-remoto", label: "Suporte remoto", icon: Monitor },
  { to: "/alertas", label: "Alertas", icon: AlertTriangle },
  { to: "/usuarios", label: "Usuários", icon: Users },
  { to: "/unidades-equipes", label: "Unidades e equipes", icon: Building2 },
  { to: "/funcionalidades", label: "Funcionalidades", icon: ShieldCheck },
  { to: "/auditoria", label: "Histórico de atividades", icon: ScrollText },
  { to: "/sessoes", label: "Minhas sessões", icon: Monitor },
];
export function Shell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const flags = useFeatures();
  const access = useOrganizationAccess();
  const legacy = user?.role === "PLATFORM_ADMIN";
  const allowed = (path: string) => organizationRouteAllowed(path, legacy, access.canRead) && flags.routeAllowed(path);
  // Do not move a usable link between pointerdown and pointerup as Clients arrives.
  // Periodic checks retain a confirmed projection and therefore keep navigation stable.
  const navigationPending = access.capabilities === null && access.checking;
  const navigationFeedback = navigationPending ? <p role="status" className="min-h-64 px-3 py-4 text-sm text-slate-300">Carregando menu…</p> : undefined;
  return <DashboardFrame title="Central de gestão Prédio ON" subtitle={legacy ? "Todos os seus condomínios em um só lugar" : "Clientes e segurança da sua conta"} userName={user?.name ?? ""} role={legacy ? "Administrador" : access.canManage ? "Gestão de clientes" : "Consulta de clientes"} links={navigationPending ? [] : LINKS.filter(link => allowed(link.to))} navigationBusy={navigationPending} navigationFeedback={navigationFeedback} pathname={location.pathname} signOut={() => void signOut()} renderLink={(to, content, className) => allowed(to) ? <Link to={to} className={className}>{content}</Link> : null}>{children}</DashboardFrame>;
}
