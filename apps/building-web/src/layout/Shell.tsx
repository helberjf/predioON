import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, CalendarDays, Car, ChartNoAxesCombined, Cpu, DoorOpen, Droplets, House, Megaphone, ShieldCheck, SlidersHorizontal, Wrench, Zap } from "lucide-react";
import { BuildingSelector, DashboardFrame, useFeatures, useAuth, useBuildingScope, useResource } from "@predioon/ui";
const LINKS = [
  { to: "/", label: "Início", icon: House },
  { to: "/agua", label: "Água e reservatórios", icon: Droplets },
  { to: "/energia", label: "Energia e fases", icon: Zap },
  { to: "/consumo", label: "Consumo e análise", icon: ChartNoAxesCombined },
  { to: "/sensores", label: "Gás, fumaça e vazamentos", icon: ShieldCheck },
  { to: "/acessos", label: "Portões e acessos", icon: DoorOpen },
  { to: "/vagas", label: "Vagas de carros e motos", icon: Car },
  { to: "/alertas", label: "Alertas", icon: AlertTriangle },
  { to: "/chamados", label: "Ocorrências", icon: Wrench },
  { to: "/transparencia", label: "Transparência e contas", icon: ChartNoAxesCombined },
  { to: "/avisos", label: "Avisos", icon: Megaphone },
  { to: "/dispositivos", label: "Equipamentos", icon: Cpu },
  { to: "/areas", label: "Áreas comuns", icon: CalendarDays },
  { to: "/unidades-equipes", label: "Unidades e equipes", icon: House },
  { to: "/regras", label: "Regras de alerta", icon: SlidersHorizontal },
];
export function Shell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const { buildingId } = useBuildingScope();
  const location = useLocation();
  const flags = useFeatures();
  const building = useResource<{ name: string; address: Record<string, unknown> }>(buildingId ? `/buildings/${encodeURIComponent(buildingId)}` : null);
  const address = building.data?.address;
  const addressText = address ? [address.street, address.number, address.city, address.state].filter(value => typeof value === "string" || typeof value === "number").join(" · ") : "";
  return <DashboardFrame title={building.data?.name ?? "Painel do condomínio"} subtitle={addressText || "Gestão inteligente do seu condomínio"} userName={user?.name ?? ""} role="Operação" links={LINKS.filter(link => flags.routeAllowed(link.to))} pathname={location.pathname} signOut={() => void signOut()} renderLink={(to, content, className) => <Link to={to} className={className}>{content}</Link>}><BuildingSelector />{children}</DashboardFrame>;
}
