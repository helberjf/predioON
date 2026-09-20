import { Navigate, Route, Routes } from "react-router-dom";
import { LoginScreen, useAuth } from "@predioon/ui";
import { Shell } from "./layout/Shell.js";
import { Overview } from "./pages/Overview.js";
import { Clients } from "./pages/Clients.js";
import { Buildings } from "./pages/Buildings.js";
import { Gateways } from "./pages/Gateways.js";
import { Devices } from "./pages/Devices.js";
import { Alerts } from "./pages/Alerts.js";
import { Users } from "./pages/Users.js";
import { Audit } from "./pages/Audit.js";

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
    <Shell>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/clientes" element={<Clients />} />
        <Route path="/predios" element={<Buildings />} />
        <Route path="/gateways" element={<Gateways />} />
        <Route path="/dispositivos" element={<Devices />} />
        <Route path="/alertas" element={<Alerts />} />
        <Route path="/usuarios" element={<Users />} />
        <Route path="/auditoria" element={<Audit />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
