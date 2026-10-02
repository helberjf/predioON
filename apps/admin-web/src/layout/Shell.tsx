import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, Building2, ChartNoAxesCombined, Cpu, House, Monitor, RadioTower, ScrollText, ShieldCheck, Users } from "lucide-react";
import { DashboardFrame, useFeatures, useAuth } from "@predioon/ui";
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
];
export function Shell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const flags = useFeatures();
  return <DashboardFrame title="Central de gestão Prédio ON" subtitle="Todos os seus condomínios em um só lugar" userName={user?.name ?? ""} role="Administrador" links={LINKS.filter(link => flags.routeAllowed(link.to))} pathname={location.pathname} signOut={() => void signOut()} renderLink={(to, content, className) => <Link to={to} className={className}>{content}</Link>}>{children}</DashboardFrame>;
}
