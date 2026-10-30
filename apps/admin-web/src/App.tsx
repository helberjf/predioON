import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { Button, FeatureProvider, FeatureContent, PublicEntry, PlatformPresentation, PasswordRecoveryScreen, SessionsPanel, useAuth } from "@predioon/ui";
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
import { SupportAccess } from "./pages/SupportAccess.js";
import { Tenancy } from "./pages/Tenancy.js";
import { Demo } from "./pages/Demo.js";
import { OrganizationAccessFeedback, OrganizationAccessProvider, useOrganizationAccess } from "./organization-access.js";

export function App() {
  const { user, loading } = useAuth();

  // A recovery link is honoured whoever is signed in on this browser; it ends every session anyway.
  if (window.location.pathname === "/redefinir-senha") return <PasswordRecoveryScreen />;
  if (window.location.pathname === "/conheca") return <PlatformPresentation includeAdministration />;
  if (loading) return <p className="p-8 text-slate-500">Carregando...</p>;
  if (!user) return <PublicEntry subtitle="Administração da plataforma" />;

  return <OrganizationAccessProvider key={user.id}><AuthenticatedApp /></OrganizationAccessProvider>;
}

function Denied() {
  const { signOut } = useAuth();
  const access = useOrganizationAccess();
  return <div className="flex flex-col items-center gap-4 p-8 text-center text-slate-600">
    <p>Este painel é exclusivo da administração da plataforma.</p>
    {access.canRead && <Link className="font-semibold text-emerald-700 underline" to="/clientes">Ir para Clientes</Link>}
    <Link className="font-semibold text-emerald-700 underline" to="/sessoes">Consultar minhas sessões</Link>
    <Button variant="secondary" onClick={() => void signOut()}>Sair e usar outra conta</Button>
  </div>;
}

function CommercialEntry() {
  const access = useOrganizationAccess();
  if (access.canRead) return <Navigate to="/clientes" replace />;
  if (access.checking || access.error) return <OrganizationAccessFeedback />;
  return <Denied />;
}

function AuthenticatedApp() {
  const { user } = useAuth();
  const legacy = user?.role === "PLATFORM_ADMIN";
  const gated = (page: ReactNode) => legacy ? page : <Denied />;

  const content = <Shell>
      <Routes>
        <Route path="/" element={legacy ? <FeatureContent><Overview /></FeatureContent> : <CommercialEntry />} />
        <Route path="/clientes" element={<Clients />} />
        <Route path="/predios" element={gated(<Buildings />)} />
        <Route path="/gateways" element={gated(<Gateways />)} />
        <Route path="/dispositivos" element={gated(<Devices />)} />
        <Route path="/alertas" element={gated(<FeatureContent><Alerts /></FeatureContent>)} />
        <Route path="/usuarios" element={gated(<Users />)} />
        <Route path="/sessoes" element={<SessionsPanel />} />
        <Route path="/unidades-equipes" element={gated(<Tenancy />)} />
        <Route path="/funcionalidades" element={gated(<Features />)} />
        <Route path="/demonstracao" element={gated(<Demo />)} />
        <Route path="/auditoria" element={gated(<Audit />)} />
        <Route path="/acesso-suporte" element={gated(<SupportAccess />)} />
        <Route path="/operacao" element={gated(<FeatureContent path="/operacao"><Operations /></FeatureContent>)} />
        <Route path="/suporte-remoto" element={gated(<FeatureContent path="/suporte-remoto"><Support /></FeatureContent>)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>;
  // Commercial-only accounts must not start the legacy global features/SSE readers.
  return legacy ? <FeatureProvider>{content}</FeatureProvider> : content;
}
