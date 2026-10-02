import { Navigate, Route, Routes } from "react-router-dom";
import { Button, FeatureProvider, FeatureContent, LoginScreen, SessionsPanel, useAuth } from "@predioon/ui";
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
import { Tenancy } from "./pages/Tenancy.js";

export function App() {
  const { user, loading, signOut } = useAuth();

  if (loading) return <p className="p-8 text-slate-500">Carregando...</p>;
  if (!user) return <LoginScreen subtitle="Administração da plataforma" />;

  if (user.role !== "PLATFORM_ADMIN") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center text-slate-600">
        <p>Este painel é exclusivo da administração da plataforma.</p>
        <Button variant="secondary" onClick={() => void signOut()}>Sair e usar outra conta</Button>
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
        <Route path="/sessoes" element={<SessionsPanel />} />
        <Route path="/unidades-equipes" element={<Tenancy />} />
        <Route path="/funcionalidades" element={<Features />} />
        <Route path="/auditoria" element={<Audit />} />
        <Route path="/operacao" element={<FeatureContent path="/operacao"><Operations /></FeatureContent>} />
        <Route path="/suporte-remoto" element={<FeatureContent path="/suporte-remoto"><Support /></FeatureContent>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell></FeatureProvider>
  );
}
