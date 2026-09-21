import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, Building2, Cpu, House, RadioTower, ScrollText, ShieldCheck, Users } from "lucide-react";
import { DashboardFrame, useAuth } from "@predioon/ui";
const LINKS = [
  { to: "/", label: "Dashboard", icon: House },
  { to: "/predios", label: "Condomínios", icon: Building2 },
  { to: "/clientes", label: "Clientes", icon: ShieldCheck },
  { to: "/gateways", label: "Comunicação", icon: RadioTower },
  { to: "/dispositivos", label: "Equipamentos", icon: Cpu },
  { to: "/alertas", label: "Alertas", icon: AlertTriangle },
  { to: "/usuarios", label: "Usuários", icon: Users },
  { to: "/auditoria", label: "Histórico de atividades", icon: ScrollText },
];
export function Shell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  return <DashboardFrame title="Central de gestão Prédio ON" subtitle="Todos os seus condomínios em um só lugar" userName={user?.name ?? ""} role="Administrador" links={LINKS} pathname={location.pathname} signOut={() => void signOut()} renderLink={(to, content, className) => <Link to={to} className={className}>{content}</Link>}>{children}</DashboardFrame>;
}
