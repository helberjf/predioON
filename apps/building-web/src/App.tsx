import { Navigate, Route, Routes } from "react-router-dom";
import { LoginScreen, useAuth } from "@predioon/ui";
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
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard buildingId={buildingId} />} />
        <Route path="/agua" element={<Water buildingId={buildingId} />} />
        <Route path="/energia" element={<Energy buildingId={buildingId} />} />
        <Route path="/dispositivos" element={<Devices buildingId={buildingId} />} />
        <Route path="/alertas" element={<Alerts buildingId={buildingId} />} />
        <Route path="/regras" element={<Rules buildingId={buildingId} />} />
        <Route path="/chamados" element={<Occurrences buildingId={buildingId} />} />
        <Route path="/avisos" element={<Notices buildingId={buildingId} />} />
        <Route path="/areas" element={<Areas buildingId={buildingId} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
