import { Navigate, Route, Routes } from "react-router-dom";
import { AccessPanel, BuildingScopeProvider, BuildingScopeFeedback, FeatureProvider, FeatureContent, InvitationScreen, PublicEntry, ResidentPresentation, PasswordRecoveryScreen, PublishedConsumption, ParkingPanel, TransparencyPanel, useAuth, useBuildingScope } from "@predioon/ui";
import { MobileShell } from "./layout/MobileShell.js";
import { Home } from "./pages/Home.js";
import { Notices } from "./pages/Notices.js";
import { Occurrences } from "./pages/Occurrences.js";
import { Reservations } from "./pages/Reservations.js";
import { Profile } from "./pages/Profile.js";

export function App() {
  const { user, loading } = useAuth();

  // An invitation is accepted without a session, whoever is signed in on this browser.
  if (window.location.pathname === "/convite") return <InvitationScreen />;
  // A recovery link is honoured whoever is signed in on this browser; it ends every session anyway.
  if (window.location.pathname === "/redefinir-senha") return <PasswordRecoveryScreen />;
  if (window.location.pathname === "/conheca") return <ResidentPresentation />;
  if (loading) return <p className="p-8 text-slate-500">Carregando...</p>;
  if (!user) return <PublicEntry subtitle="Portal do morador" invitationHref="/convite" audience="resident" />;

  return <BuildingScopeProvider key={user.id}><ResidentApp /></BuildingScopeProvider>;
}

function ResidentApp() {
  const { buildingId } = useBuildingScope();
  if (!buildingId) return <BuildingScopeFeedback />;

  return (
    <FeatureProvider key={buildingId} buildingId={buildingId}><MobileShell>
      <Routes>
        <Route path="/" element={<FeatureContent path="/"><Home buildingId={buildingId} /></FeatureContent>} />
        <Route path="/avisos" element={<FeatureContent path="/avisos"><Notices buildingId={buildingId} /></FeatureContent>} />
        <Route path="/acessos" element={<FeatureContent path="/acessos"><AccessPanel buildingId={buildingId} /></FeatureContent>} />
        <Route path="/consumo" element={<FeatureContent path="/consumo"><PublishedConsumption buildingId={buildingId} /></FeatureContent>} />
        <Route path="/vagas" element={<FeatureContent path="/vagas"><ParkingPanel buildingId={buildingId} /></FeatureContent>} />
        <Route path="/chamados" element={<FeatureContent path="/chamados"><Occurrences buildingId={buildingId} /></FeatureContent>} />
        <Route path="/transparencia" element={<FeatureContent path="/transparencia"><TransparencyPanel buildingId={buildingId} /></FeatureContent>} />
        <Route path="/reservas" element={<FeatureContent path="/reservas"><Reservations buildingId={buildingId} /></FeatureContent>} />
        <Route path="/perfil" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MobileShell></FeatureProvider>
  );
}
