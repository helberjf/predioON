import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AccessPanel, BuildingScopeProvider, BuildingScopeFeedback, FeatureProvider, FeatureContent, LoginScreen, MonitoringPanel, ParkingPanel, TenancyPanel, TransparencyPanel, useAuth, useBuildingScope, useResource } from "@predioon/ui";
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

  if (loading) return <p className="p-8 text-slate-500">Carregando...</p>;
  if (!user) return <LoginScreen subtitle="Operação do condomínio" />;

  return <BuildingScopeProvider key={user.id}><BuildingApp /></BuildingScopeProvider>;
}

function BuildingApp() {
  const { buildingId } = useBuildingScope();
  const authorization = useResource<{ capabilities: string[] }>(buildingId ? `/v1/authorization?buildingId=${encodeURIComponent(buildingId)}` : null);
  useEffect(() => {
    window.addEventListener("focus", authorization.reload);
    const interval = setInterval(authorization.reload, 30_000);
    return () => { window.removeEventListener("focus", authorization.reload); clearInterval(interval); };
  }, [authorization.reload]);
  const can = (capability: string) => authorization.data?.capabilities.includes(capability) === true;
  if (!buildingId) return <BuildingScopeFeedback />;

  return (
    <FeatureProvider key={buildingId} buildingId={buildingId}><Shell>
      <Routes>
        <Route path="/" element={<FeatureContent path="/"><Dashboard buildingId={buildingId} /></FeatureContent>} />
        <Route path="/agua" element={<FeatureContent path="/agua"><Water buildingId={buildingId} /></FeatureContent>} />
        <Route path="/energia" element={<FeatureContent path="/energia"><Energy buildingId={buildingId} /></FeatureContent>} />
        <Route path="/consumo" element={<FeatureContent path="/consumo"><MonitoringPanel buildingId={buildingId} canManage={can("devices:configure")} /></FeatureContent>} />
        <Route path="/sensores" element={<FeatureContent path="/sensores"><Safety buildingId={buildingId} /></FeatureContent>} />
        <Route path="/acessos" element={<FeatureContent path="/acessos"><AccessPanel buildingId={buildingId} canManage={can("buildings:manage")} /></FeatureContent>} />
        <Route path="/vagas" element={<FeatureContent path="/vagas"><ParkingPanel buildingId={buildingId} canManage={can("buildings:manage")} /></FeatureContent>} />
        <Route path="/dispositivos" element={<Devices buildingId={buildingId} />} />
        <Route path="/alertas" element={<FeatureContent><Alerts buildingId={buildingId} canAcknowledge={can("alerts:acknowledge")} canResolve={can("alerts:resolve")} /></FeatureContent>} />
        <Route path="/regras" element={<FeatureContent><Rules buildingId={buildingId} /></FeatureContent>} />
        <Route path="/chamados" element={<FeatureContent path="/chamados"><Occurrences buildingId={buildingId} canManage={can("occurrences:manage")} /></FeatureContent>} />
        <Route path="/transparencia" element={<FeatureContent path="/transparencia"><TransparencyPanel buildingId={buildingId} /></FeatureContent>} />
        <Route path="/avisos" element={<FeatureContent path="/avisos"><Notices buildingId={buildingId} canManage={can("notices:manage")} canManageParking={can("buildings:manage")} /></FeatureContent>} />
        <Route path="/areas" element={<FeatureContent path="/areas"><Areas buildingId={buildingId} canManage={can("reservations:manage") && can("common-areas:read")} /></FeatureContent>} />
        <Route path="/unidades-equipes" element={<TenancyPanel buildingId={buildingId} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell></FeatureProvider>
  );
}
