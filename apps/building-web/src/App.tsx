import { Navigate, Route, Routes } from "react-router-dom";
import { AccessPanel, FeatureProvider, FeatureContent, LoginScreen, MonitoringPanel, ParkingPanel, TransparencyPanel, useAuth } from "@predioon/ui";
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
  const { user, loading, buildingId } = useAuth();

  if (loading) return <p className="p-8 text-slate-500">Carregando...</p>;
  if (!user) return <LoginScreen subtitle="Operação do condomínio" />;

  if (user.role === "RESIDENT") {
    return (
      <main className="flex min-h-screen items-center justify-center p-8 text-center text-slate-600">
        Este painel é da administração do condomínio. Use o portal do morador.
      </main>
    );
  }

  if (!buildingId) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8 text-center text-slate-600">
        Sua conta ainda não está vinculada a nenhum prédio.
      </main>
    );
  }

  return (
    <FeatureProvider buildingId={buildingId}><Shell>
      <Routes>
        <Route path="/" element={<FeatureContent path="/"><Dashboard buildingId={buildingId} /></FeatureContent>} />
        <Route path="/agua" element={<FeatureContent path="/agua"><Water buildingId={buildingId} /></FeatureContent>} />
        <Route path="/energia" element={<FeatureContent path="/energia"><Energy buildingId={buildingId} /></FeatureContent>} />
        <Route path="/consumo" element={<FeatureContent path="/consumo"><MonitoringPanel buildingId={buildingId} canManage /></FeatureContent>} />
        <Route path="/sensores" element={<FeatureContent path="/sensores"><Safety buildingId={buildingId} /></FeatureContent>} />
        <Route path="/acessos" element={<FeatureContent path="/acessos"><AccessPanel buildingId={buildingId} canManage /></FeatureContent>} />
        <Route path="/vagas" element={<FeatureContent path="/vagas"><ParkingPanel buildingId={buildingId} canManage /></FeatureContent>} />
        <Route path="/dispositivos" element={<Devices buildingId={buildingId} />} />
        <Route path="/alertas" element={<FeatureContent><Alerts buildingId={buildingId} /></FeatureContent>} />
        <Route path="/regras" element={<FeatureContent><Rules buildingId={buildingId} /></FeatureContent>} />
        <Route path="/chamados" element={<FeatureContent path="/chamados"><Occurrences buildingId={buildingId} /></FeatureContent>} />
        <Route path="/transparencia" element={<FeatureContent path="/transparencia"><TransparencyPanel buildingId={buildingId} canManage /></FeatureContent>} />
        <Route path="/avisos" element={<FeatureContent path="/avisos"><Notices buildingId={buildingId} /></FeatureContent>} />
        <Route path="/areas" element={<FeatureContent path="/areas"><Areas buildingId={buildingId} /></FeatureContent>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell></FeatureProvider>
  );
}
