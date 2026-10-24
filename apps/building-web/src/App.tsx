import { Navigate, Route, Routes } from "react-router-dom";
import { AccessPanel, AssetsPanel, AuditPanel, SupportAccessPanel, AutomationsPanel, BuildingScopeProvider, BuildingScopeFeedback, FeatureProvider, FeatureContent, PublicEntry, PlatformPresentation, PasswordRecoveryScreen, MonitoringPanel, ParkingPanel, ResidentConsumptionSwitch, SessionsPanel, TenancyPanel, TransparencyPanel, WorkOrdersPanel, useAuth, useBuildingScope } from "@predioon/ui";
import { BuildingAccessProvider, RouteAccess, useBuildingAccess } from "./access.js";
import { Shell } from "./layout/Shell.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Water } from "./pages/Water.js";
import { Energy } from "./pages/Energy.js";
import { Devices } from "./pages/Devices.js";
import { Alerts } from "./pages/Alerts.js";
import { Rules } from "./pages/Rules.js";
import { Occurrences } from "./pages/Occurrences.js";
import { Notices } from "./pages/Notices.js";
import { Areas } from "./pages/Areas.js";
import { Safety } from "./pages/Safety.js";

export function App() {
  const { user, loading } = useAuth();

  // A recovery link is honoured whoever is signed in on this browser; it ends every session anyway.
  if (window.location.pathname === "/redefinir-senha") return <PasswordRecoveryScreen />;
  if (window.location.pathname === "/conheca") return <PlatformPresentation />;
  if (loading) return <p className="p-8 text-slate-500">Carregando...</p>;
  if (!user) return <PublicEntry subtitle="Operação do condomínio" />;

  return <BuildingScopeProvider key={user.id}><BuildingApp /></BuildingScopeProvider>;
}

function BuildingApp() {
  const { buildingId } = useBuildingScope();
  if (!buildingId) return <BuildingScopeFeedback />;

  return (
    <FeatureProvider key={buildingId} buildingId={buildingId}><BuildingAccessProvider buildingId={buildingId}><Shell>
      <BuildingRoutes buildingId={buildingId} />
    </Shell></BuildingAccessProvider></FeatureProvider>
  );
}

function BuildingRoutes({ buildingId }: { buildingId: string }) {
  const { can } = useBuildingAccess();
  return (
    <Routes>
      <Route path="/" element={<RouteAccess path="/"><FeatureContent path="/"><Dashboard buildingId={buildingId} /></FeatureContent></RouteAccess>} />
      <Route path="/agua" element={<RouteAccess path="/agua"><FeatureContent path="/agua"><Water buildingId={buildingId} /></FeatureContent></RouteAccess>} />
      <Route path="/energia" element={<RouteAccess path="/energia"><FeatureContent path="/energia"><Energy buildingId={buildingId} /></FeatureContent></RouteAccess>} />
      <Route path="/consumo" element={<RouteAccess path="/consumo"><FeatureContent path="/consumo"><><MonitoringPanel buildingId={buildingId} canManage={can("devices:configure")} />{can("buildings:manage") && <ResidentConsumptionSwitch buildingId={buildingId} />}</></FeatureContent></RouteAccess>} />
      <Route path="/sensores" element={<RouteAccess path="/sensores"><FeatureContent path="/sensores"><Safety buildingId={buildingId} /></FeatureContent></RouteAccess>} />
      <Route path="/acessos" element={<RouteAccess path="/acessos"><FeatureContent path="/acessos"><AccessPanel buildingId={buildingId} /></FeatureContent></RouteAccess>} />
      <Route path="/vagas" element={<RouteAccess path="/vagas"><FeatureContent path="/vagas"><ParkingPanel buildingId={buildingId} /></FeatureContent></RouteAccess>} />
      <Route path="/dispositivos" element={<RouteAccess path="/dispositivos"><Devices buildingId={buildingId} /></RouteAccess>} />
      <Route path="/alertas" element={<RouteAccess path="/alertas"><FeatureContent><Alerts buildingId={buildingId} /></FeatureContent></RouteAccess>} />
      <Route path="/regras" element={<RouteAccess path="/regras"><FeatureContent><Rules buildingId={buildingId} /></FeatureContent></RouteAccess>} />
      <Route path="/chamados" element={<RouteAccess path="/chamados"><FeatureContent path="/chamados"><Occurrences buildingId={buildingId} /></FeatureContent></RouteAccess>} />
      <Route path="/transparencia" element={<RouteAccess path="/transparencia"><FeatureContent path="/transparencia"><TransparencyPanel buildingId={buildingId} /></FeatureContent></RouteAccess>} />
      <Route path="/avisos" element={<RouteAccess path="/avisos"><FeatureContent path="/avisos"><Notices buildingId={buildingId} canManage={can("notices:manage")} /></FeatureContent></RouteAccess>} />
      <Route path="/areas" element={<RouteAccess path="/areas"><FeatureContent path="/areas"><Areas buildingId={buildingId} canManage={can("reservations:manage") && can("common-areas:read")} /></FeatureContent></RouteAccess>} />
      <Route path="/ordens-servico" element={<RouteAccess path="/ordens-servico"><WorkOrdersPanel key={buildingId} buildingId={buildingId} /></RouteAccess>} />
      <Route path="/ativos" element={<RouteAccess path="/ativos"><AssetsPanel key={buildingId} buildingId={buildingId} /></RouteAccess>} />
      <Route path="/automacoes" element={<RouteAccess path="/automacoes"><AutomationsPanel key={buildingId} buildingId={buildingId} /></RouteAccess>} />
      <Route path="/unidades-equipes" element={<RouteAccess path="/unidades-equipes"><TenancyPanel buildingId={buildingId} /></RouteAccess>} />
      <Route path="/sessoes" element={<SessionsPanel />} />
      <Route path="/auditoria" element={<RouteAccess path="/auditoria"><AuditPanel buildingId={buildingId} /></RouteAccess>} />
      <Route path="/acesso-suporte" element={<RouteAccess path="/acesso-suporte"><SupportAccessPanel key={buildingId} buildingId={buildingId} /></RouteAccess>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
