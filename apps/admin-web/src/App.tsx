import { Navigate, Route, Routes } from "react-router-dom";
import { FeatureProvider, FeatureContent, LoginScreen, useAuth } from "@predioon/ui";
import { Shell } from "./layout/Shell.js";
import { Overview } from "./pages/Overview.js";
import { Clients } from "./pages/Clients.js";
import { Buildings } from "./pages/Buildings.js";
import { Gateways } from "./pages/Gateways.js";
import { Devices } from "./pages/Devices.js";
import { Alerts } from "./pages/Alerts.js";
import { Users } from "./pages/Users.js";
import { Audit } from "./pages/Audit.js";
import { Operations } from "./pages/Operations.js";
import { Features } from "./pages/Features.js";
import { Support } from "./pages/Support.js";

export function App() {
  const { user, loading } = useAuth();

  if (loading) return <p className="p-8 text-slate-500">Carregando...</p>;
  if (!user) return <LoginScreen subtitle="Administração da plataforma" />;

  if (user.role !== "PLATFORM_ADMIN") {
    return (
      <main className="flex min-h-screen items-center justify-center p-8 text-center text-slate-600">
        Este painel é exclusivo da administração da plataforma.
      </main>
    );
  }

  return (
    <FeatureProvider><Shell>
      <Routes>
        <Route path="/" element={<FeatureContent><Overview /></FeatureContent>} />
        <Route path="/clientes" element={<Clients />} />
        <Route path="/predios" element={<Buildings />} />
        <Route path="/gateways" element={<Gateways />} />
        <Route path="/dispositivos" element={<Devices />} />
        <Route path="/alertas" element={<FeatureContent><Alerts /></FeatureContent>} />
        <Route path="/usuarios" element={<Users />} />
        <Route path="/funcionalidades" element={<Features />} />
        <Route path="/auditoria" element={<Audit />} />
        <Route path="/operacao" element={<FeatureContent path="/operacao"><Operations /></FeatureContent>} />
        <Route path="/suporte-remoto" element={<FeatureContent path="/suporte-remoto"><Support /></FeatureContent>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell></FeatureProvider>
  );
}
